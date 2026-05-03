export function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center text-center p-8">
      <div className="max-w-md">
        <div className="text-3xl font-semibold mb-2">Welcome to NullProbe</div>
        <p className="text-muted mb-4">
          Open-source, local-first AI-powered web testing.
          Add a site on the left to get started — describe what to test in plain English and let an AI agent drive a real browser.
        </p>
        <p className="text-xs text-muted">
          Tip: configure your LLM provider in Settings before running a test.
        </p>
      </div>
    </div>
  )
}
