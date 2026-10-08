# Mapping status

Paper-plan waits. Load waits. This cell produced maps the future scripts will read.

Locked rules live in `docs/decisions/LOCKED.md`. Do not restate a new rule here.

---

## Working files

| File | Role |
|---|---|
| `data/nutrients/nutrient.csv` | intake list (existing + proposed). Same content as `nutrient.json` |
| `data/nutrients/nutrient-codes-all.csv` | concat of every family dictionary |
| `data/nutrients/by-source/usda-foundation-nutrient-codes.csv` | Foundation tickets |
| `data/nutrients/by-source/usda-sr-nutrient-codes.csv` | SR Legacy dictionary |
| `data/nutrients/by-source/off-nutrient-codes.csv` | OFF slugs |
| `data/nutrients/by-source/wafct-nutrient-codes.csv` | INFOODS tagnames |
| `data/nutrients/by-source/frida-nutrient-codes.csv` | Frida parameters |
| `data/nutrients/by-source/eurofir-from-frida-nutrient-codes.csv` | EuroFIR ids via Frida |
| `data/nutrients/by-source/foodb-nutrient-codes.csv` | FooDB 39 + compound rule |
| `data/nutrients/archive/canonical-nutrients.json` | July list of 38. Superseded as the working list |
| `data/nutrients/archive/draft-nutrient-code.csv` | Partial 333-row first pass. Do not use for load |

Code CSV columns: `family, code, alt_code, source_name, source_unit, expression, nutrient_id, status, notes, source_version`

---

## Nutrient list

38 existing from the July file, plus the extras locked in `LOCKED.md` §5.

Not promoted:

- phytate (WAFCT only) — unmapped
- every individual fatty acid not already named — unmapped
- FooDB compounds — do not flatten 70k rows into Nutrient
- scores (Nutri-Score, Nova) — ignore
- yield / retention / N-factor (`EDIBLE1`, `XN`) — ignore

---

## Coverage (2026-09-27)

USDA Foundation (477 tickets): **90 mapped / 10 ignore / 377 unmapped**

`nutrient-codes-all.csv`: **1636 tickets** across usda, off, infoods, frida, eurofir, foodb-nutrient, foodb-compound.

WAFCT component sheet has no iodine, selenium, choline, B5, B7, or vitamin K. Those Nutrients stay valid; those families just have no ticket.

---

## Load contract already written (scripts later)

Not a script. Rules the future script must obey.

1. Read raw files from `data/raw/<source>/<version>/` only.
2. Resolve every incoming component through NutrientCode (family + code + unit + expression). Unknown real amount → Compound id, never invent a Nutrient id, never drop the row.
3. Write FoodNutrientObservation (or Compound observation), not `Food.nutrients = {…}`.
4. Keep source unit as published. Convert to Nutrient.unit only as an extra column.
5. Empty is not zero.
6. Pin FoodSource.version to the folder name (e.g. `foundation-2026-04-30`).
7. First script loads Foundation + SR + OFF + WAFCT + Frida. V1 defaults to Foundation. Intake panel = Nutrients. Composition view = Compounds. FooDB Content.json is pending extract, not dropped.
8. Every loaded row has `nutrient_id` or `compound_id`. Ignore rows are not amounts. Source code is always stored.
9. Columns: `docs/decisions/OBSERVATION-FIELDS.md`.

---

## What this is not

- Not a load script
- Not a food identity crosswalk
- Not a change to the July JSON schemas (those are archived)
- Not a paper-plan

---

## Next in this cell

Observation columns are locked. Load scope is locked (all landed composition sources).

Class B promotions applied on the Nutrient list and matching source tickets (98 code rows retagged). Pair/sum AA tickets left as Compound.

V1 energy headline locked: USDA 208 kcal. Other energy tickets stay as expressions.

V1 vit_a headline locked: USDA 320 RAE. RE / IU stay as expressions. No conversion in the loader.

FooDB: Compound catalog at `data/compounds/compound.csv` (70,477). Content.json stays zipped.

Open questions in this cell: none.

Combiner retag 2026-09-28 applied (`COMBINER-RETAG-20260928.md`). Fates are nutrient / compound / ignore. 1633 tickets, 0 key collisions.

No load script in this cell. Next product step: paper-plan.
