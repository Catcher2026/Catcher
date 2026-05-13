// Pure helpers that don't touch Playwright or the LLM. Extracted so they can be
// unit-tested in isolation — changes here are the most common source of subtle
// "clicked the wrong element" regressions.

const STOPWORDS = new Set([
  'the', 'a', 'an', 'click', 'press', 'tap', 'select', 'choose', 'pick',
  'on', 'to', 'and', 'or', 'in', 'of', 'is', 'are', 'this', 'that',
  'these', 'those', 'with', 'from', 'for', 'at', 'by',
  'button', 'link', 'tab', 'item', 'option', 'page', 'field', 'box',
  'open', 'close', 'go', 'navigate', 'verify', 'check', 'ensure', 'make',
  'sure', 'should', 'must', 'will', 'be', 'has', 'have',
])

const QUOTED_RE = /['"‘’“”]([^'"‘’“”\n]{2,})['"‘’“”]/g

export function extractQuotedStrings(desc: string): string[] {
  return Array.from(desc.matchAll(QUOTED_RE), (m) => m[1])
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w))
}

export function extractTargetTokens(desc: string): string[] {
  const quoted = extractQuotedStrings(desc)
  if (quoted.length > 0) return tokenize(quoted.join(' '))
  return tokenize(desc)
}

export function relevanceScore(
  targetTokens: string[],
  description: string,
  selector: string
): { score: number; matches: string[] } {
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

export function normalizeText(s: string): string {
  return s
    .replace(/ /g, ' ')           // NBSP → space
    .replace(/[‘’]/g, "'")   // smart single quotes
    .replace(/[“”]/g, '"')   // smart double quotes
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// Given an assertion description and the page text, return a deterministic
// pass/fail when the assertion is a quoted-substring claim ("contains 'X'" /
// "'X' should not exist"). Returns null when the assertion isn't a shape we
// can answer without the LLM.
export function evaluateQuotedAssertion(
  description: string,
  pageText: string
): { passed: boolean; confidence: number; reason: string } | null {
  const quoted = extractQuotedStrings(description)
  if (quoted.length === 0) return null

  const positiveVerb = /\b(contain|contains|has|have|show|shows|display|displays|include|includes|present|visible|equal|equals|reads?|says?|exist|exists)\b/i.test(description)
  const negativeMarker = /\b(not|n['o]t|never|missing|absent|hidden|removed|gone|disappear(?:ed|s)?|no\s+longer)\b/i.test(description)

  if (!positiveVerb && !negativeMarker) return null

  const normPage = normalizeText(pageText)
  const presence = quoted.map((q) => ({ q, found: normPage.includes(normalizeText(q)) }))

  if (negativeMarker) {
    const noneFound = presence.every((p) => !p.found)
    if (noneFound) {
      return {
        passed: true,
        confidence: 0.99,
        reason: `[deterministic] None of the asserted strings present in page text/inputs/attributes: ${quoted.map((q) => `"${q}"`).join(', ')}`,
      }
    }
    const present = presence.filter((p) => p.found).map((p) => `"${p.q}"`)
    return {
      passed: false,
      confidence: 0.99,
      reason: `[deterministic] Asserted-absent string(s) actually present in page: ${present.join(', ')}`,
    }
  }

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
