import { useApp } from '../store'
import { TestsTab } from './TestsTab'
import { ResultsTab } from './ResultsTab'
import { AccountsTab } from './AccountsTab'
import { SiteSettingsTab } from './SiteSettingsTab'

const TABS = [
  { key: 'tests', label: 'Tests' },
  { key: 'results', label: 'Results' },
  { key: 'accounts', label: 'Test Accounts' },
  { key: 'settings', label: 'Settings' },
] as const

export function SiteView() {
  const { sites, selectedSiteId, tab, setTab, authProfiles } = useApp()
  const site = sites.find((s) => s.id === selectedSiteId)
  if (!site) return null

  const noAuth = authProfiles.length === 0

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="border-b border-border px-4">
        <div className="py-3">
          <div className="text-lg font-semibold">{site.name}</div>
          <div className="text-xs text-muted">{site.url}</div>
        </div>
        <div className="flex gap-1">
          {TABS.map((t) => (
            <div key={t.key} className={`tab ${tab === t.key ? 'tab-active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
            </div>
          ))}
        </div>
      </div>

      {noAuth && tab === 'tests' && (
        <div className="bg-warning/10 border-b border-warning/30 px-4 py-2 text-sm flex items-center justify-between">
          <span>This site has no auth profile. Pages requiring login may not work.</span>
          <button className="btn" onClick={() => setTab('accounts')}>Login now →</button>
        </div>
      )}

      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === 'tests' && <TestsTab />}
        {tab === 'results' && <ResultsTab />}
        {tab === 'accounts' && <AccountsTab />}
        {tab === 'settings' && <SiteSettingsTab />}
      </div>
    </div>
  )
}
