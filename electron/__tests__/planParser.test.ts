import { describe, it, expect } from 'vitest'
import { parseLLMPlan, isValidPlannedAction, InvalidPlanError } from '../planParser'

describe('isValidPlannedAction', () => {
  it('accepts a minimal click action with role', () => {
    expect(isValidPlannedAction({ action: 'click', role: 'button', name: 'Sign in' })).toBe(true)
  })

  it('accepts a click with selector + text disambiguator', () => {
    expect(isValidPlannedAction({ action: 'click', selector: 'button.save', text: 'Save' })).toBe(true)
  })

  it('accepts a navigate without selector or role (verb is exempt)', () => {
    expect(isValidPlannedAction({ action: 'navigate', value: 'https://example.com' })).toBe(true)
  })

  it('accepts press, wait, noop, fail without a locator', () => {
    expect(isValidPlannedAction({ action: 'press', value: 'Enter' })).toBe(true)
    expect(isValidPlannedAction({ action: 'wait', value: '500' })).toBe(true)
    expect(isValidPlannedAction({ action: 'noop' })).toBe(true)
    expect(isValidPlannedAction({ action: 'fail', reason: 'cannot find target' })).toBe(true)
  })

  it('rejects unknown action verbs', () => {
    expect(isValidPlannedAction({ action: 'teleport', selector: 'a' })).toBe(false)
  })

  it('rejects click without selector OR role (would have nothing to locate)', () => {
    expect(isValidPlannedAction({ action: 'click', name: 'Save' })).toBe(false)
  })

  it('rejects fill without locator', () => {
    expect(isValidPlannedAction({ action: 'fill', value: 'hello' })).toBe(false)
  })

  it('rejects when a string field has the wrong type', () => {
    expect(isValidPlannedAction({ action: 'click', selector: 123 })).toBe(false)
  })

  it('rejects when nth is not a finite number', () => {
    expect(isValidPlannedAction({ action: 'click', selector: 'a', nth: 'first' })).toBe(false)
    expect(isValidPlannedAction({ action: 'click', selector: 'a', nth: NaN })).toBe(false)
  })

  it('rejects non-objects', () => {
    expect(isValidPlannedAction(null)).toBe(false)
    expect(isValidPlannedAction('click')).toBe(false)
    expect(isValidPlannedAction(42)).toBe(false)
  })
})

describe('parseLLMPlan', () => {
  it('wraps a single action object in an array', () => {
    const raw = JSON.stringify({ action: 'click', role: 'button', name: 'Sign in' })
    const out = parseLLMPlan(raw)
    expect(out).toHaveLength(1)
    expect(out[0].action).toBe('click')
    expect(out[0].name).toBe('Sign in')
  })

  it('unwraps an actions array', () => {
    const raw = JSON.stringify({
      actions: [
        { action: 'press', value: 'Escape' },
        { action: 'click', selector: 'button.save' },
      ],
    })
    const out = parseLLMPlan(raw)
    expect(out).toHaveLength(2)
    expect(out[0].action).toBe('press')
    expect(out[1].selector).toBe('button.save')
  })

  it('tolerates markdown code fences around JSON (parseJsonLoose strips them)', () => {
    const raw = '```json\n{"action":"click","selector":"button.x"}\n```'
    const out = parseLLMPlan(raw)
    expect(out[0].selector).toBe('button.x')
  })

  it('tolerates leading prose before JSON object', () => {
    const raw = 'Here is the plan: {"action":"click","selector":"a"}'
    const out = parseLLMPlan(raw)
    expect(out[0].action).toBe('click')
  })

  it('throws InvalidPlanError on non-JSON garbage', () => {
    expect(() => parseLLMPlan('not json at all')).toThrow(InvalidPlanError)
  })

  it('parseJsonLoose unwraps to the first {...} block when wrapped in an array', () => {
    // parseJsonLoose slices to first '{' .. last '}', so a top-level array
    // becomes its inner object. Locks in the lenient behavior — if the LLM
    // accidentally wraps its plan in [...], we still get a usable action.
    const out = parseLLMPlan('[{"action":"click","selector":"a"}]')
    expect(out).toHaveLength(1)
    expect(out[0].action).toBe('click')
  })

  it('throws when the action verb is unknown', () => {
    const raw = JSON.stringify({ action: 'summon', selector: 'a' })
    expect(() => parseLLMPlan(raw)).toThrow(InvalidPlanError)
  })

  it('throws when a click is missing both selector and role', () => {
    const raw = JSON.stringify({ action: 'click', name: 'Save' })
    expect(() => parseLLMPlan(raw)).toThrow(InvalidPlanError)
  })

  it('throws when any action in a multi-action plan is invalid', () => {
    const raw = JSON.stringify({
      actions: [
        { action: 'click', selector: 'button.save' },
        { action: 'click', selector: 123 }, // wrong type
      ],
    })
    expect(() => parseLLMPlan(raw)).toThrow(InvalidPlanError)
  })

  it('throws on an empty actions array', () => {
    expect(() => parseLLMPlan('{"actions": []}')).toThrow(InvalidPlanError)
  })

  it('attaches the raw payload to InvalidPlanError for diagnostics', () => {
    try {
      parseLLMPlan('not json')
      throw new Error('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidPlanError)
      expect((e as InvalidPlanError).raw).toBe('not json')
    }
  })
})
