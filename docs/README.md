# NUTRI docs

Read this page first. Then only the folder you need.

## Locked (do not quietly change)

1. `decisions/LOCKED.md` — Nutrient vs Compound, V1 source, mapping waterfall, load scope, extras
2. `decisions/SCHEMA-FREEZE.md` — fact kinds that must exist before any DB load
3. `decisions/OBSERVATION-FIELDS.md` — load-script column list

## Current mapping work

- `research/MAPPING-STATUS.md` — Nutrient list, code files, coverage, load contract already written
- Nutrient rows: `data/nutrients/nutrient.csv` (same data as `nutrient.json`)
- All source tickets: `data/nutrients/nutrient-codes-all.csv`
- Per-source tickets: `data/nutrients/by-source/`

## Landed sources

- `sources/SOURCE-LANDING-INDEX.md` then the five sample reports in the same folder
- Raw files stay under `data/raw/<source>/<version>/` — do not move or edit
- Head samples stay under `data/samples/`

## Not current

- `archive/ARCHITECTURE-2026-07.md` — July product sketch. Not a contract.
- `schemas/archive-2026-07/` — Food embeds nutrients; Nutrient has `usda_nutrient_id`. Replaced on paper by Nutrient + NutrientCode + Observation.
- `data/nutrients/archive/` — July 38-item list and the partial 333-row code draft
- `data/incoming-dumps/` — USDA extracts that used to sit in the repo root. Not the product database.
- `prototypes/body-health-visualizer.html` — UI sketch only

## Still not done

Paper-plan, UML, contracts, load scripts, and any database.

## Open questions (one list)

Locked 2026-09-28: all landed composition sources; salt stays a Nutrient; full observation columns; keep every published amount; destinies are ignore / nutrient / compound; UI = intake panel + composition view.

Locked 2026-09-28 also: class B (amino acids + galactose + chloride). Promote/demote is a map edit.

Locked 2026-09-28 also: V1 energy headline = USDA 208 kcal.

Locked 2026-09-28 also: V1 vit_a headline = USDA 320 RAE; no conversion in the loader.

Locked 2026-09-28 also: FooDB Compound.json = catalog now (`data/compounds/compound.csv`); Content.json amounts later.

Open questions from the 28 Sep pass: none.

Critic + combiner retag: `docs/research/CRITIC-RES-NUTRI-20260927-01.md`, `docs/research/COMBINER-RETAG-20260928.md`. Fates cleaned. Next product step is paper-plan, not a database.
