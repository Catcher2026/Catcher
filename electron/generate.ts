import { chromium, firefox, webkit } from 'playwright'
import type { BrowserType } from 'playwright'
import { promises as fs } from 'node:fs'
import * as storage from './storage'
import { createLLMClient, parseJsonLoose, type LLMMessage } from './llm'
import { snapshotPage, screenshotBase64 } from './snapshot'
import type { Settings, TestCase, TestStep, StepType } from '../shared/types'

function uid(p: string) { return `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }

function pickBrowser(name: string): BrowserType {
  if (name === 'firefox') return firefox
  if (name === 'webkit') return webkit
  return chromium
}

export async function generateTest(
  siteId: string,
  description: string,
  settings: Settings,
  authProfileId?: string
): Promise<TestCase> {
  const sites = await storage.listSites()
  const site = sites.find((s) => s.id === siteId)
  if (!site) throw new Error('Site not found')

  // open page (with auth profile if provided)
  const browser = pickBrowser(settings.engine.browser)
  const launchOpts = { headless: true }
  let context, br
  if (authProfileId) {
    const dir = storage.authProfileDir(siteId, authProfileId)
    await fs.mkdir(dir, { recursive: true })
    context = await browser.launchPersistentContext(dir, { ...launchOpts, viewport: settings.engine.viewport })
  } else {
    br = await browser.launch(launchOpts)
    context = await br.newContext({ viewport: settings.engine.viewport })
  }

  try {
    const page = await context.newPage()
    await page.goto(site.url, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(1500)

    const snap = await snapshotPage(page)
    const shot = await screenshotBase64(page, false).catch(() => null)

    const client = createLLMClient(settings.llm.generator ?? settings.llm.default)
    const sys = `You generate web test cases. Given a user description and a snapshot of the target site, output a JSON test plan.

Output schema:
{
  "name": "<short test name>",
  "steps": [
    { "type": "act" | "assert" | "wait", "description": "<imperative natural-language step>" }
  ]
}

═══ CRITICAL — STEP DESCRIPTION FORMAT ═══

The downstream executor uses a quoted-text matcher. ANY literal string the user would see on the page OR type into a field MUST be wrapped in single quotes ('). Unquoted literals make matching brittle and frequently fail.

Act step pattern: <verb> <quoted literal if any> in/on the <element description>

  ✅ Click the 'Add to cart' button
  ✅ Click the 'Forgot password?' link
  ✅ Type 'I want some more' in the "ask a follow-up" textbox
  ✅ Type 'test@example.com' in the email field
  ✅ Fill the password field with 'hunter2'
  ✅ Select 'United States' from the country dropdown
  ✅ Press Escape
  ✅ Hover over the user avatar
  ✅ Check the 'I agree to terms' checkbox

  ❌ Click Save                           — must be: Click the 'Save' button
  ❌ Type I want some more in the textbox — must be: Type 'I want some more' in the "ask a follow-up" textbox
  ❌ Click Add address                    — must be: Click the 'Add address' button

Assert step pattern: Verify the <subject> <verb> '<expected literal>'

  ✅ Verify the page contains 'Order placed successfully'
  ✅ Verify the URL contains '/dashboard'
  ✅ Verify the heading shows 'Welcome back'
  ✅ Verify the 'Sign in' button is not visible
  ✅ Verify the cart badge shows '1'

  ❌ Verify success message       — must quote the exact text
  ❌ Verify the total is correct  — must quote the exact total

Wait step: { "type": "wait", "description": "<seconds as a number string>" }
  Use sparingly — only when a slow API/animation needs explicit settle time. The executor already waits for network-idle between steps.
  ✅ { "type": "wait", "description": "2" }

═══ GENERAL RULES ═══

- One atomic action per step. Break "Add address X and confirm" into three steps.
- Always quote any literal text the user types or that the page renders.
- For icon-only buttons with no visible text, describe by role/position: "Click the close button", "Click the hamburger menu".
- For category targets (no specific label): "Click the first product card", "Pick any available time slot".
- Mix Act and Assert. End with at least one Assert that uses quoted text where possible.
- Max ${settings.generation.maxStepsPerGeneration} steps.
- Output ONLY the JSON object. No prose, no markdown, no code fences.`

    const userParts: any[] = [
      { type: 'text', text: `User goal: ${description}\n\nSite URL: ${site.url}\nPage title: ${snap.title}\n\nAccessibility tree:\n${snap.text}` },
    ]
    if (shot) userParts.push({ type: 'image', imageBase64: shot })

    const messages: LLMMessage[] = [
      { role: 'system', content: sys },
      { role: 'user', content: userParts },
    ]
    const res = await client.complete(messages, {
      temperature: settings.llm.temperature,
      maxTokens: 1500,
      jsonOnly: true,
    })

    const parsed = parseJsonLoose<{ name: string; steps: { type: StepType; description: string }[] }>(res.text)
    const now = new Date().toISOString()
    const test: TestCase = {
      id: uid('test'),
      name: parsed.name || description.slice(0, 60) || 'Generated test',
      createdAt: now,
      updatedAt: now,
      steps: (parsed.steps ?? []).slice(0, settings.generation.maxStepsPerGeneration).map<TestStep>((s) => ({
        id: uid('step'),
        type: (s.type === 'login' || s.type === 'assert' || s.type === 'wait' ? s.type : 'act'),
        description: s.description,
      })),
    }
    return test
  } finally {
    await context.close().catch(() => {})
    if (br) await br.close().catch(() => {})
  }
}
