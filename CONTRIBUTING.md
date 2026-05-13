# Contributing to Catcher

**English** | [简体中文](CONTRIBUTING.zh-CN.md)

Thanks for your interest. Catcher is an Electron + Playwright + LLM testing tool — the parts most worth contributing to are the heuristics that turn a natural-language step into a reliable click, and the LLM prompts that judge whether an assertion holds.

## Quick start

```bash
git clone https://github.com/Catcher2026/Catcher.git
cd Catcher
npm install        # postinstall downloads Chromium for Playwright (~150MB)
npm run dev        # launches the Electron app in dev mode
```

## Before you submit a PR

```bash
npm test           # unit tests (vitest)
npx tsc --noEmit   # type-check
npm run build:renderer   # full build, catches integration issues
```

All three are run on every PR by [.github/workflows/ci.yml](.github/workflows/ci.yml). A green CI run is the bar for review.

## Where to put new code

The runtime is split so the pure logic is testable in isolation:

| File | Purpose | Has tests? |
|---|---|---|
| [electron/heuristics.ts](electron/heuristics.ts) | Token extraction, click-target ranking, deterministic assertion checks. **Pure functions — no Playwright, no LLM.** | yes |
| [electron/planParser.ts](electron/planParser.ts) | Parses + validates the LLM's planner JSON response. Throws `InvalidPlanError` on garbage. | yes |
| [electron/actions.ts](electron/actions.ts) | Executes a `PlannedAction` against a Playwright `Page` (click, fill, navigate, etc.). | no — touches Playwright |
| [electron/runner.ts](electron/runner.ts) | Orchestrates a run: snapshot → plan → execute → assert. Calls into the above. | no — orchestration layer |

**Rule of thumb**: if your change is a pure function, it goes in `heuristics.ts` or `planParser.ts` and ships with tests. If it has to call `page.evaluate` or the LLM, it goes in `runner.ts`.

## Adding a new click-targeting strategy

The click-recovery chain currently uses keyword overlap (see `relevanceScore` + `extractTargetTokens` in [electron/heuristics.ts](electron/heuristics.ts)). To add a new strategy:

1. Add the pure scoring/extraction function to `electron/heuristics.ts`.
2. Add unit tests in `electron/__tests__/heuristics.test.ts` — at minimum: happy path, an edge case the existing heuristic gets wrong, and any normalization quirks (CJK, smart quotes, NBSP).
3. Wire it into `planActions` in [electron/runner.ts](electron/runner.ts).

Strategy changes without tests will be asked to add them in review — heuristics are exactly the code that silently picks the wrong element when they regress.

## Updating the LLM prompt or response shape

If you change the planner's response shape:

1. Update the `PlannedAction` interface in [electron/actions.ts](electron/actions.ts).
2. Update `isValidPlannedAction` in [electron/planParser.ts](electron/planParser.ts) so the validator matches.
3. Add a test in `electron/__tests__/planParser.test.ts` for the new shape AND for the malformed-input case.

The validator is the firewall between LLM output and Playwright — if a bad shape gets past it, the failure mode is "clicked the wrong thing", not a clean error.

## Code style

- No new runtime dependencies without a strong reason. The repo currently depends on Playwright, React, and Zustand — that's the bar.
- Don't add comments that explain *what* the code does. Comments are for *why* (a non-obvious constraint, a workaround for a specific browser bug).
- Match the surrounding style (no semicolons, 2-space indent, single quotes).
