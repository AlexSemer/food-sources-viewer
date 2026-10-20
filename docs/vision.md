# Vision

A browser for landed food-composition dumps, one SQLite file per source. Inspection only: no cross-source mapping, no product database yet.

## What it is

Food Sources Viewer. `apps/web` is React + Vite. `apps/api` is Node with node:sqlite. Ingest lives in `packages/ingest`. The Vercel copy is a password-protected sample of five sources, cut to the first 200 main foods.

## Status

- Stage: early
- Progress: 40
- Deployed: yes (sample)
- Live: https://food-sources-viewer.vercel.app
- Repo: AlexSemer/food-sources-viewer
- Branch: main

## Future work

- [x] Basic listing and sample deploy
- [ ] Source comparison view that stays honest about missing mapping
- [ ] Search and filters that work on the sample without scanning the full dumps
- [ ] Decide what the product database is, separate from this viewer

## Bot brief

Improve the sample viewer before inventing a product database. Do not commit raw USDA, OFF, FooDB, Frida, WAFCT, or FAO dumps. Commit only; do not deploy unless asked.
