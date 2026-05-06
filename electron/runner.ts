import { chromium, firefox, webkit } from 'playwright'
import type { Browser, BrowserContext, Page, BrowserType, CDPSession } from 'playwright'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { BrowserWindow } from 'electron'
import type { TestCase, RunResult, StepResult, Settings } from '../shared/types'
import * as storage from './storage'
import { createLLMClient, parseJsonLoose, type LLMMessage, type LLMUsage } from './llm'
import { snapshotPage, screenshotBase64, type PageSnapshot } from './snapshot'
import { executeAction, type PlannedAction } from './actions'
import { estimateCostUsd } from './pricing'

function uid(p: string) { return `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }

function pickBrowser(name: string): BrowserType {
  if (name === 'firefox') return firefox
  if (name === 'webkit') return webkit
  return chromium
}

function emit(channel: string, payload: any) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

// ---------------- cancellation ----------------

class CancelError extends Error { constructor() { super('Run cancelled by user') } }

interface RunHandle {
  cancelled: boolean
  abort: AbortController
  hardStop: () => Promise<void>
}

const activeRuns = new Map<string, RunHandle>()

export function cancelRun(runId: string) {
  const h = activeRuns.get(runId)
  if (!h || h.cancelled) return
  h.cancelled = true
  // abort any in-flight LLM fetch immediately
  try { h.abort.abort() } catch {}
  // tear down browser immediately so any in-flight Playwright call throws
  void h.hardStop()
}

function checkCancel(runId: string) {
  if (activeRuns.get(runId)?.cancelled) throw new CancelError()
}

function isCancelled(runId: string) {
  return !!activeRuns.get(runId)?.cancelled
}

// ---------------- screencast ----------------

async function startScreencast(page: Page, runId: string): Promise<CDPSession | null> {
  // CDP screencast is chromium-only
  try {
    const session = await page.context().newCDPSession(page)
    session.on('Page.screencastFrame', async (frame: any) => {
      emit('run:frame', { runId, data: frame.data })
      try { await session.send('Page.screencastFrameAck', { sessionId: frame.sessionId }) } catch {}
    })
    await session.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 60,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 2,
    })
    return session
  } catch {
    return null
  }
}

async function stopScreencast(session: CDPSession | null) {
  if (!session) return
  try { await session.send('Page.stopScreencast') } catch {}
  try { await session.detach() } catch {}
}

// ---------------- LLM step planners ----------------

interface ExecCtx {
  runId: string
  page: Page
  context: BrowserContext
  settings: Settings
  usage: LLMUsage
  runDir: string
  signal: AbortSignal
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'click', 'press', 'tap', 'select', 'choose', 'pick',
  'on', 'to', 'and', 'or', 'in', 'of', 'is', 'are', 'this', 'that',
  'these', 'those', 'with', 'from', 'for', 'at', 'by',
  'button', 'link', 'tab', 'item', 'option', 'page', 'field', 'box',
  'open', 'close', 'go', 'navigate', 'verify', 'check', 'ensure', 'make',
  'sure', 'should', 'must', 'will', 'be', 'has', 'have',
])

function extractTargetTokens(desc: string): string[] {
  // Prefer quoted strings as exact targets
  const quoted = Array.from(desc.matchAll(/['"‘’“”]([^'"‘’“”\n]{2,})['"‘’“”]/g), (m) => m[1])
  if (quoted.length > 0) {
    return quoted
      .join(' ')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !STOPWORDS.has(w))
  }
  return desc
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w))
}

function relevanceScore(targetTokens: string[], description: string, selector: string): { score: number; matches: string[] } {
  // Search both human description AND selector (class names often carry semantic hints like "tasteTag")
  const text = (description + ' ' + selector).toLowerCase()
  const matches: string[] = []
  let score = 0
  for (const t of targetTokens) {
    if (text.includes(t)) {
      score += t.length * (t.length >= 4 ? 2 : 1)
      matches.push(t)
    }
  }
  return { score, matches }
}

async function planActions(ctx: ExecCtx, stepDescription: string, snapshot: PageSnapshot): Promise<PlannedAction[]> {
  const client = createLLMClient(ctx.settings.llm.planner ?? ctx.settings.llm.default)
  const sys = `You drive a web browser via Playwright. Given a step description and two views of the current page (ARIA snapshot + DOM interactive elements list), output a JSON plan to fulfill the step.

Output format — pick ONE:

  Single action (preferred when one action suffices):
  { "action": "click", "role": "button", "name": "Sign in", "reason": "..." }

  Multi-action sequence (use when prerequisites are needed, e.g. dismiss overlay THEN click target, or fill multiple fields):
  { "actions": [ {<action1>}, {<action2>}, ... ], "reason": "..." }

The actions in a sequence run in order. The step is considered done after ALL of them succeed.

═══ ACTION FORMS ═══

Form A — by ARIA role + name (use when the element has a clear accessible name in the ARIA snapshot):
  { "action": "click",  "role": "button",   "name": "Sign in" }
  { "action": "fill",   "role": "textbox",  "name": "Email", "value": "a@b.c" }
  { "action": "select", "role": "combobox", "name": "Country", "value": "USA" }
  { "action": "check",  "role": "checkbox", "name": "Subscribe" }

Form B — by CSS selector (copy the selector verbatim from MODAL CONTENTS / TOP TEXT-MATCHES / Other lists):
  { "action": "click",  "selector": "button._closeButton_phpst_389" }
  { "action": "click",  "selector": "div.modal-mask" }
  { "action": "fill",   "selector": "input.search-box", "value": "hello" }
  // If the entry shows a "text=..." field, the selector is non-unique. INCLUDE the text field so we filter to the right one:
  { "action": "click",  "selector": "button.button-outline-medium", "text": "Save" }

Keyboard / navigation:
  { "action": "press",    "value": "Escape" }   // dismiss modals, blur, cancel
  { "action": "press",    "value": "Enter" }
  { "action": "navigate", "value": "https://..." }
  { "action": "wait",     "value": "1000" }
  { "action": "noop" }
  { "action": "fail",     "reason": "no element matches '<thing>' on this page" }   // refuse: marks the step as failed

Add "force": true to any click/fill to bypass overlay interception.
Add "nth": 0/1/2 to disambiguate when multiple elements match.

═══ CRITICAL DECISION FLOW ═══

Step 0 — Is there a RECOMMENDED ACTION at the top of the user message?
  YES → Output it verbatim (or as the second action in a multi-action sequence if a prerequisite is needed). Only override it if the recommendation clearly does NOT match the step's intent (e.g. wrong element type for the verb). The recommendation already accounts for occlusion, text disambiguation, and modal context — trust it.
  NO → Proceed to step 1.

Step 1 — Is there an ACTIVE BLOCKING OVERLAY?
  YES →
    (a) The user's target is almost certainly inside the modal. Pick from MODAL CONTENTS only.
    (b) **Use ONLY Form B (selector)** from MODAL CONTENTS — DO NOT use Form A (role+name).
        Reason: when an overlay is open, the same name (e.g. "Save") can exist BOTH inside the modal AND behind it on the page. getByRole().first() picks whichever appears first in DOM order, and that's often the one behind the overlay. Selectors are exact. Always copy the selector verbatim from MODAL CONTENTS.
    (c) If MODAL CONTENTS does NOT contain a sensible match for the user's intent, only THEN consider closing the modal (and only if the step text explicitly says "close"/"cancel"/"dismiss"/"back").
    (d) Never click an [OCCLUDED] element.
  NO → Move to step 2.

Step 2 — Does the user describe the target by SPECIFIC TEXT (e.g. "click 'Sign in'", "select 'Banana'")?
  YES → Pick the #1 entry in TOP TEXT-MATCHES. If TOP TEXT-MATCHES is empty, output { "action": "fail", "reason": "no element with text 'X' found" }.
  NO → User describes by CATEGORY ("a taste tag", "any item", "the first option"). Look at MODAL CONTENTS (if modal open) or the clickables list, pick the first element whose class/role/description matches the category (e.g., for "taste tag" → class~="tasteTag" / "itemButton" / role="option"). If multiple match, pick the first.

CARDINAL RULES:
- NEVER pick an [OCCLUDED] element. Physically unreachable.
- When overlay exists, NEVER use Form A — only Form B with selectors from MODAL CONTENTS.
- NEVER use "press Escape" or "press Enter" as a prerequisite action in a multi-action sequence UNLESS the step description explicitly says "press Escape", "press Enter", "dismiss", or "close". Both keys close/submit dialogs. If the target is in MODAL CONTENTS, click it directly — do NOT try to dismiss the overlay first with a key press.

Multi-action sequencing: combine prerequisites with the goal in { "actions": [...] }. A single "press Escape" or "press Enter" is only correct when the step itself IS about dismissing or submitting — i.e. those words appear in the step description.

1. The "name" field is the LITERAL accessible name from the ARIA snapshot, NOT the user's description.
   - If the user says "click the close button" but the snapshot shows no button named "Close", DO NOT guess { "name": "Close" }. That will fail.
   - Instead, look in DOM INTERACTIVE ELEMENTS for an entry whose description hints at "close" / "dismiss" / icon=close.svg / class~="close" / position top-right, and use Form B with that selector.

2. Map user intent → element heuristically:
   - "close button" / "X" / "dismiss" → look for icon=close.svg, class~="close|closeButton|dismiss", or role="button" with no name in top-right
   - "modal mask" / "outside the panel" / "dark area" → look for class~="modal-mask|backdrop|overlay" or fullscreen-overlay position
   - "menu" / "hamburger" → look for class~="menu|hamburger|drawer-toggle"
   - "submit" / "save" → button with text "Submit"/"Save"/"Confirm"/"OK"

3. For closing a modal, try in this order until one matches the available elements:
   (a) Press Escape (cheapest)
   (b) Click the close button via Form B with selector from DOM INTERACTIVE ELEMENTS (look for class containing "close" or icon "close.svg")
   (c) Click the modal mask via Form B (selector containing "modal-mask"/"backdrop"/"overlay")
   (d) Add "force": true if an overlay still blocks the click

4. If the previous attempt failed because of overlay interception, the next action MUST dismiss the overlay first — do not retry the same click.

5. Always include a brief "reason" field explaining your choice.

6. ELEMENT MATCHING — before picking ANY element, check whether the user's described text/label actually appears on the page:
   - If the user says "click the 'X' button" or "click X", search the ARIA snapshot AND the DOM list for an element whose accessible name OR description text contains "X" (case-insensitive, after normalization).
   - If you find an element matching the text → use it.
   - If NOTHING matches the user's text → DO NOT pick a similar-sounding or visually-adjacent element. Output { "action": "fail", "reason": "no element with text 'X' found on the page" }. It's better to fail loudly than to click the wrong thing silently.
   - For ambiguous descriptions ("a button", "any item"), pick the most prominent matching element (high in the DOM, large, near top of viewport).

═══ EXAMPLES ═══

Example 1: User says "click the close button to dismiss the address modal".
ARIA shows no button named "Close". DOM list has:  selector="button._closeButton_phpst_389" — button icon=close.svg class~="_closeButton_phpst_389" top-right
✓ Output: { "action": "click", "selector": "button._closeButton_phpst_389", "reason": "icon-only close button identified by class and close.svg icon" }
✗ Wrong: { "action": "click", "role": "button", "name": "Close" }   // there is no element named "Close"

Example 2: User says "close the modal by clicking outside the panel".
DOM list has: selector="div.modal-mask" — div class~="modal-mask" fullscreen-overlay
✓ Output: { "action": "click", "selector": "div.modal-mask", "reason": "click backdrop overlay to dismiss modal" }

Example 3: User says "click Sign in".
ARIA snapshot contains: - button "Sign in"
✓ Output: { "action": "click", "role": "button", "name": "Sign in" }

Example 4: User says "Select a taste tag from the available options".
ACTIVE BLOCKING OVERLAYS lists: selector="div.modal-mask" (fullscreen).
MODAL CONTENTS (non-occluded) lists: selector="div._itemButton_h8dtt_103" — div text="American Comfort" class~="_itemButton_..."
✓ Output: { "action": "click", "selector": "div._itemButton_h8dtt_103", "reason": "taste tag found in MODAL CONTENTS (non-occluded), clicking directly" }
✗ Wrong: { "actions": [{ "action": "press", "value": "Escape" }, { "action": "click", "selector": "div._itemButton_h8dtt_103" }] }
  // pressing Escape CLOSES the modal that contains the taste tags — never use keyboard keys as prerequisites

Output ONE JSON object only. No prose, no markdown, no code fences.`
  // Rank clickables by semantic relevance to the step description
  const tokens = extractTargetTokens(stepDescription)
  const scored = snapshot.clickables.map((c) => ({ c, ...relevanceScore(tokens, c.description, c.selector) }))
  const sorted = [...scored].sort((a, b) => {
    if (a.c.occluded !== b.c.occluded) return a.c.occluded ? 1 : -1
    if (b.score !== a.score) return b.score - a.score
    return 0
  })

  const hasOverlay = snapshot.overlays.length > 0
  const nonOccluded = sorted.filter((s) => !s.c.occluded)
  const occluded = sorted.filter((s) => s.c.occluded)

  // Top text matches (only among non-occluded — never recommend something that can't be clicked)
  const topMatches = nonOccluded.filter((s) => s.score > 0).slice(0, 6)
  const otherNonOccluded = nonOccluded.filter((s) => !topMatches.includes(s))

  const fmt = (c: typeof snapshot.clickables[number]) =>
    `selector="${c.selector}"${c.text ? ` text="${c.text}"` : ''} — ${c.description}`
  const topMatchesText = topMatches.length
    ? topMatches.map((s, i) => `  ${i + 1}. ${fmt(s.c)}  [matches: ${s.matches.join(', ')}]`).join('\n')
    : '  (no clickable element\'s text/class matches the step description by token)'

  // Compute a recommended action when there's a clear winner.
  // Triggers for click-style verbs only (not fill/select/etc which need a value the LLM must provide).
  const isClickIntent = /^\s*(click|tap|press|select|choose|open|hit|go to|navigate)\b/i.test(stepDescription) || tokens.length > 0
  let recommended: PlannedAction | null = null
  if (isClickIntent && topMatches.length > 0) {
    const best = topMatches[0]
    const second = topMatches[1]
    // confident pick: best clearly outscores second OR best has at least 2 token matches
    const confident = best.matches.length >= 2 || !second || best.score >= second.score * 1.5
    if (confident) {
      recommended = {
        action: 'click',
        selector: best.c.selector,
        ...(best.c.text ? { text: best.c.text } : {}),
        reason: `heuristic match on tokens: ${best.matches.join(', ')}`,
      }
    }
  }
  // Fast path: skip the LLM entirely for unambiguous simple click steps. When the user
  // wrote "click/tap/press [the] 'X' [...]" and our heuristic has a confident single
  // match scoring strongly on the quoted text, the LLM adds no value — it occasionally
  // even drifts to a visually-adjacent wrong element (e.g. picking the close-X icon when
  // the user said "confirm"). This bypass is deterministic, faster, and saves tokens.
  if (recommended && recommended.action === 'click') {
    const isSimpleClick = /^\s*(click|tap|press)\b/i.test(stepDescription)
    const hasQuoted = /['"‘’“”]/.test(stepDescription)
    if (isSimpleClick && hasQuoted) {
      return [recommended]
    }
  }

  const recommendedText = recommended
    ? `\n═══ RECOMMENDED ACTION (element is confirmed NON-OCCLUDED and directly clickable — output this verbatim; do NOT let the overlay section override it) ═══\n${JSON.stringify(recommended)}\n`
    : ''

  const overlaysText = hasOverlay
    ? snapshot.overlays.map((o) => `  selector="${o.selector}" — ${o.description}`).join('\n')
    : '  (none — no blocking overlay on the page)'

  const modalContentText = hasOverlay
    ? (nonOccluded.length
        ? nonOccluded.slice(0, 30).map((s) => `  ${fmt(s.c)}`).join('\n')
        : '  (no clickable elements detected inside the modal)')
    : ''

  const otherClickablesText = otherNonOccluded.length
    ? otherNonOccluded.slice(0, 25).map((s) => `  ${fmt(s.c)}`).join('\n')
    : '  (none)'

  const occludedText = occluded.length
    ? occluded.slice(0, 15).map((s) => `  [OCCLUDED] ${fmt(s.c)}`).join('\n')
    : ''

  const user = `Step: ${stepDescription}

Page URL: ${snapshot.url}
Page title: ${snapshot.title}
${recommendedText}
═══ ACTIVE BLOCKING OVERLAYS ═══
${overlaysText}
${hasOverlay ? `\n═══ MODAL CONTENTS (non-occluded clickables — these are the ONLY elements you can interact with right now; the user's intent almost certainly refers to one of these) ═══\n${modalContentText}` : ''}

═══ TOP TEXT-MATCHES for this step (semantic match by description text + class name) ═══
${topMatchesText}

═══ ARIA snapshot (use role+name when an element here matches) ═══
${snapshot.text}
${!hasOverlay ? `\n═══ Other interactive elements ═══\n${otherClickablesText}` : ''}
${occludedText ? `\n═══ Occluded elements (DO NOT click — covered by overlay) ═══\n${occludedText}` : ''}`
  const messages: LLMMessage[] = [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ]
  const res = await client.complete(messages, {
    temperature: ctx.settings.llm.temperature,
    maxTokens: 500,
    jsonOnly: true,
    signal: ctx.signal,
  })
  ctx.usage.inputTokens += res.usage.inputTokens
  ctx.usage.outputTokens += res.usage.outputTokens
  const parsed = parseJsonLoose<any>(res.text)
  if (parsed && Array.isArray(parsed.actions)) return parsed.actions as PlannedAction[]
  return [parsed as PlannedAction]
}

// Vision-based coordinate fallback: when the primary selector click fails entirely,
// take a screenshot and ask the LLM to locate the element by pixel position, then
// click at those exact coordinates via mouse. Works even when no CSS selector can
// uniquely identify the target.
async function clickByCoordinates(ctx: ExecCtx, stepDescription: string, preCapturedShot?: string | null): Promise<void> {
  // Prefer the pre-click screenshot if provided — the page state may have shifted
  // (e.g. the modal closed) during the failed click attempt, so a fresh screenshot
  // would no longer show the target element.
  const screenshot = preCapturedShot ?? await screenshotBase64(ctx.page, false).catch(() => null)
  if (!screenshot) throw new Error('could not take screenshot for vision fallback')

  const client = createLLMClient(ctx.settings.llm.planner ?? ctx.settings.llm.default)
  const vp = ctx.settings.engine.viewport ?? { width: 1280, height: 800 }
  const sys = `You locate elements in web browser screenshots. Given a step description, return the pixel coordinates of the CENTER of the element the user wants to click.

Output JSON only — no prose, no markdown:
{"found": true, "x": <integer>, "y": <integer>, "reason": "<brief>"}
or if the element is not visible:
{"found": false, "reason": "<brief>"}`

  const messages: LLMMessage[] = [
    { role: 'system', content: sys },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Step: ${stepDescription}\nScreenshot: ${vp.width}×${vp.height} px. Return center (x, y) of the element to click.`,
        },
        { type: 'image', imageBase64: screenshot },
      ],
    },
  ]

  const res = await client.complete(messages, {
    temperature: 0,
    maxTokens: 150,
    jsonOnly: true,
    signal: ctx.signal,
  })
  ctx.usage.inputTokens += res.usage.inputTokens
  ctx.usage.outputTokens += res.usage.outputTokens

  const parsed = parseJsonLoose<any>(res.text)
  if (!parsed?.found || typeof parsed.x !== 'number' || typeof parsed.y !== 'number') {
    throw new Error(`element not visible in screenshot: ${parsed?.reason ?? 'no coordinates returned'}`)
  }

  await ctx.page.mouse.click(Math.round(parsed.x), Math.round(parsed.y))
}

