import { useEffect, useState } from 'react'
import { useApp } from '../store'
import type { Settings, LLMProvider } from '@shared/types'

const PROVIDERS: { value: LLMProvider; label: string; defaultModel: string; defaultBaseUrl?: string }[] = [
  { value: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o-mini' },
  { value: 'anthropic', label: 'Anthropic (Claude)', defaultModel: 'claude-sonnet-4-6' },
  { value: 'gemini', label: 'Google (Gemini)', defaultModel: 'gemini-3-pro' },
  { value: 'local', label: 'Local (Ollama / LM Studio)', defaultModel: 'qwen2.5:32b', defaultBaseUrl: 'http://localhost:11434/v1' },
  { value: 'custom', label: 'Custom (OpenAI-compatible)', defaultModel: '' },
]

interface ModelOption {
  id: string           // model id sent to the API
  label: string        // display name in dropdown
  provider: LLMProvider
  vision: boolean
}

// Popular hosted models grouped by provider. Vision-capable models get a "(supports screenshot)"
// suffix so users know which ones can drive the runner's image-based fallbacks.
const HOSTED_MODELS: ModelOption[] = [
  // OpenAI
  { id: 'gpt-4o-mini',       label: 'GPT-4o mini',  provider: 'openai',    vision: true },
  { id: 'gpt-4o',            label: 'GPT-4o',       provider: 'openai',    vision: true },
  { id: 'gpt-5',             label: 'GPT-5',        provider: 'openai',    vision: true },
  { id: 'gpt-5-mini',        label: 'GPT-5 mini',   provider: 'openai',    vision: true },
  { id: 'gpt-5.4',           label: 'GPT-5.4',      provider: 'openai',    vision: true },
  { id: 'o1',                label: 'o1',           provider: 'openai',    vision: true },
  // Anthropic
  { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  provider: 'anthropic', vision: true },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', vision: true },
  { id: 'claude-opus-4-7',   label: 'Claude Opus 4.7',   provider: 'anthropic', vision: true },
  // Google
  { id: 'gemini-3-pro',      label: 'Gemini 3 Pro',      provider: 'gemini', vision: true },
  { id: 'gemini-3.1-pro',    label: 'Gemini 3.1 Pro',    provider: 'gemini', vision: true },
  { id: 'gemini-2.5-pro',    label: 'Gemini 2.5 Pro',    provider: 'gemini', vision: true },
  { id: 'gemini-2.5-flash',  label: 'Gemini 2.5 Flash',  provider: 'gemini', vision: true },
]

const PROVIDER_GROUPS: { provider: LLMProvider; label: string }[] = [
  { provider: 'openai',    label: 'OpenAI' },
  { provider: 'anthropic', label: 'Anthropic (Claude)' },
  { provider: 'gemini',    label: 'Google (Gemini)' },
]

const SENTINEL_LOCAL = '__local__'
const SENTINEL_CUSTOM = '__custom__'

function modelKey(provider: LLMProvider, model: string): string {
  if (provider === 'local') return SENTINEL_LOCAL
  if (provider === 'custom') return SENTINEL_CUSTOM
  // Match against known hosted models; fall back to custom if the saved model
  // isn't in our list (so older configs don't get silently rewritten).
  const hit = HOSTED_MODELS.find((m) => m.provider === provider && m.id === model)
  return hit ? `${provider}:${model}` : SENTINEL_CUSTOM
}

export function SettingsModal() {
  const { showSettings, setShowSettings, settings, refreshSettings } = useApp()
  const [s, setS] = useState<Settings | null>(settings)

  useEffect(() => { setS(settings) }, [settings, showSettings])

  if (!showSettings || !s) return null

  async function save() {
    await window.nullprobe.saveSettings(s!)
    await refreshSettings()
    setShowSettings(false)
  }

  function patch<K extends keyof Settings>(key: K, value: Partial<Settings[K]>) {
    setS({ ...s!, [key]: { ...(s![key] as object), ...value } } as Settings)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-6">
      <div className="card w-full max-w-3xl max-h-full flex flex-col">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="font-semibold">Settings</div>
          <button className="text-muted hover:text-fg" onClick={() => setShowSettings(false)}>✕</button>
        </div>
        <div className="flex-1 overflow-auto p-5 space-y-6">

          <Section title="LLM provider">
            <Row label="Model">
              <select
                className="input"
                value={modelKey(s.llm.default.provider, s.llm.default.model)}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === SENTINEL_LOCAL) {
                    const def = PROVIDERS.find((p) => p.value === 'local')!
                    patch('llm', { default: {
                      ...s.llm.default,
                      provider: 'local',
                      model: s.llm.default.provider === 'local' ? s.llm.default.model : def.defaultModel,
                      baseUrl: s.llm.default.baseUrl || def.defaultBaseUrl,
                    } })
                    return
                  }
                  if (v === SENTINEL_CUSTOM) {
                    patch('llm', { default: {
                      ...s.llm.default,
                      provider: 'custom',
                      model: s.llm.default.provider === 'custom' ? s.llm.default.model : '',
                      baseUrl: s.llm.default.baseUrl ?? '',
                    } })
                    return
                  }
                  // hosted model: "provider:model-id"
                  const [providerStr, ...rest] = v.split(':')
                  const modelId = rest.join(':')
                  patch('llm', { default: {
                    ...s.llm.default,
                    provider: providerStr as LLMProvider,
                    model: modelId,
                    baseUrl: undefined,
                  } })
                }}
              >
                {PROVIDER_GROUPS.map((g) => (
                  <optgroup key={g.provider} label={g.label}>
                    {HOSTED_MODELS.filter((m) => m.provider === g.provider).map((m) => (
                      <option key={`${m.provider}:${m.id}`} value={`${m.provider}:${m.id}`}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <optgroup label="Self-hosted">
                  <option value={SENTINEL_LOCAL}>Local (Ollama / LM Studio)</option>
                  <option value={SENTINEL_CUSTOM}>Custom (OpenAI-compatible endpoint)</option>
                </optgroup>
              </select>
            </Row>
            {s.llm.default.provider !== 'local' && (
              <Row label="API key">
                <input type="password" className="input" placeholder="sk-…" value={s.llm.default.apiKey ?? ''} onChange={(e) => patch('llm', { default: { ...s.llm.default, apiKey: e.target.value } })} />
              </Row>
            )}
            {s.llm.default.provider === 'local' && (
              <>
                <Row label="Model name *">
                  <input
                    className="input"
                    placeholder="qwen2.5:32b"
                    value={s.llm.default.model}
                    onChange={(e) => patch('llm', { default: { ...s.llm.default, model: e.target.value } })}
                  />
                </Row>
                <Row label="Endpoint URL *">
                  <input
                    className="input"
                    placeholder="http://localhost:11434/v1"
                    value={s.llm.default.baseUrl ?? ''}
                    onChange={(e) => patch('llm', { default: { ...s.llm.default, baseUrl: e.target.value } })}
                  />
                </Row>
                <p className="text-xs text-muted -mt-1">
                  Point this at any local OpenAI-compatible server. Defaults: Ollama <code>http://localhost:11434/v1</code>, LM Studio <code>http://localhost:1234/v1</code>. No API key required.
                </p>
              </>
            )}
            {s.llm.default.provider === 'custom' && (
              <>
                <Row label="Endpoint URL *">
                  <input
                    className="input"
                    placeholder="https://api.example.com/v1"
                    value={s.llm.default.baseUrl ?? ''}
                    onChange={(e) => patch('llm', { default: { ...s.llm.default, baseUrl: e.target.value, model: s.llm.default.model || 'default' } })}
                  />
                </Row>
                <p className="text-xs text-muted -mt-1">
                  Any OpenAI-compatible <code>/chat/completions</code> endpoint. Paste the full base URL — the target model is determined by your endpoint. Vision support depends on what the endpoint serves.
                </p>
              </>
            )}
            <Row label="Temperature"><input type="number" step="0.1" min="0" max="2" className="input" value={s.llm.temperature} onChange={(e) => patch('llm', { temperature: +e.target.value })} /></Row>
            <Row label="Max tokens"><input type="number" className="input" value={s.llm.maxTokens} onChange={(e) => patch('llm', { maxTokens: +e.target.value })} /></Row>
          </Section>

          <Section title="Execution engine">
            <Toggle label="Headless mode (browser hidden in background)" value={s.engine.headless} onChange={(v) => patch('engine', { headless: v })} />
            <p className="text-xs text-muted -mt-1">On = no popup, you watch via the live preview in the test drawer. Off = real browser window opens (useful for debugging).</p>
            <Row label="Browser">
              <select className="input" value={s.engine.browser} onChange={(e) => patch('engine', { browser: e.target.value as any })}>
                <option value="chromium">Chromium</option>
                <option value="firefox">Firefox</option>
                <option value="webkit">WebKit</option>
              </select>
            </Row>
            <Row label="Action timeout (ms)"><input type="number" className="input" value={s.engine.actionTimeoutMs} onChange={(e) => patch('engine', { actionTimeoutMs: +e.target.value })} /></Row>
            <Row label="Navigation timeout (ms)"><input type="number" className="input" value={s.engine.navigationTimeoutMs} onChange={(e) => patch('engine', { navigationTimeoutMs: +e.target.value })} /></Row>
            <Row label="Slow motion (ms)"><input type="number" className="input" value={s.engine.slowMoMs} onChange={(e) => patch('engine', { slowMoMs: +e.target.value })} /></Row>
            <Toggle label="Fallback to vision when DOM locator fails" value={s.engine.fallbackToVision} onChange={(v) => patch('engine', { fallbackToVision: v })} />
          </Section>

          <Section title="Assertion verification">
            <Row label={`Confidence threshold (${s.assert.confidenceThreshold.toFixed(2)})`}>
              <input type="range" min="0" max="1" step="0.05" value={s.assert.confidenceThreshold} onChange={(e) => patch('assert', { confidenceThreshold: +e.target.value })} className="w-full" />
            </Row>
            <p className="text-xs text-muted -mt-2">LLM judgements below this confidence are marked “needs review” instead of auto-failing.</p>
            <Toggle label="Send screenshot to LLM" value={s.assert.sendScreenshot} onChange={(v) => patch('assert', { sendScreenshot: v })} />
            <p className="text-xs text-muted -mt-1">All pre-defined models above support screenshots. A Custom endpoint may not — if its target model lacks vision, the screenshot is ignored and accuracy drops.</p>
            <Toggle label="Send accessibility tree" value={s.assert.sendA11yTree} onChange={(v) => patch('assert', { sendA11yTree: v })} />
            <Toggle label="Send full HTML (more accurate, more tokens)" value={s.assert.sendFullHtml} onChange={(v) => patch('assert', { sendFullHtml: v })} />
            <Toggle label="Send network log" value={s.assert.sendNetworkLog} onChange={(v) => patch('assert', { sendNetworkLog: v })} />
            <Toggle label="Full-page screenshot" value={s.assert.fullPageScreenshot} onChange={(v) => patch('assert', { fullPageScreenshot: v })} />
          </Section>

          <Section title="Run all / suite">
            <Row label="Mode">
              <select className="input" value={s.runAll.mode} onChange={(e) => patch('runAll', { mode: e.target.value as any })}>
                <option value="sequential">Sequential</option>
                <option value="parallel">Parallel</option>
              </select>
            </Row>
            <Row label="Max parallel"><input type="number" className="input" value={s.runAll.maxParallel} onChange={(e) => patch('runAll', { maxParallel: +e.target.value })} /></Row>
            <Row label="On failure">
              <select className="input" value={s.runAll.onFailure} onChange={(e) => patch('runAll', { onFailure: e.target.value as any })}>
                <option value="continue">Continue all</option>
                <option value="stop">Stop on first failure</option>
              </select>
            </Row>
            <Row label="Context isolation">
              <select className="input" value={s.runAll.contextIsolation} onChange={(e) => patch('runAll', { contextIsolation: e.target.value as any })}>
                <option value="fresh">Fresh per test</option>
                <option value="shared">Shared</option>
              </select>
            </Row>
            <Toggle label="Pause suite on session expiry (ask to re-login)" value={s.runAll.stopOnSessionExpiry} onChange={(v) => patch('runAll', { stopOnSessionExpiry: v })} />
            <Toggle label="Random test order" value={s.runAll.randomOrder} onChange={(v) => patch('runAll', { randomOrder: v })} />
          </Section>

          <Section title="Retry & stability">
            <Toggle label="Auto retry failed steps" value={s.retry.autoRetry} onChange={(v) => patch('retry', { autoRetry: v })} />
            <p className="text-xs text-muted">Mitigates flaky LLM output but increases token usage and may have side effects on stateful tests. Turn off for reproducible runs.</p>
            <Row label="Max retry attempts"><input type="number" min="0" max="5" className="input" value={s.retry.maxAttempts} onChange={(e) => patch('retry', { maxAttempts: +e.target.value })} /></Row>
            <Row label="Retry delay (ms)"><input type="number" className="input" value={s.retry.delayMs} onChange={(e) => patch('retry', { delayMs: +e.target.value })} /></Row>
            <Toggle label="Retry on assertion failure" value={s.retry.retryOnAssertFailure} onChange={(v) => patch('retry', { retryOnAssertFailure: v })} />
          </Section>

          <Section title="AI test generation">
            <Row label="Depth">
              <select className="input" value={s.generation.depth} onChange={(e) => patch('generation', { depth: e.target.value as any })}>
                <option value="fast">Fast (homepage only)</option>
                <option value="deep">Deep (agent explores)</option>
              </select>
            </Row>
            <Row label="Max pages to explore"><input type="number" className="input" value={s.generation.maxPagesToExplore} onChange={(e) => patch('generation', { maxPagesToExplore: +e.target.value })} /></Row>
            <Row label="Max steps per generation"><input type="number" className="input" value={s.generation.maxStepsPerGeneration} onChange={(e) => patch('generation', { maxStepsPerGeneration: +e.target.value })} /></Row>
          </Section>

          <Section title="Cost & usage">
            <Toggle label="Show token usage per run" value={s.cost.showPerRun} onChange={(v) => patch('cost', { showPerRun: v })} />
            <Toggle label="Show cumulative cost" value={s.cost.showCumulative} onChange={(v) => patch('cost', { showCumulative: v })} />
            <Row label="Monthly budget alert ($)"><input type="number" className="input" value={s.cost.monthlyBudgetUsd ?? ''} onChange={(e) => patch('cost', { monthlyBudgetUsd: e.target.value ? +e.target.value : undefined })} /></Row>
            <Toggle label="Log all LLM calls (for debugging; uses disk space)" value={s.cost.logAllLlmCalls} onChange={(v) => patch('cost', { logAllLlmCalls: v })} />
          </Section>

          <Section title="Storage">
            <Row label="Data directory"><input className="input" value={s.storage.dataDir} readOnly /></Row>
            <Row label="Keep run history (count)"><input type="number" className="input" value={s.storage.keepRunHistory} onChange={(e) => patch('storage', { keepRunHistory: +e.target.value })} /></Row>
            <Row label="Auto-delete runs older than (days)"><input type="number" className="input" value={s.storage.autoDeleteAfterDays} onChange={(e) => patch('storage', { autoDeleteAfterDays: +e.target.value })} /></Row>
            <p className="text-xs text-muted">
              <b>Privacy:</b> NullProbe collects no data. Everything stays on your machine; LLM calls go directly to your configured provider.
            </p>
          </Section>

          <Section title="Interface">
            <Row label="Theme">
              <select className="input" value={s.ui.theme} onChange={(e) => patch('ui', { theme: e.target.value as any })}>
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </Row>
            <Row label="Language">
              <select className="input" value={s.ui.language} onChange={(e) => patch('ui', { language: e.target.value as any })}>
                <option value="en">English</option>
                <option value="zh-CN">中文</option>
              </select>
            </Row>
          </Section>

          <Section title="Feedback">
            <button className="btn" onClick={() => window.nullprobe.openExternal(s.feedbackUrl)}>Report an issue / suggest a feature →</button>
          </Section>

        </div>
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button className="btn" onClick={() => setShowSettings(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[200px_1fr] items-center gap-3">
      <label className="text-sm text-muted">{label}</label>
      {children}
    </div>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}
