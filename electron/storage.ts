import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Site, TestCase, RunResult, AuthProfile, Settings } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/types'

let dataDir = ''

export function getDataDir(): string {
  if (!dataDir) {
    dataDir = path.join(app.getPath('home'), '.nullprobe')
  }
  return dataDir
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true })
}

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(p, 'utf-8')
    return JSON.parse(raw) as T
  } catch (e: any) {
    if (e.code === 'ENOENT') return fallback
    throw e
  }
}

async function writeJson(p: string, data: unknown) {
  await ensureDir(path.dirname(p))
  await fs.writeFile(p, JSON.stringify(data, null, 2), 'utf-8')
}

const sitesDir = () => path.join(getDataDir(), 'sites')
const siteDir = (id: string) => path.join(sitesDir(), id)
const siteMeta = (id: string) => path.join(siteDir(id), 'meta.json')
const testsDir = (siteId: string) => path.join(siteDir(siteId), 'tests')
const testFile = (siteId: string, testId: string) => path.join(testsDir(siteId), `${testId}.json`)
const runsDir = (siteId: string) => path.join(siteDir(siteId), 'runs')
const runFile = (siteId: string, runId: string) => path.join(runsDir(siteId), `${runId}.json`)
const authDir = (siteId: string) => path.join(siteDir(siteId), 'auth')
const authMeta = (siteId: string, profileId: string) => path.join(authDir(siteId), profileId, 'meta.json')
const settingsFile = () => path.join(getDataDir(), 'settings.json')

// ----- sites -----

export async function listSites(): Promise<Site[]> {
  await ensureDir(sitesDir())
  const entries = await fs.readdir(sitesDir(), { withFileTypes: true })
  const sites: Site[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const meta = await readJson<Site | null>(siteMeta(e.name), null)
    if (meta) sites.push(meta)
  }
  return sites.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function createSite(input: { name: string; url: string }): Promise<Site> {
  const id = `site_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const site: Site = {
    id,
    name: input.name,
    url: input.url,
    createdAt: new Date().toISOString(),
  }
  await writeJson(siteMeta(id), site)
  await ensureDir(testsDir(id))
  await ensureDir(runsDir(id))
  await ensureDir(authDir(id))
  return site
}

export async function updateSite(site: Site) {
  await writeJson(siteMeta(site.id), site)
}

export async function deleteSite(siteId: string) {
  await fs.rm(siteDir(siteId), { recursive: true, force: true })
}

// ----- tests -----

export async function listTests(siteId: string): Promise<TestCase[]> {
  await ensureDir(testsDir(siteId))
  const files = await fs.readdir(testsDir(siteId))
  const tests: TestCase[] = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    const t = await readJson<TestCase | null>(path.join(testsDir(siteId), f), null)
    if (t) tests.push(t)
  }
  return tests.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function getTest(siteId: string, testId: string): Promise<TestCase | null> {
  return readJson<TestCase | null>(testFile(siteId, testId), null)
}

export async function saveTest(siteId: string, test: TestCase): Promise<void> {
  test.updatedAt = new Date().toISOString()
  if (!test.createdAt) test.createdAt = test.updatedAt
  await writeJson(testFile(siteId, test.id), test)
}

export async function deleteTest(siteId: string, testId: string): Promise<void> {
  await fs.rm(testFile(siteId, testId), { force: true })
}

// ----- runs -----

export async function listRuns(siteId: string, testId?: string): Promise<RunResult[]> {
  await ensureDir(runsDir(siteId))
  const files = await fs.readdir(runsDir(siteId))
  const runs: RunResult[] = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    const r = await readJson<RunResult | null>(path.join(runsDir(siteId), f), null)
    if (r && (!testId || r.testId === testId)) runs.push(r)
  }
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export async function saveRun(siteId: string, run: RunResult): Promise<void> {
  await writeJson(runFile(siteId, run.id), run)
}

// Sum estimatedCostUsd + token counts across ALL sites for runs that started this calendar month.
export async function getMonthlyCost(): Promise<{ costUsd: number; inputTokens: number; outputTokens: number; runCount: number }> {
  const sites = await listSites()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  let costUsd = 0, inputTokens = 0, outputTokens = 0, runCount = 0
  for (const s of sites) {
    const runs = await listRuns(s.id)
    for (const r of runs) {
      if (r.startedAt < monthStart) continue
      runCount++
      if (r.tokenUsage) {
        costUsd += r.tokenUsage.estimatedCostUsd
        inputTokens += r.tokenUsage.input
        outputTokens += r.tokenUsage.output
      }
    }
  }
  return { costUsd, inputTokens, outputTokens, runCount }
}

// ----- auth profiles -----

export async function listAuthProfiles(siteId: string): Promise<AuthProfile[]> {
  await ensureDir(authDir(siteId))
  const entries = await fs.readdir(authDir(siteId), { withFileTypes: true })
  const profiles: AuthProfile[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const p = await readJson<AuthProfile | null>(authMeta(siteId, e.name), null)
    if (p) profiles.push(p)
  }
  return profiles
}

export async function saveAuthProfile(siteId: string, profile: AuthProfile): Promise<void> {
  await writeJson(authMeta(siteId, profile.id), profile)
}

export async function deleteAuthProfile(siteId: string, profileId: string): Promise<void> {
  await fs.rm(path.join(authDir(siteId), profileId), { recursive: true, force: true })
}

export function authProfileDir(siteId: string, profileId: string): string {
  return path.join(authDir(siteId), profileId)
}

// ----- settings -----

export async function getSettings(): Promise<Settings> {
  const stored = await readJson<Partial<Settings> | null>(settingsFile(), null)
  if (!stored) {
    const s: Settings = { ...DEFAULT_SETTINGS, storage: { ...DEFAULT_SETTINGS.storage, dataDir: getDataDir() } }
    await writeJson(settingsFile(), s)
    return s
  }
  // shallow merge defaults to fill missing keys after upgrades
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    llm: { ...DEFAULT_SETTINGS.llm, ...(stored.llm ?? {}) },
    engine: { ...DEFAULT_SETTINGS.engine, ...(stored.engine ?? {}) },
    assert: { ...DEFAULT_SETTINGS.assert, ...(stored.assert ?? {}) },
    runAll: { ...DEFAULT_SETTINGS.runAll, ...(stored.runAll ?? {}) },
    retry: { ...DEFAULT_SETTINGS.retry, ...(stored.retry ?? {}) },
    generation: { ...DEFAULT_SETTINGS.generation, ...(stored.generation ?? {}) },
    cost: { ...DEFAULT_SETTINGS.cost, ...(stored.cost ?? {}) },
    storage: { ...DEFAULT_SETTINGS.storage, dataDir: getDataDir(), ...(stored.storage ?? {}) },
    ui: { ...DEFAULT_SETTINGS.ui, ...(stored.ui ?? {}) },
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await writeJson(settingsFile(), settings)
}