function normalizeText(s: string): string {
  return s
    .replace(/ /g, ' ')           // NBSP → space
    .replace(/[‘’]/g, "'")   // smart single quotes
    .replace(/[“”]/g, '"')   // smart double quotes
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

async function deterministicAssertCheck(
  ctx: ExecCtx,
  description: string
): Promise<{ passed: boolean; confidence: number; reason: string } | null> {
  const re = /['"‘’“”]([^'"‘’“”\n]{2,})['"‘’“”]/g
  const quoted = Array.from(description.matchAll(re), (m) => m[1])
  if (quoted.length === 0) return null

  const positiveVerb = /\b(contain|contains|has|have|show|shows|display|displays|include|includes|present|visible|equal|equals|reads?|says?|exist|exists)\b/i.test(description)
  const negativeMarker = /\b(not|n['o]t|never|missing|absent|hidden|removed|gone|disappear(?:ed|s)?|no\s+longer)\b/i.test(description)

  // Two well-defined cases we can answer deterministically:
  //   POSITIVE assertion ("contains 'X'") → pass if X found, fall through if not
  //   NEGATIVE assertion ("'X' should not exist") → pass if X NOT found, fall through if found
  if (!positiveVerb && !negativeMarker) return null

  let pageText = ''
  try {
    pageText = await ctx.page.evaluate(() => {
      const parts: string[] = []
      if (document.body) parts.push(document.body.innerText || '')
      document.querySelectorAll('input, textarea').forEach((el) => {
        const v = (el as HTMLInputElement).value
        if (v) parts.push(v)
      })
      document.querySelectorAll('[aria-label], [title], [alt], [placeholder], [value]').forEach((el) => {
        for (const attr of ['aria-label', 'title', 'alt', 'placeholder', 'value']) {
          const v = el.getAttribute(attr)
          if (v) parts.push(v)
        }
      })
      return parts.join(' \n ')
    })
  } catch {
    return null
  }

  const normPage = normalizeText(pageText)
  const presence = quoted.map((q) => ({ q, found: normPage.includes(normalizeText(q)) }))

  if (negativeMarker) {
    // "X should not exist" / "is not present" / "is hidden"
    const noneFound = presence.every((p) => !p.found)
    if (noneFound) {
      return {
        passed: true,
        confidence: 0.99,
        reason: `[deterministic] None of the asserted strings present in page text/inputs/attributes: ${quoted.map((q) => `"${q}"`).join(', ')}`,
      }
    }
    // some are present — assertion fails deterministically (don't ask LLM, it'll be flaky)
    const present = presence.filter((p) => p.found).map((p) => `"${p.q}"`)
    return {
      passed: false,
      confidence: 0.99,
      reason: `[deterministic] Asserted-absent string(s) actually present in page: ${present.join(', ')}`,
    }
  }

  // POSITIVE
  const allFound = presence.every((p) => p.found)
  if (allFound) {
    return {
      passed: true,
      confidence: 0.99,
      reason: `[deterministic] All quoted strings found in page (text/inputs/attributes): ${quoted.map((q) => `"${q}"`).join(', ')}`,
    }
  }
  return null
}

async function judgeAssert(ctx: ExecCtx, description: string, snapshot: PageSnapshot, screenshot: string | null): Promise<{ passed: boolean; confidence: number; reason: string }> {
  // Try deterministic first for quoted-substring assertions — bypasses LLM hallucination
  const det = await deterministicAssertCheck(ctx, description)
  if (det) return det

  const client = createLLMClient(ctx.settings.llm.asserter ?? ctx.settings.llm.default)
  const sys = `You verify whether an assertion holds on a web page. Judge SEMANTICALLY, like a human QA tester. Default to PASS when the page clearly shows what the assertion describes.

Rules:
- "Contains X" PASSES if X appears anywhere on the page or in the named element after normalization. Normalization = trim whitespace, collapse multiple spaces, case-insensitive, NBSP=space, smart quotes=straight quotes.
- "Equals X" / "Is X" — same normalization unless the assertion uses the word "exactly", "exact match", or "byte-for-byte".
- DO NOT fail because of trailing/leading whitespace, extra/missing spaces, case differences, smart vs straight quotes, line breaks, or other cosmetic differences.
- DO NOT invent differences. If the page text and the asserted text look the same after normalization, they ARE the same — pass.
- Visual styling, exact pixel positions, fonts → ignore unless the assertion specifically targets them.
- Set passed=false ONLY if the actual meaning differs (e.g. asked for "logged in", page says "please sign in").
- Use confidence < 0.7 ONLY when evidence is genuinely ambiguous (loading spinner, partial content, can't find the element).

Examples:
- Assertion: "textbox contains 'vegan friendly sandwiches'". Textbox value: "vegan friendly sandwiches " (trailing space). → passed=true, confidence=0.95.
- Assertion: "button labelled 'Sign in' is visible". Page: button "Sign In". → passed=true (case insensitive).
- Assertion: "page shows total $50". Page: "Total: $50.00". → passed=true (semantic match).
- Assertion: "user is logged in as Alice". Page: "Sign in" button visible, no user info. → passed=false.

Output JSON ONLY (no prose, no markdown, no code fences):
{ "passed": true|false, "confidence": 0..1, "reason": "<one sentence citing concrete evidence>" }`
  const userParts: any[] = [
    { type: 'text', text: `Assertion: ${description}\n\nPage URL: ${snapshot.url}\nTitle: ${snapshot.title}\n\nARIA snapshot:\n${snapshot.text}` },
  ]
  if (screenshot && ctx.settings.assert.sendScreenshot) {
    userParts.push({ type: 'image', imageBase64: screenshot })
  }
  const messages: LLMMessage[] = [
    { role: 'system', content: sys },
    { role: 'user', content: userParts },
  ]
  const res = await client.complete(messages, {
    temperature: ctx.settings.llm.temperature,
    maxTokens: 400,
    jsonOnly: true,
    signal: ctx.signal,
  })
  ctx.usage.inputTokens += res.usage.inputTokens
  ctx.usage.outputTokens += res.usage.outputTokens
  const parsed = parseJsonLoose<any>(res.text)
  return {
    passed: !!parsed.passed,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    reason: parsed.reason ?? '',
  }
}

async function executeStep(
  ctx: ExecCtx,
  step: TestCase['steps'][number]
): Promise<StepResult> {
  const start = Date.now()
  const stepResult: StepResult = { stepId: step.id, status: 'pending', durationMs: 0 }

  const maxAttempts = ctx.settings.retry.autoRetry ? Math.max(1, ctx.settings.retry.maxAttempts + 1) : 1
  let lastError = ''

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    checkCancel(ctx.runId)
    try {
      const snapshot = await snapshotPage(ctx.page)
      const screenshot = ctx.settings.assert.sendScreenshot
        ? await screenshotBase64(ctx.page, ctx.settings.assert.fullPageScreenshot).catch(() => null)
        : null

      let screenshotPath: string | undefined
      if (screenshot) {
        const file = path.join(ctx.runDir, `${step.id}_attempt${attempt}.png`)
        await fs.writeFile(file, Buffer.from(screenshot, 'base64'))
        screenshotPath = file
      }

      if (step.type === 'assert') {
        const j = await judgeAssert(ctx, step.description, snapshot, screenshot)
        const status =
          j.passed && j.confidence >= ctx.settings.assert.confidenceThreshold
            ? 'passed'
            : !j.passed && j.confidence >= ctx.settings.assert.confidenceThreshold
            ? 'failed'
            : 'needs_review'
        stepResult.status = status
        stepResult.confidence = j.confidence
        stepResult.reasoning = j.reason
        stepResult.screenshot = screenshotPath
        if (status === 'failed' && !ctx.settings.retry.retryOnAssertFailure) break
        if (status !== 'failed' && status !== 'needs_review') break
        lastError = j.reason
      } else {
        const actions = await planActions(ctx, step.description, snapshot)
        const summaries: string[] = []
        for (const action of actions) {
          checkCancel(ctx.runId)
          const actionSummary = `${action.action}${action.role ? ` ${action.role}` : ''}${action.name ? ` "${action.name}"` : ''}${action.selector ? ` selector="${action.selector}"` : ''}${action.value ? ` value="${action.value}"` : ''}`
          // For click actions, capture the page state BEFORE the click attempt so vision
          // fallback can use it. The page may shift during the click attempt (e.g. modal
          // dismissed by Playwright's hover/scroll events), making a post-failure screenshot
          // useless. Reusing the pre-click image guarantees the LLM sees the element.
          const preClickShot = action.action === 'click'
            ? await screenshotBase64(ctx.page, false).catch(() => null)
            : null
          try {
            await executeAction(ctx.page, action, ctx.settings.engine.actionTimeoutMs)
            summaries.push(actionSummary)
          } catch (clickErr: any) {
            if (clickErr instanceof CancelError) throw clickErr
            if (action.action !== 'click') throw clickErr
            // Vision fallback: ask the LLM to locate the element by coordinates in a screenshot.
            const originalMsg: string = clickErr?.message ?? String(clickErr)
            try {
              await clickByCoordinates(ctx, step.description, preClickShot)
              summaries.push(`${actionSummary} [vision-fallback]`)
            } catch (visionErr: any) {
              throw new Error(`${originalMsg}\n[vision fallback] ${visionErr?.message ?? visionErr}`)
            }
          }
        }
        stepResult.status = 'passed'
        stepResult.reasoning = summaries.join(' → ')
        stepResult.screenshot = screenshotPath
        break
      }
    } catch (e: any) {
      if (e instanceof CancelError) throw e
      // if cancelled mid-step (LLM aborted, page closed), treat as cancel
      if (isCancelled(ctx.runId)) throw new CancelError()
      lastError = e?.message ?? String(e)
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, ctx.settings.retry.delayMs))
        continue
      }
      stepResult.status = 'failed'
      stepResult.error = lastError
    }
  }

  if (stepResult.status === 'pending') {
    stepResult.status = 'failed'
    stepResult.error = lastError || 'unknown error'
  }
  stepResult.durationMs = Date.now() - start
  return stepResult
}

