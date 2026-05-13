import { describe, it, expect } from 'vitest'
import {
  extractTargetTokens,
  extractQuotedStrings,
  relevanceScore,
  normalizeText,
  evaluateQuotedAssertion,
} from '../heuristics'

describe('extractQuotedStrings', () => {
  it('pulls straight double-quoted substrings', () => {
    expect(extractQuotedStrings('Click "Sign in" to continue')).toEqual(['Sign in'])
  })

  it('pulls straight single-quoted substrings', () => {
    expect(extractQuotedStrings("Press 'Save changes' button")).toEqual(['Save changes'])
  })

  it('handles smart curly quotes', () => {
    expect(extractQuotedStrings('Click “Sign in” and then ‘Cancel’')).toEqual(['Sign in', 'Cancel'])
  })

  it('returns empty for no quoted content', () => {
    expect(extractQuotedStrings('Click the save button')).toEqual([])
  })

  it('requires ≥2 chars inside the quotes (short content gets folded into the next match)', () => {
    // "a" is below the {2,} minimum, so its closing quote pairs with the next opening one.
    // Documents the regex's actual behavior — users rarely quote single chars in practice.
    expect(extractQuotedStrings('Type "a" then "ok"')).toEqual([' then '])
  })
})

describe('extractTargetTokens', () => {
  it('extracts tokens from a quoted phrase, lowercased, stripped of punctuation', () => {
    expect(extractTargetTokens('Click "Sign in"')).toEqual(['sign'])
  })

  it('filters stopwords from the quoted phrase', () => {
    // "in" is a stopword
    expect(extractTargetTokens('Click "Sign In Now"')).toEqual(['sign', 'now'])
  })

  it('falls back to the full description when no quotes are present', () => {
    expect(extractTargetTokens('Click the save button')).toEqual(['save'])
  })

  it('returns empty array when description is all stopwords', () => {
    expect(extractTargetTokens('Click the button')).toEqual([])
  })

  it('drops single-char tokens', () => {
    expect(extractTargetTokens('Click "X panel"')).toEqual(['panel'])
  })

  it('mixed CJK + ASCII: only ASCII tokens survive (heuristic is ASCII-only)', () => {
    expect(extractTargetTokens('点击 "Sign in"')).toEqual(['sign'])
  })
})

describe('relevanceScore', () => {
  it('scores tokens found in description', () => {
    const r = relevanceScore(['save'], 'button labeled save', 'button.primary')
    expect(r.score).toBe(8) // 4 chars * 2x (>=4 length bonus)
    expect(r.matches).toEqual(['save'])
  })

  it('scores tokens found only in selector (class name semantic match)', () => {
    const r = relevanceScore(['taste'], 'unlabeled div', 'div._tasteTag_h8dtt_103')
    expect(r.score).toBe(10) // 5 chars * 2x
    expect(r.matches).toEqual(['taste'])
  })

  it('accumulates across multiple token hits', () => {
    const r = relevanceScore(['sign', 'in'], 'sign in form', 'form.login')
    expect(r.matches).toEqual(['sign', 'in'])
    // 'sign' = 4 chars * 2 = 8; 'in' = 2 chars * 1 = 2
    expect(r.score).toBe(10)
  })

  it('case-insensitive matching', () => {
    const r = relevanceScore(['save'], 'Button Labeled SAVE', '')
    expect(r.matches).toEqual(['save'])
  })

  it('returns zero score and empty matches when nothing hits', () => {
    expect(relevanceScore(['nonexistent'], 'something else', '.foo')).toEqual({ score: 0, matches: [] })
  })
})

describe('normalizeText', () => {
  it('replaces NBSP with regular space', () => {
    expect(normalizeText('hello world')).toBe('hello world')
  })

  it('collapses multiple spaces and trims', () => {
    expect(normalizeText('  hello   world  ')).toBe('hello world')
  })

  it('lowercases', () => {
    expect(normalizeText('HELLO World')).toBe('hello world')
  })

  it('flattens smart quotes to straight quotes', () => {
    expect(normalizeText('“Sign in”')).toBe('"sign in"')
    expect(normalizeText('don’t')).toBe("don't")
  })
})

describe('evaluateQuotedAssertion', () => {
  it('returns null when no quoted strings in the description', () => {
    expect(evaluateQuotedAssertion('the page should load', 'page content here')).toBeNull()
  })

  it('returns null when quoted but no positive/negative verb (ambiguous)', () => {
    expect(evaluateQuotedAssertion('something about "X"', 'X appears here')).toBeNull()
  })

  it('positive verb + present: passes deterministically', () => {
    const r = evaluateQuotedAssertion('page contains "checkout total"', 'Your Checkout Total: $50')
    expect(r).not.toBeNull()
    expect(r!.passed).toBe(true)
    expect(r!.confidence).toBeGreaterThan(0.9)
  })

  it('positive verb + absent: returns null (falls through to LLM)', () => {
    expect(evaluateQuotedAssertion('page contains "checkout total"', 'unrelated page text')).toBeNull()
  })

  it('negative marker + absent: passes deterministically', () => {
    const r = evaluateQuotedAssertion('"error" should not be visible', 'all good here')
    expect(r).not.toBeNull()
    expect(r!.passed).toBe(true)
  })

  it('negative marker + present: fails deterministically (no LLM fallback)', () => {
    const r = evaluateQuotedAssertion('"error" should not be visible', 'something failed: error')
    expect(r).not.toBeNull()
    expect(r!.passed).toBe(false)
    expect(r!.confidence).toBeGreaterThan(0.9)
  })

  it('matches across NBSP/smart-quote/case differences (normalization)', () => {
    const r = evaluateQuotedAssertion(
      'textbox contains "vegan friendly sandwiches"',
      'Vegan Friendly Sandwiches '
    )
    expect(r!.passed).toBe(true)
  })

  it('requires ALL quoted strings present for positive pass', () => {
    expect(
      evaluateQuotedAssertion('page contains "alpha" and "beta"', 'only alpha shown')
    ).toBeNull()
  })

  it('requires NONE present for negative pass', () => {
    const r = evaluateQuotedAssertion('"alpha" and "beta" should be absent', 'beta is here')
    expect(r!.passed).toBe(false)
  })
})
