// Rough per-1M-token USD pricing. Override via custom endpoints if needed.
// Used only for cost estimation in run results — not for billing.

interface Price { input: number; output: number }

const TABLE: Array<{ match: RegExp; price: Price }> = [
  // OpenAI
  { match: /gpt-4o-mini/i, price: { input: 0.15, output: 0.60 } },
  { match: /gpt-4o/i, price: { input: 2.50, output: 10.00 } },
  { match: /gpt-4\.1-mini/i, price: { input: 0.40, output: 1.60 } },
  { match: /gpt-4\.1/i, price: { input: 2.00, output: 8.00 } },
  { match: /o1-mini/i, price: { input: 1.10, output: 4.40 } },
  { match: /o1/i, price: { input: 15.00, output: 60.00 } },
  // Anthropic
  { match: /opus/i, price: { input: 15.00, output: 75.00 } },
  { match: /sonnet/i, price: { input: 3.00, output: 15.00 } },
  { match: /haiku/i, price: { input: 0.80, output: 4.00 } },
  // Gemini
  { match: /gemini.*flash/i, price: { input: 0.075, output: 0.30 } },
  { match: /gemini.*pro/i, price: { input: 1.25, output: 10.00 } },
]

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number, providerHint?: string): number {
  if (providerHint === 'local') return 0
  const entry = TABLE.find((t) => t.match.test(model))
  if (!entry) return 0
  return (inputTokens * entry.price.input + outputTokens * entry.price.output) / 1_000_000
}
