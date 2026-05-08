import type { Site, TestCase, RunResult, AuthProfile, Settings } from './types'

export interface CatcherAPI {
  // sites
  listSites(): Promise<Site[]>
  createSite(input: { name: string; url: string }): Promise<Site>
  deleteSite(siteId: string): Promise<void>
  updateSite(site: Site): Promise<void>

  // tests
  listTests(siteId: string): Promise<TestCase[]>
  getTest(siteId: string, testId: string): Promise<TestCase | null>
  saveTest(siteId: string, test: TestCase): Promise<void>
  deleteTest(siteId: string, testId: string): Promise<void>

  // runs
  listRuns(siteId: string, testId?: string): Promise<RunResult[]>
  runTest(siteId: string, testId: string, runId?: string, authProfileId?: string): Promise<RunResult>
  runAll(siteId: string): Promise<RunResult[]>
  cancelRun(runId: string): Promise<void>
  getMonthlyCost(): Promise<{ costUsd: number; inputTokens: number; outputTokens: number; runCount: number }>

  // run event subscriptions (returns unsubscribe fn)
  onRunFrame(cb: (e: { runId: string; data: string }) => void): () => void
  onRunStatus(cb: (e: { runId: string; message: string }) => void): () => void
  onRunStepStart(cb: (e: { runId: string; stepId: string }) => void): () => void
  onRunStepEnd(cb: (e: { runId: string; step: import('./types').StepResult }) => void): () => void
  onRunEnd(cb: (e: { runId: string; run: RunResult; cancelled: boolean }) => void): () => void

  // auth profiles
  listAuthProfiles(siteId: string): Promise<AuthProfile[]>
  startManualLogin(siteId: string, profileName: string): Promise<{ sessionId: string; profileId: string }>
  finishManualLogin(sessionId: string, profileId: string): Promise<AuthProfile>
  cancelManualLogin(sessionId: string): Promise<void>
  deleteAuthProfile(siteId: string, profileId: string): Promise<void>

  // settings
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<void>

  // ai generation
  generateTest(siteId: string, description: string, authProfileId?: string): Promise<TestCase>

  // misc
  openExternal(url: string): Promise<void>
  getDataDir(): Promise<string>
}

declare global {
  interface Window {
    catcher: CatcherAPI
  }
}
