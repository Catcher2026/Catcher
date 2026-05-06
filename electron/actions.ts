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
        return
      } catch (e: any) {
        const msg = e?.message ?? ''

        // Backdrop-like selectors (modal-mask): the panel covers the center of the mask,
        // so click a corner that's outside the panel.
        const isOverlaySelector = !!action.selector && /modal[-_]?mask|backdrop|overlay|drawer[-_]?mask|scrim/i.test(action.selector)
        if (isOverlaySelector && /intercepts pointer events/i.test(msg)) {
          try {
            await loc.click({ timeout: timeoutMs, force: true, position: { x: 5, y: 5 } })
            return
          } catch {
            const box = await loc.boundingBox().catch(() => null)
            if (box) {
              try {
                await loc.click({ timeout: timeoutMs, force: true, position: { x: Math.max(5, box.width - 5), y: Math.max(5, box.height - 5) } })
                return
              } catch {}
            }
          }
        }

        // Native DOM click via page.evaluate, identifying the element by selector + optional
        // visible-text filter. This bypasses two failure modes simultaneously:
        //   1. CSS occlusion — a dropdown/tooltip/animation covering the button intercepts
        //      real pointer events (Playwright's mouse click) but not native HTMLElement.click().
        //   2. Playwright's stuck locator state — after a 5s timeout, loc.elementHandle() may
        //      still be waiting; raw document.querySelectorAll resolves immediately.
        // The text filter is critical when the selector is non-unique: it ensures we click the
        // button with the expected label rather than the first DOM match (which could be an
        // unrelated button on the page behind the modal).
        if (action.selector) {
          const clicked = await page
            .evaluate(
              ({ selector, text }: { selector: string; text?: string }) => {
                try {
                  const matches = Array.from(document.querySelectorAll(selector))
                  const candidates = text
                    ? matches.filter((el) => {
                        const t = ((el as HTMLElement).innerText || el.textContent || '').toLowerCase()
                        return t.includes(text.toLowerCase())
                      })
                    : matches
                  const target = candidates[0] as HTMLElement | undefined
                  if (!target) return false
                  if (typeof target.click === 'function') target.click()
                  else target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window as Window }))
                  return true
                } catch {
                  return false
                }
              },
              { selector: action.selector, text: action.text }
            )
            .catch(() => false)
          if (clicked) return
        } else {
          // Role+name only — use elementHandle to get the underlying DOM node.
          const handle = await loc.elementHandle({ timeout: 1000 }).catch(() => null)
          if (handle) {
            try {
              await handle.evaluate((el: any) => {
                if (typeof el.click === 'function') el.click()
                else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
              })
              return
            } finally {
              await handle.dispose().catch(() => {})
            }
          }
        }
        throw e
      }
    }
    case 'fill':    await loc.fill(action.value ?? '', { timeout: timeoutMs, force: action.force }); return
    case 'select':  await loc.selectOption(action.value ?? '', { timeout: timeoutMs }); return
    case 'hover':   await loc.hover({ timeout: timeoutMs }); return
    case 'check':   await loc.check({ timeout: timeoutMs }); return
    case 'uncheck': await loc.uncheck({ timeout: timeoutMs }); return
  }
}
