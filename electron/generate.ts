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
    { "type": "act"    | "assert", "description": "<imperative natural-language step>" }
  ]
}

Rules:
- Each step is one atomic action ("Click X", "Type Y in Z") or one assertion ("Verify W is visible").
- Mix Act and Assert. End with at least one Assert.
- Use plain English the executing agent will translate to Playwright actions later.
- Max ${settings.generation.maxStepsPerGeneration} steps.
- Output ONLY the JSON object. No prose, no markdown.`

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
        type: (s.type === 'login' || s.type === 'assert' ? s.type : 'act'),
        description: s.description,
      })),
    }
    return test
  } finally {
    await context.close().catch(() => {})
    if (br) await br.close().catch(() => {})
  }
}
