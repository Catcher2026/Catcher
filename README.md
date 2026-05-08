# Catcher

> Open-source, local-first, AI-powered web testing.
> Describe what you want to test in plain English. Catcher drives a real browser via Playwright and uses an LLM to plan actions, locate elements, and verify pass/fail.

[![Release](https://img.shields.io/github/v/release/Catcher2026/Catcher?include_prereleases)](https://github.com/Catcher2026/Catcher/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## What is it

Catcher is a desktop app for writing and running end-to-end browser tests **without writing selectors**. You write steps in natural language:

```
Click the 'Sign in' button
Type 'alice@example.com' in the email field
Type 'hunter2' in the password field
Click the 'Continue' button
Verify the page contains 'Welcome, Alice'
```

Catcher's planner translates each step into a Playwright action by combining (a) a deterministic heuristic match against the live DOM, (b) the page's ARIA tree, and (c) an LLM that picks the right element when the heuristic isn't confident. If a click still misses (overlay, off-screen, autocomplete dropdown), it falls back through native DOM clicks and a vision-based coordinate fallback that asks the LLM to point at a screenshot.

Everything runs locally. Your sites, sessions, and screenshots stay on your machine; only the prompts and screenshots Catcher needs to plan a step are sent to whichever LLM provider you configure.

## Why

Traditional E2E tests break every time someone renames a class or restructures a flex container. Catcher tests describe *intent*, so a button moving from `<button class="btn-primary">` to `<a role="button" class="cta">` doesn't break anything as long as the visible label is still `Sign in`.

It's aimed at:
- Indie devs and small teams who can't justify a Playwright/Cypress suite
- PMs / designers who want to smoke-test their own flows before shipping
- Anyone tired of fixing selectors

## Install

Download the latest installer for your platform from the [Releases page](https://github.com/Catcher2026/Catcher/releases):

- **Windows** — `Catcher Setup x.y.z.exe` (NSIS installer, ~290 MB)
- **macOS Apple Silicon** — `Catcher-x.y.z-arm64.dmg`
- **macOS Intel** — `Catcher-x.y.z.dmg`

> The installers are **unsigned** (no Apple Developer or Windows code-signing certificate yet).
>
> - Windows SmartScreen will warn "Unknown publisher". Click **More info → Run anyway**.
> - macOS Gatekeeper will refuse to open the app on first launch. Right-click the app → **Open**, then confirm. Or run `xattr -dr com.apple.quarantine /Applications/Catcher.app`.

## Quick start

1. Launch Catcher.
2. Open **Settings** → pick a model from the dropdown (GPT-4o, Claude Sonnet, Gemini Pro, etc.) and paste your API key. All preset models support vision (used for the coordinate-fallback feature).
3. Click **+ Add site**, give it a URL.
4. Click **+ New test** → add steps.
5. Press **▶ Run this test**. Watch the live browser preview in the right drawer.

For a richer guide on writing steps that the planner handles reliably, see [`PROMPT_WRITING_GUIDE.md`](PROMPT_WRITING_GUIDE.md). The short version:

- **Quote any literal**: `Click the 'Save' button`, `Type 'hello' in the search box`, `Verify the page contains 'Order placed'`. Quoted strings get a deterministic substring match — they almost can't go wrong.
- **One action per step.** Split "fill the form and submit" into separate Acts.
- **For asserts**, quote whatever the user would actually see on the page.

## Features

- **Three step types**
  - **Act** — click, type, hover, select, navigate, etc. (LLM-planned)
  - **Assert** — verify text, visibility, URL, count (deterministic when quoted; LLM-judged otherwise)
  - **Wait** — explicit pause in seconds, no LLM call
- **Auth profiles** — sign in once via a real browser window, the session persists. Each test can pin its own profile; Run-all uses each test's saved profile.
- **AI generate steps** — describe a flow ("verify the contact page links to Twitter and email") and Catcher inspects the live page to draft a step list you can edit before running.
- **Live run drawer** — streams the browser viewport as JPEG frames + per-step reasoning so you can see exactly what the planner clicked and why.
- **Vision fallback** — if a click fails (overlay, occlusion, animation), Catcher captures a pre-click screenshot and asks the LLM to return `{x, y}` coordinates to click. Costs nothing when not needed.
- **Local-first** — all data in `~/.catcher/`. Nothing is uploaded except the prompts/screenshots required by your chosen LLM provider.
- **Pluggable LLMs** — OpenAI, Anthropic, Gemini, any OpenAI-compatible local server (Ollama, LM Studio, vLLM), or a custom URL.

## Configuration

Settings are stored in `~/.catcher/settings.json`. Most users only need to touch:

| Field | Default | Notes |
|---|---|---|
| LLM provider + model | OpenAI `gpt-4o-mini` | Pick from the Settings dropdown — all presets support vision |
| API key | empty | Stored locally; sent only to the provider you chose |
| Send screenshot to LLM | on | Required for vision-based click fallback. Pre-defined models all support this. Custom endpoints may not — accuracy drops if their model lacks vision |
| Headless | on | Turn off to watch the browser locally during a run |
| Action timeout | 5000ms | How long Playwright waits before falling back |
| Confidence threshold | 0.7 | Asserts below this become "needs review" instead of pass/fail |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Renderer (React)                   │
│  Sidebar · Tests · Editor · Run drawer · Settings       │
└──────────────────────────┬──────────────────────────────┘
                           │ IPC (window.catcher)
┌──────────────────────────┴──────────────────────────────┐
│                  Main process (Electron)                │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐ ┌──────────┐  │
│  │ storage  │  │  runner  │  │ generate │ │   auth   │  │
│  └──────────┘  └────┬─────┘  └─────┬────┘ └────┬─────┘  │
│                     │              │           │        │
│              ┌──────┴──────────────┴───────────┴─────┐  │
│              │   snapshot · actions · llm clients   │  │
│              └─────────────────┬────────────────────┘  │
└────────────────────────────────┼────────────────────────┘
                                 │
                          Playwright (Chromium)
```

- `electron/runner.ts` — execution engine: per-step plan, retry, vision fallback, screencast, cancel handling
- `electron/snapshot.ts` — collects the ARIA tree + ranked clickable list + overlay detection that the planner sees
- `electron/actions.ts` — translates a `PlannedAction` into a Playwright call, with the click fallback chain (Playwright click → corner-click for backdrops → native `el.click()` via `page.evaluate` → vision coordinates)
- `electron/generate.ts` — AI test-generation (looks at the live page once, drafts a step list)
- `electron/llm.ts` — provider-agnostic completion API (OpenAI, Anthropic, Gemini, OpenAI-compatible)

## Development

Requirements: Node 20+, Git.

```bash
git clone https://github.com/Catcher2026/Catcher.git catcher
cd catcher
npm install            # postinstall downloads Chromium into node_modules/playwright-core/.local-browsers
npm run dev            # vite + electron in watch mode
```

### Useful scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Run the app in watch mode (Vite + Electron, hot reload) |
| `npm run build:renderer` | Type-check + build the React renderer |
| `npm run dist:win` | Build the Windows installer (NSIS `.exe`) into `release/` |
| `npm run dist:mac` | Build the macOS `.dmg`s into `release/` *(must run on macOS)* |
| `npm run dist` | Build both at once *(macOS only)* |

### Repo layout

```
catcher/
├── electron/        Main-process code (Node) — runner, snapshot, actions, llm
├── shared/          Shared types + IPC contract between main and renderer
├── src/             Renderer (React) — components, store, hooks
├── .github/
│   └── workflows/
│       └── release.yml   Builds Win + Mac installers on tag push
├── PROMPT_WRITING_GUIDE.md   How to write steps that the planner handles well
└── package.json
```

### How a step gets executed

1. `runner.executeStep` takes a snapshot of the page (ARIA tree + ranked clickable elements + overlays).
2. **Heuristic pass** — `extractTargetTokens` pulls quoted literals (priority) or content tokens out of the description. Each clickable gets a relevance score against tokens. If one element clearly wins, it becomes the **recommended action**.
3. **Fast path** — for simple `Click 'X'` style steps with a confident heuristic match, the LLM is skipped entirely. Saves a round-trip and prevents the LLM occasionally drifting to a visually-adjacent wrong element.
4. **LLM plan** — otherwise the planner LLM gets the snapshot + recommended action + cardinal rules (don't pick occluded elements, prefer selectors when an overlay is open, etc.) and returns a single `PlannedAction` or sequence.
5. **Execute** — `actions.executeAction` runs Playwright with a multi-step click fallback:
   `loc.click()` → corner-click for backdrop selectors → native `el.click()` via `page.evaluate` → vision-coordinate fallback (LLM points at a pre-click screenshot).
6. Asserts run through `judgeAssert`. If the step text contains a quoted literal, a deterministic substring check runs instead of asking the LLM.

## Releases

Releases are produced by `.github/workflows/release.yml` on tag push.

```bash
# bump the version field in package.json
git commit -am "release v0.1.1"
git tag v0.1.1
git push origin main v0.1.1
```

The workflow builds both Windows and macOS in parallel on GitHub-hosted runners, and electron-builder uploads the artifacts to a draft release on the [Releases page](https://github.com/Catcher2026/Catcher/releases). Edit and click **Publish release** when ready.

## Privacy

- All site data, sessions, and run history live under `~/.catcher/`.
- Catcher only contacts the LLM provider you configure. The base URL, request body, and screenshots being sent are visible in `Settings → Log all LLM calls` if you want to audit.
- No telemetry, no analytics, no auto-update beacons.

## Limitations

- Chromium-only (Firefox/WebKit work in dev but aren't bundled in the installer yet).
- LLM cost is paid by you; budget guardrails exist in Settings but are advisory.
- The vision fallback is only as good as the model — preset models all handle it; a Custom-URL endpoint might not, in which case accuracy drops to whatever the heuristic + plain LLM planner can manage.
- No code signing yet (see Install section for Gatekeeper / SmartScreen workarounds).

## Contributing

PRs welcome. The project is small enough that opening an issue first to discuss the change is appreciated, but not required for obvious bug fixes.

When working on the planner or click pipeline, the relevant test page is whatever site is loaded in dev mode — there is no separate test harness. Run `npm run dev`, point Catcher at a site, and watch the run drawer's reasoning text.

## License

MIT — see [LICENSE](LICENSE).
