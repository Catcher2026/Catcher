import { create } from 'zustand'
import type { Site, TestCase, Settings, AuthProfile, RunResult } from '@shared/types'

export type TabKey = 'tests' | 'results' | 'accounts' | 'settings'

interface AppState {
  sites: Site[]
  selectedSiteId: string | null
  tab: TabKey
  tests: TestCase[]
  selectedTestId: string | null
  authProfiles: AuthProfile[]
  runs: RunResult[]
  settings: Settings | null

  // ui
  showSettings: boolean
  showOnboarding: boolean
  showLlmRequiredModal: boolean

  refreshSites: () => Promise<void>
  selectSite: (id: string | null) => Promise<void>
  setTab: (t: TabKey) => void
  refreshTests: () => Promise<void>
  selectTest: (id: string | null) => void
  refreshAuth: () => Promise<void>
  refreshRuns: (testId?: string) => Promise<void>
  refreshSettings: () => Promise<void>
  setShowSettings: (b: boolean) => void
  setShowLlmRequiredModal: (b: boolean) => void
  ensureLlmConfigured: () => boolean
  ensureBudgetOk: () => Promise<boolean>
}

export const useApp = create<AppState>((set, get) => ({
  sites: [],
  selectedSiteId: null,
  tab: 'tests',
  tests: [],
  selectedTestId: null,
  authProfiles: [],
  runs: [],
  settings: null,
  showSettings: false,
  showOnboarding: false,
  showLlmRequiredModal: false,

  refreshSites: async () => {
    const sites = await window.nullprobe.listSites()
    set({ sites })
    if (!get().selectedSiteId && sites[0]) {
      await get().selectSite(sites[0].id)
    }
  },

  selectSite: async (id) => {
    set({ selectedSiteId: id, tab: 'tests', selectedTestId: null, tests: [], runs: [], authProfiles: [] })
    if (id) {
      await Promise.all([get().refreshTests(), get().refreshAuth(), get().refreshRuns()])
    }
  },

  setTab: (t) => set({ tab: t }),

  refreshTests: async () => {
    const id = get().selectedSiteId
    if (!id) return
    const tests = await window.nullprobe.listTests(id)
    set({ tests })
  },

  selectTest: (id) => set({ selectedTestId: id }),

  refreshAuth: async () => {
    const id = get().selectedSiteId
    if (!id) return
    const profiles = await window.nullprobe.listAuthProfiles(id)
    set({ authProfiles: profiles })
  },

  refreshRuns: async (testId) => {
    const id = get().selectedSiteId
    if (!id) return
    const runs = await window.nullprobe.listRuns(id, testId)
    set({ runs })
  },

  refreshSettings: async () => {
    const settings = await window.nullprobe.getSettings()
    set({ settings })
  },

  setShowSettings: (b) => set({ showSettings: b }),
  setShowLlmRequiredModal: (b) => set({ showLlmRequiredModal: b }),

  ensureLlmConfigured: () => {
    const s = get().settings
    if (!s) { set({ showLlmRequiredModal: true }); return false }
    const cfg = s.llm.default
    const ok = cfg.provider === 'local' ? !!cfg.baseUrl : !!cfg.apiKey
    if (!ok) set({ showLlmRequiredModal: true })
    return ok
  },

  // Returns true if budget OK or user confirms; false if user cancels.
  ensureBudgetOk: async () => {
    const s = get().settings
    const budget = s?.cost.monthlyBudgetUsd
    if (!budget || budget <= 0) return true
    const { costUsd } = await window.nullprobe.getMonthlyCost()
    if (costUsd >= budget) {
      return confirm(`Monthly budget exceeded: $${costUsd.toFixed(4)} of $${budget.toFixed(2)} used. Continue anyway?`)
    }
    if (costUsd >= budget * 0.8) {
      return confirm(`Approaching monthly budget: $${costUsd.toFixed(4)} of $${budget.toFixed(2)} (${Math.round((costUsd / budget) * 100)}%). Continue?`)
    }
    return true
  },
}))