// Injected into every page. Forces popup/new-tab navigation to happen in the
// same tab so URL-based assertions can observe it.
const NAVIGATION_INIT_SCRIPT = `
(() => {
  // Capture-phase click handler runs BEFORE the browser processes target="_blank"
  // and BEFORE any framework click handler. Race-free.
  document.addEventListener('click', function(e) {
    try {
      var el = e.target;
      while (el && el.nodeType === 1 && el.tagName !== 'A') el = el.parentElement;
      if (el && el.tagName === 'A') {
        if (el.target && el.target !== '_self' && el.target !== '_top' && el.target !== '_parent') {
          el.removeAttribute('target');
        }
      }
    } catch {}
  }, true);

  // Also strip on initial render and on DOM mutations as a belt-and-braces.
  const stripTargets = () => {
    try {
      document.querySelectorAll('a[target]').forEach(a => {
        var t = a.getAttribute('target');
        if (t && t !== '_self' && t !== '_top' && t !== '_parent') a.removeAttribute('target');
      });
    } catch {}
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', stripTargets);
  else stripTargets();
  try {
    new MutationObserver(stripTargets).observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['target']
    });
  } catch {}

  // Force window.open to navigate the current tab.
  const origOpen = window.open;
  window.open = function(url) {
    try { if (typeof url === 'string' && url) { window.location.href = url; return null; } } catch {}
    return origOpen ? origOpen.apply(this, arguments) : null;
  };
})();
`

