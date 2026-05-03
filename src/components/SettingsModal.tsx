import { useEffect, useState } from 'react'
import { useApp } from '../store'
import type { Settings, LLMProvider } from '@shared/types'

const PROVIDERS: { value: LLMProvider; label: string; defaultModel: string; defaultBaseUrl?: string }[] = [
  { value: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o-mini' },
  { value: 'anthropic', label: 'Anthropic (Claude)', defaultModel: 'claude-sonnet-4-6' },
  { value: 'gemini', label: 'Google (Gemini)', defaultModel: 'gemini-2.5-pro' },
  { value: 'local', label: 'Local (Ollama / LM Studio)', defaultModel: 'qwen2.5:32b', defaultBaseUrl: 'http://localhost:11434/v1' },
  { value: 'custom', label: 'Custom (OpenAI-compatible)', defaultModel: '' },
]

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
            <Row label="Provider">
              <select className="input" value={s.llm.default.provider} onChange={(e) => {
                const provider = e.target.value as LLMProvider
                const def = PROVIDERS.find((p) => p.value === provider)!
                patch('llm', { default: {
                  ...s.llm.default,
                  provider,
                  model: def.defaultModel || s.llm.default.model,
                  baseUrl: def.defaultBaseUrl ?? s.llm.default.baseUrl,
                } })
              }}>
                {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </Row>
            {s.llm.default.provider !== 'local' && (
              <Row label="API key">
                <input type="password" className="input" placeholder="sk-…" value={s.llm.default.apiKey ?? ''} onChange={(e) => patch('llm', { default: { ...s.llm.default, apiKey: e.target.value } })} />
              </Row>
            )}
            <Row label="Model"><input className="input" value={s.llm.default.model} onChange={(e) => patch('llm', { default: { ...s.llm.default, model: e.target.value } })} /></Row>
            <Row label={s.llm.default.provider === 'local' ? 'Endpoint URL *' : 'Base URL (optional)'}>
              <input
                className="input"
                placeholder={s.llm.default.provider === 'local' ? 'http://localhost:11434/v1' : 'https://api.openai.com/v1'}
                value={s.llm.default.baseUrl ?? ''}
                onChange={(e) => patch('llm', { default: { ...s.llm.default, baseUrl: e.target.value } })}
              />
            </Row>
            {s.llm.default.provider === 'local' && (
              <p className="text-xs text-muted -mt-1">
                Point this at any local OpenAI-compatible server. Defaults: Ollama <code>http://localhost:11434/v1</code>, LM Studio <code>http://localhost:1234/v1</code>. No API key required.
              </p>
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
