# NullProbe

> Open-source, local-first AI-powered web testing tool.
> Describe what you want to test in plain English. NullProbe drives a real browser via Playwright and uses an LLM to verify pass/fail.

## Status: scaffold (MVP in progress)

## Stack
- Electron + Vite + React + TypeScript + Tailwind
- Playwright for browser automation
- Pluggable LLM providers (OpenAI / Anthropic / Gemini / OpenAI-compatible)

## Dev

```bash
npm install
npx playwright install chromium
npm run dev
```

## Data location
All data lives in `~/.nullprobe/`. Nothing is sent anywhere except the LLM provider you configure.

## Feedback
Found a bug or have a suggestion? Open an issue:
https://github.com/REPLACE_ME/nullprobe/issues/new
