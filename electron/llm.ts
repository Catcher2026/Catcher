import type { LLMProviderConfig } from '../shared/types'

export type LLMRole = 'system' | 'user' | 'assistant'

export interface LLMContent {
  type: 'text' | 'image'
  text?: string
  imageBase64?: string // png, no data: prefix
}

export interface LLMMessage {
  role: LLMRole
  content: string | LLMContent[]
}

export interface LLMUsage {
  inputTokens: number
  outputTokens: number
}

export interface LLMResponse {
  text: string
  usage: LLMUsage
}

export interface LLMCompleteOptions {
  temperature?: number
  maxTokens?: number
  jsonOnly?: boolean
  signal?: AbortSignal
}

export interface LLMClient {
  config: LLMProviderConfig
  complete(messages: LLMMessage[], opts?: LLMCompleteOptions): Promise<LLMResponse>
}

export function createLLMClient(config: LLMProviderConfig): LLMClient {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicClient(config)
    case 'gemini':
      return new GeminiClient(config)
    default:
      // openai, local, custom — all OpenAI-compatible
      return new OpenAICompatClient(config)
  }
}

// ---------------- OpenAI-compatible ----------------

class OpenAICompatClient implements LLMClient {
  constructor(public config: LLMProviderConfig) {}

  async complete(messages: LLMMessage[], opts: LLMCompleteOptions = {}): Promise<LLMResponse> {
    const baseUrl = this.config.baseUrl?.replace(/\/$/, '') || 'https://api.openai.com/v1'
    const url = `${baseUrl}/chat/completions`

    const body: any = {
      model: this.config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? m.content
          : m.content.map((c) =>
              c.type === 'text'
                ? { type: 'text', text: c.text }
                : { type: 'image_url', image_url: { url: `data:image/png;base64,${c.imageBase64}` } }
            ),
      })),
      temperature: opts.temperature ?? 0,
      max_tokens: opts.maxTokens ?? 2000,
    }
    if (opts.jsonOnly) body.response_format = { type: 'json_object' }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: opts.signal })
    if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`)
    const data: any = await res.json()
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    }
  }
}

// ---------------- Anthropic ----------------

class AnthropicClient implements LLMClient {
  constructor(public config: LLMProviderConfig) {}

  async complete(messages: LLMMessage[], opts: LLMCompleteOptions = {}): Promise<LLMResponse> {
    const baseUrl = this.config.baseUrl?.replace(/\/$/, '') || 'https://api.anthropic.com'
    const url = `${baseUrl}/v1/messages`

    // Anthropic: system is separate, messages are user/assistant only
    let system = ''
    const msgs: any[] = []
    for (const m of messages) {
      if (m.role === 'system') {
        system = typeof m.content === 'string' ? m.content : (m.content.find((c) => c.type === 'text')?.text ?? '')
        continue
      }
      const content =
        typeof m.content === 'string'
          ? [{ type: 'text', text: m.content }]
          : m.content.map((c) =>
              c.type === 'text'
                ? { type: 'text', text: c.text }
                : { type: 'image', source: { type: 'base64', media_type: 'image/png', data: c.imageBase64 } }
            )
      msgs.push({ role: m.role, content })
    }

    const body: any = {
      model: this.config.model,
      max_tokens: opts.maxTokens ?? 2000,
      temperature: opts.temperature ?? 0,
      messages: msgs,
    }
    if (system) body.system = system

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    })
    if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`)
    const data: any = await res.json()
    const text = (data.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
    return {
      text,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
    }
  }
}

// ---------------- Gemini ----------------

class GeminiClient implements LLMClient {
  constructor(public config: LLMProviderConfig) {}

  async complete(messages: LLMMessage[], opts: LLMCompleteOptions = {}): Promise<LLMResponse> {
    const baseUrl =
      this.config.baseUrl?.replace(/\/$/, '') || 'https://generativelanguage.googleapis.com/v1beta'
    const url = `${baseUrl}/models/${encodeURIComponent(this.config.model)}:generateContent?key=${encodeURIComponent(this.config.apiKey ?? '')}`

    let systemInstruction: any = undefined
    const contents: any[] = []
    for (const m of messages) {
      if (m.role === 'system') {
        systemInstruction = { parts: [{ text: typeof m.content === 'string' ? m.content : (m.content.find((c) => c.type === 'text')?.text ?? '') }] }
        continue
      }
      const parts =
        typeof m.content === 'string'
          ? [{ text: m.content }]
          : m.content.map((c) =>
              c.type === 'text'
                ? { text: c.text }
                : { inline_data: { mime_type: 'image/png', data: c.imageBase64 } }
            )
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts })
    }

    const body: any = {
      contents,
      generationConfig: {
        temperature: opts.temperature ?? 0,
        maxOutputTokens: opts.maxTokens ?? 2000,
        responseMimeType: opts.jsonOnly ? 'application/json' : undefined,
      },
    }
    if (systemInstruction) body.systemInstruction = systemInstruction

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    })
    if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`)
    const data: any = await res.json()
    const text =
      (data.candidates?.[0]?.content?.parts ?? [])
        .map((p: any) => p.text ?? '')
        .join('') ?? ''
    return {
      text,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    }
  }
}

// Strip markdown fences from JSON output if present
export function parseJsonLoose<T = any>(text: string): T {
  let t = text.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  }
  // try to find first { ... last }
  const firstBrace = t.indexOf('{')
  const lastBrace = t.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    t = t.slice(firstBrace, lastBrace + 1)
  }
  return JSON.parse(t) as T
}