async function launchContext(siteId: string, settings: Settings, authProfileId?: string) {
  const browser = pickBrowser(settings.engine.browser)
  const launchOpts: any = {
    headless: settings.engine.headless,
    slowMo: settings.engine.slowMoMs,
  }
  const contextOpts: any = {
    viewport: settings.engine.viewport,
  }
  if (settings.engine.userAgent) contextOpts.userAgent = settings.engine.userAgent

  let ctx: BrowserContext
  let parentBrowser: Browser | null = null
  if (authProfileId) {
    const dir = storage.authProfileDir(siteId, authProfileId)
    await fs.mkdir(dir, { recursive: true })
    ctx = await browser.launchPersistentContext(dir, { ...launchOpts, ...contextOpts })
  } else {
    parentBrowser = await browser.launch(launchOpts)
    ctx = await parentBrowser.newContext(contextOpts)
  }
  await ctx.addInitScript(NAVIGATION_INIT_SCRIPT).catch(() => {})
  return { context: ctx, browser: parentBrowser }
}

export async function runTest(
  siteId: string,
  test: TestCase,
  settings: Settings,
  options: { runId?: string; authProfileId?: string; startUrl?: string } = {}
): Promise<RunResult> {
  const runId = options.runId ?? uid('run')
  const run: RunResult = {
    id: runId,
    testId: test.id,
    startedAt: new Date().toISOString(),
    status: 'running',
    steps: [],
  }
  const runDir = path.join(storage.getDataDir(), 'sites', siteId, 'runs', run.id)
  await fs.mkdir(runDir, { recursive: true })

  let authId = options.authProfileId
  if (!authId) {
    const sites = await storage.listSites()
    authId = sites.find((s) => s.id === siteId)?.defaultAuthProfileId
  }
  const loginStep = test.steps.find((s) => s.type === 'login')
  if (loginStep?.authProfileId) authId = loginStep.authProfileId

  const { context, browser } = await launchContext(siteId, settings, authId)
  // Persistent contexts already have an initial page; reuse it so init scripts apply.
  const existing = context.pages()
  const page = existing.length > 0 ? existing[0] : await context.newPage()
  page.setDefaultNavigationTimeout(settings.engine.navigationTimeoutMs)
  page.setDefaultTimeout(settings.engine.actionTimeoutMs)

  // If a popup escapes our same-tab override (rare), follow it: redirect the original
  // page to the popup's URL once the popup loads, then close the popup.
  context.on('page', async (popup) => {
    try {
      await popup.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {})
      const popupUrl = popup.url()
      if (popupUrl && popupUrl !== 'about:blank' && popup !== page) {
        await page.goto(popupUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
        await popup.close().catch(() => {})
      }
    } catch {}
  })

  const sites = await storage.listSites()
  const site = sites.find((s) => s.id === siteId)
  const targetUrl = options.startUrl ?? site?.url ?? 'about:blank'

  const cdp = await startScreencast(page, runId)
  emit('run:status', { runId, message: `Loading ${targetUrl}…` })
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
  emit('run:status', { runId, message: 'Waiting for page to finish loading…' })
  await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {})
  // brief settle for SPAs hydrating
  await page.waitForTimeout(500)
  emit('run:status', { runId, message: '' })
  const abort = new AbortController()

  const hardStop = async () => {
    await stopScreencast(cdp)
    await context.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
  }

  const handle: RunHandle = { cancelled: false, abort, hardStop }
  activeRuns.set(runId, handle)

  const ctx: ExecCtx = {
    runId, page, context, settings, runDir,
    usage: { inputTokens: 0, outputTokens: 0 },
    signal: abort.signal,
  }

  emit('run:start', { runId, testId: test.id, startedAt: run.startedAt })

  let cancelled = false
  try {
    for (let i = 0; i < test.steps.length; i++) {
      const step = test.steps[i]
      checkCancel(runId)
      // Between steps (not before the first), let the UI settle: wait for network quiet
      // then a small fixed delay for React/Vue re-render & CSS transitions.
      if (i > 0) {
        await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {})
        await page.waitForTimeout(500)
      }
      emit('run:step:start', { runId, stepId: step.id })
      const result = await executeStep(ctx, step)
      run.steps.push(result)
      emit('run:step:end', { runId, step: result })
      if (result.status === 'failed' && settings.runAll.onFailure === 'stop') break
    }
  } catch (e) {
    if (e instanceof CancelError) {
      cancelled = true
    } else {
      throw e
    }
  } finally {
    await hardStop()
    activeRuns.delete(runId)
  }

  const anyFail = run.steps.some((s) => s.status === 'failed')
  run.status = cancelled ? 'failed' : (anyFail ? 'failed' : 'passed')
  run.finishedAt = new Date().toISOString()
  run.tokenUsage = {
    input: ctx.usage.inputTokens,
    output: ctx.usage.outputTokens,
    estimatedCostUsd: estimateCostUsd(
      settings.llm.default.model,
      ctx.usage.inputTokens,
      ctx.usage.outputTokens,
      settings.llm.default.provider
    ),
  }
  await storage.saveRun(siteId, run)
  emit('run:end', { runId, run, cancelled })
  return run
}

