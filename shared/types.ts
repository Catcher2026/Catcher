export type StepType = 'login' | 'act' | 'assert' | 'wait'

export interface TestStep {
  id: string
  type: StepType
  description: string
  authProfileId?: string
}

export interface TestCase {
  id: string
  name: string
  steps: TestStep[]
  createdAt: string
  updatedAt: string
  authProfileId?: string
}

export interface AuthProfile {
  id: string
  name: string
  status: 'logged_in' | 'expired' | 'never'
  lastLoginAt?: string
}

export interface Site {
  id: string
  name: string
  url: string
  createdAt: string
  defaultAuthProfileId?: string
}

export type StepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'needs_review' | 'skipped'

export interface StepResult {
  stepId: string
  status: StepStatus
  durationMs: number
  screenshot?: string
  reasoning?: string
  error?: string
  confidence?: number
}

export interface RunResult {
  id: string
  testId: string
  startedAt: string
  finishedAt?: string
  status: 'running' | 'passed' | 'failed'
  steps: StepResult[]
  tokenUsage?: { input: number; output: number; estimatedCostUsd: number }
}

export type LLMProvider = 'openai' | 'anthropic' | 'gemini' | 'local' | 'custom'

export interface LLMProviderConfig {
  provider: LLMProvider
  baseUrl?: string
  model: string
  // API key stored separately (keychain in future; for MVP scaffold, in settings.json)
  apiKey?: string
}

export interface Settings {
  llm: {
    default: LLMProviderConfig
    planner?: LLMProviderConfig
    asserter?: LLMProviderConfig
    generator?: LLMProviderConfig
    temperature: number
    maxTokens: number
  }
  engine: {
    headless: boolean
    browser: 'chromium' | 'firefox' | 'webkit'
    viewport: { width: number; height: number }
    userAgent?: string
    actionTimeoutMs: number
    navigationTimeoutMs: number
    slowMoMs: number
    fallbackToVision: boolean
  }
  assert: {
    confidenceThreshold: number
    sendScreenshot: boolean
    sendA11yTree: boolean
    sendFullHtml: boolean
    sendNetworkLog: boolean
    fullPageScreenshot: boolean
  }
  runAll: {
    mode: 'sequential' | 'parallel'
    maxParallel: number
    onFailure: 'continue' | 'stop'
    contextIsolation: 'fresh' | 'shared'
    stopOnSessionExpiry: boolean
    randomOrder: boolean
  }
  retry: {
    autoRetry: boolean
    maxAttempts: number
    delayMs: number
    retryOnAssertFailure: boolean
  }
  generation: {
    depth: 'fast' | 'deep'
    maxPagesToExplore: number
    maxStepsPerGeneration: number
  }
  cost: {
    showPerRun: boolean
    showCumulative: boolean
    monthlyBudgetUsd?: number
    logAllLlmCalls: boolean
  }
  storage: {
    dataDir: string
    keepRunHistory: number
    autoDeleteAfterDays: number
  }
  ui: {
    theme: 'light' | 'dark' | 'system'
    language: 'en' | 'zh-CN'
  }
  feedbackUrl: string
}

export const DEFAULT_SETTINGS: Settings = {
  llm: {
    default: { provider: 'openai', model: 'gpt-4o-mini' },
    temperature: 0,
    maxTokens: 4000,
  },
  engine: {
    headless: true,
    browser: 'chromium',
    viewport: { width: 1280, height: 800 },
    actionTimeoutMs: 5000,
    navigationTimeoutMs: 30000,
    slowMoMs: 0,
    fallbackToVision: true,
  },
  assert: {
    confidenceThreshold: 0.7,
    sendScreenshot: true,
    sendA11yTree: true,
    sendFullHtml: false,
    sendNetworkLog: false,
    fullPageScreenshot: true,
  },
  runAll: {
    mode: 'sequential',
    maxParallel: 3,
    onFailure: 'continue',
    contextIsolation: 'fresh',
    stopOnSessionExpiry: true,
    randomOrder: false,
  },
  retry: {
    autoRetry: true,
    maxAttempts: 2,
    delayMs: 1000,
    retryOnAssertFailure: false,
  },
  generation: {
    depth: 'fast',
    maxPagesToExplore: 3,
    maxStepsPerGeneration: 15,
  },
  cost: {
    showPerRun: true,
    showCumulative: true,
    logAllLlmCalls: false,
  },
  storage: {
    dataDir: '',
    keepRunHistory: 20,
    autoDeleteAfterDays: 30,
  },
  ui: {
    theme: 'system',
    language: 'en',
  },
  feedbackUrl: 'https://github.com/REPLACE_ME/catcher/issues/new',
}
