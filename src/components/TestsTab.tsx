import { useState } from 'react'
import { useApp } from '../store'
import { TestEditor } from './TestEditor'
import type { TestCase } from '@shared/types'

function uid(p: string) { return `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }

export function TestsTab() {
  const { selectedSiteId, tests, selectedTestId, selectTest, refreshTests, ensureLlmConfigured, ensureBudgetOk, setTab, refreshRuns } = useApp()
  const [running, setRunning] = useState(false)

  if (selectedTestId) return <TestEditor />

  async function newTest() {
    if (!selectedSiteId) return
    const now = new Date().toISOString()
    const t: TestCase = { id: uid('test'), name: 'Untitled test', steps: [], createdAt: now, updatedAt: now }
    await window.nullprobe.saveTest(selectedSiteId, t)
    await refreshTests()
    selectTest(t.id)
  }

  async function runAll() {
    if (!selectedSiteId) return
    if (!ensureLlmConfigured()) return
    if (!(await ensureBudgetOk())) return
    setRunning(true)
    try {
      await window.nullprobe.runAll(selectedSiteId)
      await refreshRuns()
      setTab('results')
    } finally { setRunning(false) }
  }

  async function del(id: string) {
    if (!selectedSiteId) return
    if (!confirm('Delete this test?')) return
    await window.nullprobe.deleteTest(selectedSiteId, id)
    await refreshTests()
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-muted">{tests.length} test{tests.length === 1 ? '' : 's'}</div>
        <div className="flex gap-2">
          <button className="btn" onClick={runAll} disabled={running || tests.length === 0}>
            {running ? 'Running…' : '▶ Run all'}
          </button>
          <button className="btn btn-primary" onClick={newTest}>+ New test</button>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {tests.map((t) => (
          <div key={t.id} className="card p-4 hover:border-accent cursor-pointer group" onClick={() => selectTest(t.id)}>
            <div className="flex items-start justify-between">
              <div className="font-medium truncate">{t.name}</div>
              <button className="opacity-0 group-hover:opacity-100 text-danger text-xs" onClick={(e) => { e.stopPropagation(); del(t.id) }}>✕</button>
            </div>
            <div className="text-xs text-muted mt-1">{t.steps.length} step{t.steps.length === 1 ? '' : 's'}</div>
          </div>
        ))}
        {tests.length === 0 && (
          <div className="col-span-full text-center text-muted py-12">
            No tests yet. Click <b>+ New test</b> to create one.
          </div>
        )}
      </div>
    </div>
  )
}