export async function runAllTests(siteId: string, settings: Settings): Promise<RunResult[]> {
  let tests = await storage.listTests(siteId)
  if (settings.runAll.randomOrder) {
    tests = [...tests].sort(() => Math.random() - 0.5)
  }
  if (tests.length === 0) return []

  if (settings.runAll.mode === 'parallel') {
    return runParallel(siteId, tests, settings)
  }
  // sequential
  const results: RunResult[] = []
  for (const t of tests) {
    const r = await runTest(siteId, t, settings)
    results.push(r)
    if (r.status === 'failed' && settings.runAll.onFailure === 'stop') break
  }
  return results
}

async function runParallel(siteId: string, tests: TestCase[], settings: Settings): Promise<RunResult[]> {
  const concurrency = Math.max(1, Math.min(settings.runAll.maxParallel || 1, tests.length))
  const results: RunResult[] = new Array(tests.length)
  let nextIdx = 0
  let stop = false

  async function worker() {
    while (!stop) {
      const i = nextIdx++
      if (i >= tests.length) return
      try {
        const r = await runTest(siteId, tests[i], settings)
        results[i] = r
        if (r.status === 'failed' && settings.runAll.onFailure === 'stop') {
          stop = true
        }
      } catch (e: any) {
        results[i] = {
          id: `run_err_${Date.now()}_${i}`,
          testId: tests[i].id,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          status: 'failed',
          steps: [],
          tokenUsage: { input: 0, output: 0, estimatedCostUsd: 0 },
        }
        if (settings.runAll.onFailure === 'stop') stop = true
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return results.filter(Boolean)
}
