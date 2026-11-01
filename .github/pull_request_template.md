## What changed

<!-- One or two sentences, then a short list of the files or functions that matter. -->

## Why

<!-- The issue's goal in your own words. -->

Closes #

## How to test

<!-- Exact commands or clicks. Say which providers (mock / fixture / serpapi) you used. -->

```bash
npm run check
```

## Screenshots

<!-- UI changes only: light and dark, desktop and phone width. Delete this section otherwise. -->

## New dependencies

<!-- Name each one and why it is needed, or write "None". -->

## Checklist

- [ ] No keys, `.env*` (other than `.env.example`), `data/cache/`, or `data/runs/` committed
- [ ] New or changed fixtures checked for API keys and tokens
- [ ] No live API calls (SerpApi, OpenRouter, Open-Meteo) in tests
- [ ] The MCP server logs to stderr only
- [ ] `npm run check`, `npm run lint`, and `npm run build` pass
