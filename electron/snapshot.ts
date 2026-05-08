import type { Page } from 'playwright'

export interface ClickableEl {
  selector: string
  description: string
  occluded?: boolean
  text?: string // disambiguator when selector alone matches multiple elements
}

export interface BlockingOverlay {
  selector: string
  description: string
}

export interface PageSnapshot {
  url: string
  title: string
  text: string // ARIA snapshot in YAML-ish format
  clickables: ClickableEl[] // DOM-discovered interactive elements (close buttons, modal masks, etc.)
  overlays: BlockingOverlay[] // big top-layer elements currently blocking interaction beneath
}

export async function snapshotPage(page: Page): Promise<PageSnapshot> {
  let text = ''
  try {
    text = await page.locator('body').ariaSnapshot()
  } catch {
    text = await page.locator('body').innerText().catch(() => '')
  }
  const MAX = 20000
  if (text.length > MAX) text = text.slice(0, MAX) + '\n…[truncated]'

  const { clickables, overlays } = await collectClickables(page).catch(() => ({ clickables: [], overlays: [] as BlockingOverlay[] }))

  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    text,
    clickables,
    overlays,
  }
}

async function collectClickables(page: Page): Promise<{ clickables: ClickableEl[]; overlays: BlockingOverlay[] }> {
  return page.evaluate(() => {
    const results: { selector: string; description: string; occluded: boolean; text?: string }[] = []
    const overlays: { selector: string; description: string }[] = []
    const seen = new WeakSet<Element>()

    function escapeCls(c: string) {
      return c.replace(/([^\w-])/g, '\\$1')
    }

    function uniqueSelector(el: Element): string {
      // prefer stable id
      if (el.id && !/^(radix-|aria-|react-|tw-|css-|headlessui-)[\w-]+/i.test(el.id)) {
        return `#${CSS.escape(el.id)}`
      }
      const testid = el.getAttribute('data-testid')
      if (testid) return `[data-testid="${testid}"]`
      const aria = el.getAttribute('aria-label')
      if (aria && aria.length < 40) return `${el.tagName.toLowerCase()}[aria-label="${aria.replace(/"/g, '\\"')}"]`

      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter((c) => c.length > 1) : []
      if (cls.length > 0) {
        // try most specific class first (longer / hashed class names tend to be unique)
        const sorted = [...cls].sort((a, b) => b.length - a.length)
        for (const c of sorted) {
          const sel = `${el.tagName.toLowerCase()}.${escapeCls(c)}`
          try {
            if (document.querySelectorAll(sel).length === 1) return sel
          } catch {}
        }
        // 2-class combo
        for (let i = 0; i < sorted.length; i++) {
          for (let j = i + 1; j < sorted.length; j++) {
            const sel = `${el.tagName.toLowerCase()}.${escapeCls(sorted[i])}.${escapeCls(sorted[j])}`
            try {
              if (document.querySelectorAll(sel).length === 1) return sel
            } catch {}
          }
        }
        return `${el.tagName.toLowerCase()}.${escapeCls(sorted[0])}`
      }
      return ''
    }

    function describe(el: Element): string {
      const tag = el.tagName.toLowerCase()
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
      const aria = el.getAttribute('aria-label')
      const title = el.getAttribute('title')
      const role = el.getAttribute('role')
      const cls = typeof el.className === 'string' ? el.className : ''
      const hintCls = cls.split(/\s+/).filter((c) =>
        /close|modal|overlay|backdrop|mask|dialog|cancel|dismiss|btn|button|menu|toggle|drawer/i.test(c)
      ).slice(0, 3).join(' ')
      const imgs = Array.from(el.querySelectorAll('img, svg')).slice(0, 1)
      const iconHint = imgs.length > 0 ? (imgs[0].getAttribute('alt') || imgs[0].getAttribute('src') || imgs[0].tagName.toLowerCase()) : ''
      let pos = ''
      try {
        const r = (el as HTMLElement).getBoundingClientRect()
        const w = window.innerWidth, h = window.innerHeight
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2
        const horiz = cx < w / 3 ? 'left' : cx > (2 * w) / 3 ? 'right' : 'center'
        const vert = cy < h / 3 ? 'top' : cy > (2 * h) / 3 ? 'bottom' : 'mid'
        pos = `${vert}-${horiz}`
        if (r.width >= w * 0.9 && r.height >= h * 0.9) pos = 'fullscreen-overlay'
      } catch {}

      const parts: string[] = []
      if (text) parts.push(`text="${text}"`)
      if (aria) parts.push(`aria-label="${aria}"`)
      if (title) parts.push(`title="${title}"`)
      if (role) parts.push(`role="${role}"`)
      if (iconHint && !text) parts.push(`icon=${iconHint.split('/').pop()}`)
      if (hintCls) parts.push(`class~="${hintCls}"`)
      if (pos) parts.push(pos)
      return `${tag} ${parts.join(' ')}`.trim()
    }

    // Score: higher = more likely a real interactive target. Used for ranking + cap.
    function interactiveScore(el: Element): number {
      const tag = el.tagName
      if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return 100
      if (tag === 'LABEL' || tag === 'SUMMARY') return 70

      // explicit framework handlers (high confidence)
      if (el.hasAttribute('onclick')) return 90
      for (const key of Object.keys(el)) {
        if (key.startsWith('__reactProps$')) {
          const p = (el as any)[key]
          if (p && (typeof p.onClick === 'function' || typeof p.onMouseDown === 'function' || typeof p.onPointerDown === 'function')) return 90
        }
      }
      const vnode = (el as any).__vnode
      if (vnode && vnode.props && vnode.props.onClick != null) return 90

      const role = el.getAttribute('role')
      if (role && /^(button|link|menuitem|menuitemcheckbox|menuitemradio|option|tab|switch|checkbox|radio|treeitem)$/.test(role)) return 80

      const ti = el.getAttribute('tabindex')
      if (ti != null && ti !== '-1') return 70

      const cls = typeof el.className === 'string' ? el.className : ''
      const classMatch = /(modal-mask|backdrop|overlay|close|dismiss|cancel-btn|drawer-mask|itemButton|item-button|chip|tag-(?:item|button)|option(?:-item)?|tile|card(?:-button)?|menu-item|nav-item|selectable|toggle|swatch|thumb)/i.test(cls)
      if (classMatch) return 60

      // cursor:pointer fallback — but require visible text OR meaningful size to avoid noise
      try {
        const cs = window.getComputedStyle(el)
        if (cs.cursor !== 'pointer') return 0
        // skip if a parent is also cursor:pointer (delegate target is the parent)
        const parent = el.parentElement
        if (parent && window.getComputedStyle(parent).cursor === 'pointer') return 0
        const r = (el as HTMLElement).getBoundingClientRect()
        if (r.width < 24 || r.height < 24) return 0
        const text = (el.textContent || '').trim()
        if (text.length > 0) return 40
        // no text but reasonable size — could be icon button
        if (el.querySelector('img, svg')) return 35
        return 0
      } catch {}
      return 0
    }
    function isInteractive(el: Element): boolean {
      if (seen.has(el)) return false
      return interactiveScore(el) > 0
    }

    function isOccluded(el: Element): boolean {
      try {
        const r = (el as HTMLElement).getBoundingClientRect()
        if (r.width === 0 || r.height === 0) return true
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        // If the element's center is outside the viewport, elementFromPoint at a clamped
        // coordinate would test some other element and falsely report occlusion. Treat
        // off-screen elements as not-occluded — Playwright auto-scrolls into view on click.
        if (cx < 0 || cy < 0 || cx >= window.innerWidth || cy >= window.innerHeight) return false
        const top = document.elementFromPoint(cx, cy)
        if (!top) return true
        if (top === el) return false
        if (el.contains(top)) return false
        // also OK if the top element is an ancestor of el (rare but possible)
        if (top.contains(el)) return false
        return true
      } catch {
        return false
      }
    }

    const ranked: { score: number; el: Element; selector: string; description: string; occluded: boolean; text?: string }[] = []
    const all = document.body ? document.body.querySelectorAll('*') : []
    all.forEach((el) => {
      try {
        const score = interactiveScore(el)
        if (score === 0) return
        const r = (el as HTMLElement).getBoundingClientRect?.()
        if (r && (r.width === 0 || r.height === 0)) return
        const sel = uniqueSelector(el)
        if (!sel) return
        // detect when selector is non-unique → grab text content as disambiguator
        let text: string | undefined
        try {
          if (document.querySelectorAll(sel).length > 1) {
            const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)
            if (t) text = t
          }
        } catch {}
        const occluded = isOccluded(el)
        ranked.push({ score, el, selector: sel, description: describe(el), occluded, text })
        seen.add(el)
      } catch {}
    })
    // Sort: highest score first, occluded last, longer descriptions (more text) earlier
    ranked.sort((a, b) => {
      if (a.occluded !== b.occluded) return a.occluded ? 1 : -1
      if (b.score !== a.score) return b.score - a.score
      return b.description.length - a.description.length
    })
    for (const r of ranked) results.push({ selector: r.selector, description: r.description, occluded: r.occluded, ...(r.text ? { text: r.text } : {}) })

    // detect big blocking overlays currently on top of the page
    document.querySelectorAll('*').forEach((el) => {
      try {
        const cls = typeof el.className === 'string' ? el.className : ''
        if (!/modal-mask|backdrop|overlay|drawer-mask|scrim/i.test(cls)) return
        const r = (el as HTMLElement).getBoundingClientRect()
        // only count overlays covering > 30% of viewport
        if (r.width * r.height < window.innerWidth * window.innerHeight * 0.3) return
        const sel = uniqueSelector(el)
        if (sel) overlays.push({ selector: sel, description: describe(el) })
      } catch {}
    })

    // dedupe by selector+text (since same selector can correspond to multiple elements with different text)
    const map = new Map<string, { selector: string; description: string; occluded: boolean; text?: string }>()
    for (const r of results) {
      const key = r.text ? `${r.selector}|${r.text}` : r.selector
      if (!map.has(key)) map.set(key, r)
    }
    return {
      clickables: Array.from(map.values()).slice(0, 50),
      overlays: overlays.slice(0, 5),
    }
  })
}

export async function screenshotBase64(page: Page, fullPage: boolean): Promise<string> {
  const buf = await page.screenshot({ fullPage, type: 'png' })
  return buf.toString('base64')
}
