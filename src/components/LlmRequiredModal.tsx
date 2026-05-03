import { useApp } from '../store'

export function LlmRequiredModal() {
  const { showLlmRequiredModal, setShowLlmRequiredModal, setShowSettings } = useApp()
  if (!showLlmRequiredModal) return null
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="card p-6 w-full max-w-md">
        <div className="text-lg font-semibold mb-2">LLM not configured</div>
        <p className="text-sm text-muted mb-4">
          NullProbe needs an LLM provider to run or generate tests. Open Settings to add your API key.
        </p>
        <div className="flex gap-2 justify-end">
          <button className="btn" onClick={() => setShowLlmRequiredModal(false)}>Later</button>
          <button className="btn btn-primary" onClick={() => { setShowLlmRequiredModal(false); setShowSettings(true) }}>Open Settings</button>
        </div>
      </div>
    </div>
  )
}
