# food-sources-viewer

Local browser for landed food-composition dumps. One SQLite file per source. No cross-source mapping.

This is not the product app. NestJS comes later.

## Stack (viewer only)

- React + Vite + TypeScript
- Node `http` + TypeScript (no Express / Nest / Hono)
- better-sqlite3
- `datasources/` raw files (gitignored)
- `data/*.sqlite` generated (gitignored)

## Setup

```bash
cd food-sources-viewer
npm install
```

Copy dumps into `datasources/` (see that folder’s README). Then:

```bash
npm run ingest -- usda-foundation
npm run dev:api
npm run dev:web
```

UI: http://localhost:5173  
API: http://localhost:3001

Other sources are stubs until the next pass:

```bash
npm run ingest -- usda-sr-legacy
npm run ingest -- off
npm run ingest -- wafct
npm run ingest -- frida
npm run ingest -- foodb
```

## Rule

Do not put USDA / OFF / FooDB / Frida / WAFCT files in git.
