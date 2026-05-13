import type { PlannedAction } from './actions'
import { parseJsonLoose } from './llm'

const VALID_ACTIONS = new Set<PlannedAction['action']>([
  'click', 'fill', 'press', 'navigate', 'select',
  'hover', 'check', 'uncheck', 'wait', 'noop', 'fail',
])

const STRING_FIELDS: (keyof PlannedAction)[] = ['role', 'name', 'selector', 'text', 'value', 'reason']

export function isValidPlannedAction(x: unknown): x is PlannedAction {
  if (!x || typeof x !== 'object') return false
  const a = x as Record<string, unknown>
  if (typeof a.action !== 'string') return false
  if (!VALID_ACTIONS.has(a.action as PlannedAction['action'])) return false
  for (const f of STRING_FIELDS) {
    if (a[f] != null && typeof a[f] !== 'string') return false
  }
  if (a.nth != null && (typeof a.nth !== 'number' || !Number.isFinite(a.nth))) return false
  if (a.force != null && typeof a.force !== 'boolean') return false
  // Verbs that need an element must carry a way to locate one.
  // navigate/press/wait/noop/fail are exempt — they don't bind to a DOM node.
  const needsLocator = new Set(['click', 'fill', 'select', 'hover', 'check', 'uncheck'])
  if (needsLocator.has(a.action as string) && !a.selector && !a.role) return false
  return true
}

export class InvalidPlanError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message)
    this.name = 'InvalidPlanError'
  }
}

// Parse a planner-LLM response into a list of actions. Throws InvalidPlanError
// with the offending payload attached when the LLM returns something we can't
// safely execute — better to fail loud than to silently click the wrong thing.
export function parseLLMPlan(raw: string): PlannedAction[] {
  let parsed: unknown
  try {
    parsed = parseJsonLoose<unknown>(raw)
  } catch (e: any) {
    throw new InvalidPlanError(`LLM returned non-JSON output: ${e?.message ?? e}`, raw)
  }
  if (parsed == null || typeof parsed !== 'object') {
    throw new InvalidPlanError('LLM plan must be a JSON object', raw)
  }

  const obj = parsed as Record<string, unknown>
  const candidates: unknown[] = Array.isArray(obj.actions) ? obj.actions : [obj]
  if (candidates.length === 0) {
    throw new InvalidPlanError('LLM plan contained an empty actions array', raw)
  }

  for (const c of candidates) {
    if (!isValidPlannedAction(c)) {
      throw new InvalidPlanError(`invalid action shape: ${JSON.stringify(c)}`, raw)
    }
  }
  return candidates as PlannedAction[]
}
