import { useEffect } from 'react'
import { useApp } from './store'
import { Sidebar } from './components/Sidebar'
import { SiteView } from './components/SiteView'
import { SettingsModal } from './components/SettingsModal'
import { LlmRequiredModal } from './components/LlmRequiredModal'
import { EmptyState } from './components/EmptyState'

export default function App() {
  const { selectedSiteId, refreshSites, refreshSettings, settings } = useApp()

  useEffect(() => {
    refreshSettings().then(refreshSites)
  }, [refreshSites, refreshSettings])

  // apply theme
  useEffect(() => {
    if (!settings) return
    const t = settings.ui.theme
    const isDark =
      t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', isDark)
  }, [settings])

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-hidden flex flex-col">
        {selectedSiteId ? <SiteView /> : <EmptyState />}
      </main>
      <SettingsModal />
      <LlmRequiredModal />
      <FeedbackButton />
    </div>
  )
}

function FeedbackButton() {
  const { settings } = useApp()
  const url = settings?.feedbackUrl ?? 'https://github.com/REPLACE_ME/nullprobe/issues/new'
  return (
    <button
      onClick={() => window.nullprobe.openExternal(url)}
      title="Report an issue or suggest a feature"
      className="fixed top-3 right-4 btn text-xs px-2 py-1 z-30"
    >
      💬 Feedback
    </button>
  )
}
