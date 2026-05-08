import { useApp } from '../store'

export function SiteSettingsTab() {
  const { sites, selectedSiteId, authProfiles, refreshSites } = useApp()
  const site = sites.find((s) => s.id === selectedSiteId)
  if (!site) return null

  async function update(patch: Partial<typeof site>) {
    await window.catcher.updateSite({ ...site!, ...patch })
    await refreshSites()
  }

  return (
    <div className="flex-1 overflow-auto p-6 max-w-2xl space-y-4">
      <div className="card p-4">
        <div className="font-medium mb-2">Site</div>
        <label className="block text-xs text-muted mb-1">Name</label>
        <input className="input mb-3" value={site.name} onChange={(e) => update({ name: e.target.value })} />
        <label className="block text-xs text-muted mb-1">URL</label>
        <input className="input" value={site.url} onChange={(e) => update({ url: e.target.value })} />
      </div>

      <div className="card p-4">
        <div className="font-medium mb-2">Default auth profile</div>
        <select className="input" value={site.defaultAuthProfileId ?? ''} onChange={(e) => update({ defaultAuthProfileId: e.target.value || undefined })}>
          <option value="">None</option>
          {authProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <p className="text-xs text-muted">Global settings (LLM, engine, etc.) live in the gear menu in the sidebar.</p>
    </div>
  )
}
