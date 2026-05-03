import type { Page, Locator } from 'playwright'

export interface PlannedAction {
  action: 'click' | 'fill' | 'press' | 'navigate' | 'select' | 'hover' | 'check' | 'uncheck' | 'wait' | 'noop' | 'fail'
  role?: string      // ARIA role from snapshot
  name?: string      // accessible name
  selector?: string  // CSS selector
  text?: string      // disambiguator: when selector matches multiple elements, filter by visible text
  value?: string     // text for fill / option for select / key for press / url for navigate / ms for wait
  nth?: number       // disambiguate when multiple match
  force?: boolean    // bypass actionability checks
  reason?: string    // LLM rationale
}

function locatorFor(page: Page, action: PlannedAction): Locator | null {
  if (action.selector) {
    let loc = page.locator(action.selector)
    if (action.text) loc = loc.filter({ hasText: action.text })
    loc = action.nth != null ? loc.nth(action.nth) : loc.first()
    return loc
  }
  if (!action.role) return null
  const opts: any = action.name ? { name: action.name } : {}
  let loc = page.getByRole(action.role as any, opts)
  if (action.text) loc = loc.filter({ hasText: action.text })
  loc = action.nth != null ? loc.nth(action.nth) : loc.first()
  return loc
}

export async function executeAction(page: Page, action: PlannedAction, timeoutMs: number): Promise<void> {
  switch (action.action) {
    case 'noop':
      return
    case 'fail':
      throw new Error(action.reason || 'LLM marked step unreachable')
    case 'wait': {
      const ms = Math.min(action.value ? Number(action.value) || 1000 : 1000, 5000)
      await page.waitForTimeout(ms)
      return
    }
    case 'navigate':
      if (!action.value) throw new Error('navigate requires value (URL)')
      await page.goto(action.value, { timeout: timeoutMs })
      return
    case 'press':
      await page.keyboard.press(action.value || 'Enter')
      return
  }
  const loc = locatorFor(page, action)
  if (!loc) throw new Error(`Could not resolve element for action ${JSON.stringify(action)}`)
  switch (action.action) {
    case 'click': {
      try {
        await loc.click({ timeout: timeoutMs, force: action.force })
      } catch (e: any) {
        const msg = e?.message ?? ''
        // Common case: clicking a fullscreen overlay (modal-mask) whose center is covered by the modal panel.
        // Retry at top-left corner where no panel sits, with force to bypass actionability checks.
        if (/intercepts pointer events|Timeout|not stable/i.test(msg)) {
          try {
            await loc.click({ timeout: timeoutMs, force: true, position: { x: 5, y: 5 } })
            return
          } catch {
            // try bottom-right corner as last resort
            const box = await loc.boundingBox().catch(() => null)
            if (box) {
              await loc.click({ timeout: timeoutMs, force: true, position: { x: Math.max(5, box.width - 5), y: Math.max(5, box.height - 5) } })
              return
            }
          }
        }
        throw e
      }
      return
    }
    case 'fill':    await loc.fill(action.value ?? '', { timeout: timeoutMs, force: action.force }); return
    case 'select':  await loc.selectOption(action.value ?? '', { timeout: timeoutMs }); return
    case 'hover':   await loc.hover({ timeout: timeoutMs }); return
    case 'check':   await loc.check({ timeout: timeoutMs }); return
    case 'uncheck': await loc.uncheck({ timeout: timeoutMs }); return
  }
}
