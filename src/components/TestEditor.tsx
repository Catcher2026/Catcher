import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import type { TestCase, TestStep, StepType, RunResult, StepResult } from '@shared/types'

function uid(p: string) { return `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }

const STEP_LABELS: Record<StepType, { label: string; color: string }> = {
  login: { label: 'Login', color: 'bg-purple-500/10 text-purple-600 dark:text-purple-300 border-purple-500/30' },
  act: { label: 'Act', color: 'bg-blue-500/10 text-blue-600 dark:text-blue-300 border-blue-500/30' },
  assert: { label: 'Assert', color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/30' },
  wait: { label: 'Wait', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-500/30' },
}

export function TestEditor() {
  const { selectedSiteId, selectedTestId, tests, selectTest, refreshTests, authProfiles, ensureLlmConfigured, ensureBudgetOk, refreshRuns } = useApp()
  const original = tests.find((t) => t.id === selectedTestId) ?? null
  const [test, setTest] = useState<TestCase | null>(original)
  const [genDesc, setGenDesc] = useState('')
  const [generating, setGenerating] = useState(false)
  const [showGen, setShowGen] = useState(false)

  // live run state
  const [runId, setRunId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [frame, setFrame] = useState<string | null>(null) // base64 jpeg
  const [stepStates, setStepStates] = useState<Map<string, StepResult | 'running'>>(new Map())
  const [run, setRun] = useState<RunResult | null>(null)
  const [statusMsg, setStatusMsg] = useState<string>('')
  const unsubsRef = useRef<Array<() => void>>([])

  useEffect(() => { setTest(original) }, [selectedTestId, original?.updatedAt])

  // cleanup subscriptions on unmount / test change
  useEffect(() => {
    return () => {
      unsubsRef.current.forEach((u) => u())
      unsubsRef.current = []
    }
  }, [selectedTestId])

  if (!test || !selectedSiteId) return null

  async function save(next: TestCase) {
    setTest(next)
    await window.catcher.saveTest(selectedSiteId!, next)
    await refreshTests()
  }

  function addStep(type: StepType) {
    const step: TestStep = { id: uid('step'), type, description: type === 'wait' ? '5' : '' }
    save({ ...test!, steps: [...test!.steps, step] })
  }

  function updateStep(id: string, patch: Partial<TestStep>) {
    save({ ...test!, steps: test!.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
  }

  function removeStep(id: string) {
    save({ ...test!, steps: test!.steps.filter((s) => s.id !== id) })
  }

  function moveStep(id: string, dir: -1 | 1) {
    const idx = test!.steps.findIndex((s) => s.id === id)
    if (idx < 0) return
    const target = idx + dir
    if (target < 0 || target >= test!.steps.length) return
    const steps = [...test!.steps]
    ;[steps[idx], steps[target]] = [steps[target], steps[idx]]
    save({ ...test!, steps })
  }

  async function generate() {
    if (!genDesc.trim()) return
    if (!ensureLlmConfigured()) return
    if (!(await ensureBudgetOk())) return
    setGenerating(true)
    try {
      const generated = await window.catcher.generateTest(selectedSiteId!, genDesc, test!.authProfileId || undefined)
      const merged: TestCase = { ...test!, name: test!.steps.length ? test!.name : generated.name, steps: [...test!.steps, ...generated.steps] }
      await save(merged)
      setGenDesc('')
    } finally { setGenerating(false) }
  }

  function clearSubs() {
    unsubsRef.current.forEach((u) => u())
    unsubsRef.current = []
  }

  async function runThis() {
    if (!ensureLlmConfigured()) return
    if (!(await ensureBudgetOk())) return
    const newRunId = uid('run')
    setRunId(newRunId)
    setRunning(true)
    setRun(null)
    setFrame(null)
    setStepStates(new Map())
    setStatusMsg('Starting browser…')

    clearSubs()
    unsubsRef.current.push(window.catcher.onRunFrame((e) => {
      if (e.runId === newRunId) setFrame(e.data)
    }))
    unsubsRef.current.push(window.catcher.onRunStatus((e) => {
      if (e.runId === newRunId) setStatusMsg(e.message)
    }))
    unsubsRef.current.push(window.catcher.onRunStepStart((e) => {
      if (e.runId !== newRunId) return
      setStatusMsg('') // clear loading once first step starts
      setStepStates((m) => { const n = new Map(m); n.set(e.stepId, 'running'); return n })
    }))
    unsubsRef.current.push(window.catcher.onRunStepEnd((e) => {
      if (e.runId !== newRunId) return
      setStepStates((m) => { const n = new Map(m); n.set(e.step.stepId, e.step); return n })
    }))
    unsubsRef.current.push(window.catcher.onRunEnd((e) => {
      if (e.runId !== newRunId) return
      setRunning(false)
      setStatusMsg('')
      if (e.cancelled) {
        // user stopped: wipe all live state so nothing keeps pulsing
        setStepStates(new Map())
        setFrame(null)
        setRun(null)
        setRunId(null)
      } else {
        setRun(e.run)
        // ensure no step is left marked 'running'
        setStepStates((m) => {
          const n = new Map(m)
          for (const [stepId, state] of n) {
            if (state === 'running') {
              const final = e.run.steps.find((s) => s.stepId === stepId)
              if (final) n.set(stepId, final)
              else n.delete(stepId)
            }
          }
          return n
        })
      }
    }))

    try {
      await window.catcher.runTest(selectedSiteId!, test!.id, newRunId, test!.authProfileId || undefined)
      await refreshRuns()
    } catch (e: any) {
      console.error(e)
      setRunning(false)
    }
  }

  async function stopRun() {
    if (!runId) return
    await window.catcher.cancelRun(runId)
  }

  function closeDrawer() {
    clearSubs()
    setRunId(null); setRun(null); setFrame(null); setStepStates(new Map()); setRunning(false)
  }

  const showDrawer = running || run || frame
  const stepStateOf = (stepId: string): 'pending' | 'running' | StepResult => {
    const v = stepStates.get(stepId)
    if (!v) return 'pending'
    return v
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b border-border px-6 py-3 flex items-center justify-between bg-surface">
          <button className="btn" onClick={() => selectTest(null)}>← Back</button>
          <button className="btn btn-primary" onClick={runThis} disabled={running || test.steps.length === 0}>
            {running ? '⏵ Running…' : '▶ Run this test'}
          </button>
        </div>
        <div className="flex-1 overflow-auto p-6">
        <input
          className="input text-lg font-semibold mb-4"
          value={test.name}
          onChange={(e) => save({ ...test, name: e.target.value })}
        />

        <div className="flex items-center gap-2 mb-4">
          <label className="text-sm text-muted whitespace-nowrap">Auth profile:</label>
          <select className="input flex-1" value={test.authProfileId ?? ''} onChange={(e) => save({ ...test!, authProfileId: e.target.value || undefined })}>
            <option value="">None (unauthenticated)</option>
            {authProfiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.status})</option>)}
          </select>
          <span className="text-xs text-muted">saved with this test — used for Run this & Run all</span>
        </div>

        <div className="card mb-4">
          <button
            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-bg rounded-t-lg"
            onClick={() => setShowGen((v) => !v)}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">✨ AI generate steps</span>
              <span className="text-xs text-muted">— let the AI write the test for you</span>
            </div>
            <span className="text-muted">{showGen ? '▴' : '▾'}</span>
          </button>
          {showGen && (
            <div className="px-3 pb-3 space-y-2 border-t border-border pt-3">
              <p className="text-xs text-muted">
                Describe in plain English what you want to verify. Catcher will open the site in the background, look at it, and produce a draft step list (Act + Assert) that you can edit before running.
              </p>
              <textarea className="input min-h-[60px]" placeholder="e.g. verify the contact page has Twitter, LinkedIn, and email links" value={genDesc} onChange={(e) => setGenDesc(e.target.value)} />
              <button className="btn btn-primary" onClick={generate} disabled={generating || !genDesc.trim()}>
                {generating ? 'Generating…' : 'Generate steps'}
              </button>
            </div>
          )}
        </div>

        <div className="space-y-2 mb-4">
          {test.steps.map((s, i) => {
            const state = stepStateOf(s.id)
            const status = typeof state === 'object' ? state.status : state
            return (
              <div key={s.id} className={`card p-3 ${status === 'running' ? 'ring-2 ring-accent animate-pulse' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded border text-xs ${STEP_LABELS[s.type].color}`}>{STEP_LABELS[s.type].label}</span>
                  {s.type === 'wait' ? (
                    <div className="flex-1 flex items-center gap-2">
                      <span className="text-sm text-muted">Wait for</span>
                      <input
                        className="input w-24"
                        type="number"
                        min={0}
                        max={600}
                        step={1}
                        value={s.description}
                        onChange={(e) => updateStep(s.id, { description: e.target.value })}
                        disabled={running}
                      />
                      <span className="text-sm text-muted">seconds</span>
                    </div>
                  ) : (
                    <input
                      className="input flex-1"
                      placeholder={`Describe this ${s.type} step…`}
                      value={s.description}
                      onChange={(e) => updateStep(s.id, { description: e.target.value })}
                      disabled={running}
                    />
                  )}
                  {status !== 'pending' && (
                    <span className={`text-xs px-2 py-1 ${
                      status === 'passed' ? 'text-success' :
                      status === 'failed' ? 'text-danger' :
                      status === 'needs_review' ? 'text-warning' :
                      status === 'running' ? 'text-accent' : 'text-muted'
                    }`}>{status}</span>
                  )}
                  <button className="btn px-2" onClick={() => moveStep(s.id, -1)} disabled={i === 0 || running}>↑</button>
                  <button className="btn px-2" onClick={() => moveStep(s.id, 1)} disabled={i === test.steps.length - 1 || running}>↓</button>
                  <button className="btn btn-danger px-2" onClick={() => removeStep(s.id)} disabled={running}>✕</button>
                </div>
              </div>
            )
          })}
          {test.steps.length === 0 && (
            <div className="text-center text-muted py-6 border border-dashed border-border rounded">
              No steps yet. Add one below or use AI generate.
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button className="btn" onClick={() => addStep('act')} disabled={running}>+ Act</button>
          <button className="btn" onClick={() => addStep('assert')} disabled={running}>+ Assert</button>
          <button className="btn" onClick={() => addStep('wait')} disabled={running}>+ Wait</button>
        </div>
        </div>
      </div>

      {showDrawer && (
        <aside className="w-[520px] border-l border-border bg-surface flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="font-medium">
              {running ? 'Live run…' : run ? `Result: ${run.status.toUpperCase()}` : 'Live preview'}
            </div>
            <div className="flex gap-2">
              {running && <button className="btn btn-danger" onClick={stopRun}>■ Stop</button>}
              {!running && <button className="text-muted hover:text-fg" onClick={closeDrawer}>✕</button>}
            </div>
          </div>

          <div className="bg-black flex items-center justify-center" style={{ aspectRatio: '16/10' }}>
            {frame ? (
              <img src={`data:image/jpeg;base64,${frame}`} alt="live" className="max-w-full max-h-full" />
            ) : (
              <div className="text-muted text-sm">Waiting for browser…</div>
            )}
          </div>

          <div className="flex-1 overflow-auto p-3 space-y-2">
            {statusMsg && (
              <div className="card p-3 text-sm text-muted flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full bg-accent animate-pulse" />
                {statusMsg}
              </div>
            )}
            {run && (
              <div className={`text-sm font-semibold ${run.status === 'passed' ? 'text-success' : 'text-danger'}`}>
                {run.status.toUpperCase()}
                {run.tokenUsage && (
                  <span className="text-xs text-muted font-normal ml-2">
                    {run.tokenUsage.input + run.tokenUsage.output} tokens · ${run.tokenUsage.estimatedCostUsd.toFixed(4)}
                  </span>
                )}
              </div>
            )}
            {Array.from(stepStates.entries()).map(([stepId, state]) => {
              const step = test.steps.find((s) => s.id === stepId)
              if (typeof state === 'string') {
                return (
                  <div key={stepId} className="card p-2 text-xs">
                    <div className="flex justify-between"><span>{step?.description}</span><span className="text-accent">{state}</span></div>
                  </div>
                )
              }
              return (
                <div key={stepId} className="card p-2 text-xs">
                  <div className="flex justify-between">
                    <span className="truncate flex-1">{step?.description}</span>
                    <span className={state.status === 'passed' ? 'text-success' : state.status === 'failed' ? 'text-danger' : 'text-warning'}>{state.status}</span>
                  </div>
                  {state.reasoning && <div className="text-muted mt-1">{state.reasoning}</div>}
                  {state.error && <div className="text-danger mt-1">{state.error}</div>}
                </div>
              )
            })}
          </div>
        </aside>
      )}
    </div>
  )
}
