import { useState } from 'react'
import { useApp } from '../store'

export function AccountsTab() {
  const { selectedSiteId, authProfiles, refreshAuth } = useApp()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ sessionId: string; profileId: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function startLogin() {
    if (!selectedSiteId || !name.trim()) return
    setBusy(true); setError(null)
    try {
      const res = await window.nullprobe.startManualLogin(selectedSiteId, name.trim())
      setPending({ ...res, name: name.trim() })
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally { setBusy(false) }
  }

  async function done() {
    if (!pending) return
    setBusy(true); setError(null)
    try {
      await window.nullprobe.finishManualLogin(pending.sessionId, pending.profileId)
      setPending(null); setName('')
      await refreshAuth()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally { setBusy(false) }
  }

  async function cancel() {
    if (!pending) return
    await window.nullprobe.cancelManualLogin(pending.sessionId).catch(() => {})
    setPending(null)
  }

  async function del(id: string) {
    if (!selectedSiteId) return
    if (!confirm('Delete this auth profile?')) return
    await window.nullprobe.deleteAuthProfile(selectedSiteId, id)
    await refreshAuth()
  }

  return (
    <div className="flex-1 overflow-auto p-6 max-w-2xl">
      <div className="card p-4 mb-4">
        <div className="font-medium mb-2">Add a new auth profile</div>
        <p className="text-sm text-muted mb-3">
          NullProbe will open a real browser. Sign in however you normally would (Google, password, passkey…), then come back and click <b>Done</b>. The session is stored locally and reused for tests.
        </p>
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="Profile name (e.g. Admin, Regular user)" value={name} onChange={(e) => setName(e.target.value)} disabled={!!pending} />
          {!pending && (
            <button className="btn btn-primary" onClick={startLogin} disabled={busy || !name.trim()}>
              {busy ? 'Opening browser…' : 'Login'}
            </button>
          )}
        </div>
        {error && <div className="text-sm text-danger mt-2">{error}</div>}
      </div>

      <div className="space-y-2">
        {authProfiles.map((p) => (
          <div key={p.id} className="card p-3 flex items-center gap-3">
            <div className="flex-1">
              <div className="font-medium">{p.name}</div>
              <div className="text-xs text-muted">
                {p.status === 'logged_in' && p.lastLoginAt ? `Logged in ${new Date(p.lastLoginAt).toLocaleString()}` : p.status}
              </div>
            </div>
            <button className="btn btn-danger" onClick={() => del(p.id)}>Delete</button>
          </div>
        ))}
        {authProfiles.length === 0 && !pending && <div className="text-muted text-center py-8">No auth profiles yet.</div>}
      </div>

      {pending && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="card p-6 w-full max-w-md">
            <div className="text-lg font-semibold mb-2">Browser opened</div>
            <p className="text-sm text-muted mb-4">
              Complete the login for <b>{pending.name}</b> in the browser window NullProbe just opened. When you're signed in, click <b>Done</b> below to save the session.
            </p>
            <div className="flex gap-2 justify-end">
              <button className="btn" onClick={cancel} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={done} disabled={busy}>{busy ? 'Saving…' : '✓ Done, save session'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
