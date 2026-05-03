import { useApp } from '../store'

export function ResultsTab() {
  const { runs, tests } = useApp()
  const totals = runs.reduce(
    (acc, r) => {
      if (r.tokenUsage) {
        acc.input += r.tokenUsage.input
        acc.output += r.tokenUsage.output
        acc.cost += r.tokenUsage.estimatedCostUsd
      }
      acc.passed += r.status === 'passed' ? 1 : 0
      acc.failed += r.status === 'failed' ? 1 : 0
      return acc
    },
    { input: 0, output: 0, cost: 0, passed: 0, failed: 0 }
  )
  const totalTokens = totals.input + totals.output

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="card p-4 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        <Stat label="Runs" value={String(runs.length)} />
        <Stat label="Pass / Fail" value={`${totals.passed} / ${totals.failed}`} valueClass={totals.failed > 0 ? 'text-danger' : 'text-success'} />
        <Stat label="Total tokens" value={totalTokens.toLocaleString()} />
        <Stat label="Total cost" value={`$${totals.cost.toFixed(4)}`} />
      </div>
      <div className="text-sm text-muted mb-3">{runs.length} run{runs.length === 1 ? '' : 's'}</div>
      <div className="space-y-2">
        {runs.map((r) => {
          const t = tests.find((x) => x.id === r.testId)
          return (
            <div key={r.id} className="card p-3 flex items-center gap-3">
              <span className={`px-2 py-0.5 rounded text-xs ${r.status === 'passed' ? 'bg-success/10 text-success' : r.status === 'failed' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'}`}>
                {r.status}
              </span>
              <div className="flex-1 min-w-0">
                <div className="truncate">{t?.name ?? r.testId}</div>
                <div className="text-xs text-muted">{new Date(r.startedAt).toLocaleString()}</div>
              </div>
              <div className="text-xs text-muted">{r.steps.filter((s) => s.status === 'passed').length} / {r.steps.length}</div>
              {r.tokenUsage && (
                <div className="text-xs text-muted">${r.tokenUsage.estimatedCostUsd.toFixed(4)}</div>
              )}
            </div>
          )
        })}
        {runs.length === 0 && <div className="text-muted text-center py-12">No runs yet.</div>}
      </div>
    </div>
  )
}

function Stat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <div className={`text-xl font-semibold ${valueClass ?? ''}`}>{value}</div>
      <div className="text-xs text-muted mt-0.5">{label}</div>
    </div>
  )
}
