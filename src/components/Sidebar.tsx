import { useState } from 'react'
import { useApp } from '../store'

export function Sidebar() {
  const { sites, selectedSiteId, selectSite, refreshSites, setShowSettings } = useApp()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')

  async function add() {
    if (!name.trim() || !url.trim()) return
    let normalized = url.trim()
    if (!/^https?:\/\//.test(normalized)) normalized = 'https://' + normalized
    const site = await window.catcher.createSite({ name: name.trim(), url: normalized })
    setName(''); setUrl(''); setAdding(false)
    await refreshSites()
    await selectSite(site.id)
  }

  async function del(id: string) {
    if (!confirm('Delete this site and all its tests / runs / auth?')) return
    await window.catcher.deleteSite(id)
    if (selectedSiteId === id) await selectSite(null)
    await refreshSites()
  }

  return (
    <aside className="w-64 border-r border-border bg-surface flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="font-semibold">Catcher</div>
        <button className="text-muted hover:text-fg text-xs" onClick={() => setShowSettings(true)}>⚙ Settings</button>
      </div>
      <div className="px-3 py-2 text-xs uppercase tracking-wide text-muted">Sites</div>
      <div className="flex-1 overflow-auto px-2 space-y-1">
        {sites.map((s) => (
          <div key={s.id} className={`group flex items-center justify-between px-2 py-1.5 rounded hover:bg-bg cursor-pointer ${selectedSiteId === s.id ? 'bg-bg' : ''}`} onClick={() => selectSite(s.id)}>
            <div className="min-w-0">
              <div className="truncate">{s.name}</div>
              <div className="text-xs text-muted truncate">{s.url}</div>
            </div>
            <button className="opacity-0 group-hover:opacity-100 text-danger text-xs px-1" onClick={(e) => { e.stopPropagation(); del(s.id) }}>✕</button>
          </div>
        ))}
        {sites.length === 0 && <div className="px-2 py-4 text-xs text-muted">No sites yet.</div>}
      </div>
      <div className="p-2 border-t border-border">
        {adding ? (
          <div className="space-y-2">
            <input className="input" placeholder="Name (e.g. My App)" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input" placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn btn-primary flex-1" onClick={add}>Create</button>
              <button className="btn flex-1" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="btn w-full" onClick={() => setAdding(true)}>+ Add site</button>
        )}
      </div>
    </aside>
  )
}
