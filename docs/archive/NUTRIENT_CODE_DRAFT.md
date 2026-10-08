<!-- archived 2026-09-27 -->
> Merged into `docs/decisions/LOCKED.md` §§5–6 and `docs/research/MAPPING-STATUS.md`.
> Sugars listed here as undecided were later locked.

STAGE: role-data-combiner
TICKET: RES-NUTRI-20260923-01
STATUS: draft
NEXT: role-research-critic (after founder review)
PROJECT: NUTRI

# Draft Nutrient + NutrientCode (no DB load)

Question: from the five landed dictionaries, what is our Nutrient list and how does each source ticket point at it?

## Files

- `data/nutrients/canonical-nutrients.json` — existing list (unchanged)
- `data/nutrients/draft-nutrient.csv` / `draft-nutrient.json` — existing + proposed
- `data/nutrients/draft-nutrient-code.csv` — source tickets

Not written: any database, Food rows, observations.

## Split

**Nutrient** = our stable intake concept (`vit_a`, `protein`). Slug id. Canonical unit for *targets*.

**NutrientCode** = one published ticket in one family. Keeps the source unit and the expression. Many codes can point at one Nutrient.

Do not use USDA `id`, OFF slug, INFOODS tagname, Frida ParameterID, or FooDB id as Nutrient.id.

## Families (from SCHEMA_FREEZE_CHECKLIST)

| family | ticket | alt |
|---|---|---|
| `usda` | `nutrient_nbr` (208, 320, …) | FDC integer `id` |
| `off` | slug (`vitamin-c`) | — |
| `infoods` | tagname (`VITC`, `VITA_RAE`) | — |
| `eurofir` | component id (`ENERC`, `VITA`) | Frida ParameterID |
| `frida` | ParameterID | EuroFIR id |
| `foodb-nutrient` | public_id (`FDBN00001`) | numeric id |
| `foodb-compound` | Compound.public_id | deferred; wildcard row only |

EuroFIR and INFOODS look alike (`ENERC`, `VITA`) but are not the same family. Same EuroFIR string is reused for several Frida parameters (four `ENERC` rows). Uniqueness is `(family, code, unit, expression)`, not `code` alone.

## Nutrient draft

38 existing from `canonical-nutrients.json`.

13 proposed because the dictionaries keep publishing them and they are not the same as an existing id:

`water`, `alcohol`, `ash`, `cholesterol`, `sugars`, `added_sugars`, `starch`, `salt`, `trans_fat`, `ala`, `linoleic`, `retinol`, `beta_carotene`

Not proposed in this draft:

- phytate (WAFCT only) — UNMAPPED
- every individual fatty acid in FooDB / USDA — UNMAPPED until we need them
- FooDB compounds (vitamin C etc. live there) — do not flatten 70k rows
- scores (Nutri-Score, Nova) — IGNORE
- yield / retention / N-factor (`EDIBLE1`, `XN`) — IGNORE, not nutrients

## Mapping rules used

1. One source ticket → at most one Nutrient. Conflicts stay as extra codes with different `expression`.
2. Expression is first-class. `VITA` (RE, ÷6) and `VITA_RAE` (RAE, ÷12) both map to `vit_a`. Do not convert in the code table.
3. Unit stays as published. `energy` canonical unit is kcal; kJ codes still map to `energy`. DHA/EPA in grams map to nutrients whose unit is mg — convert only when writing an observation.
4. Label vs lab vs compiled is *not* on NutrientCode. That belongs on FoodNutrientObservation.
5. OFF `vitamin-a` and `energy` are mapped with unit/expression = unspecified. Prefer `energy-kcal` / `energy-kj` when present.
6. Salt is its own Nutrient. Sodium chloride codes do not silently become `sodium`.
7. `omega3` stays the lump. EPA, DHA, ALA are separate.

## Coverage (this draft)

| family | rows | mapped | ignore | unmapped |
|---|---|---|---|---|
| usda | 75 | most intake-relevant + a few IGNORE (pH, archived, solids) | rest of 477 not listed | individual FAs not listed |
| off | 62 | intake slugs | scores / footprint | empty FA slugs omitted |
| infoods | 51 | WAFCT 58-sheet minus phytate/factors | EDIBLE, SOP, XN, XFA | PHYTCPP |
| frida + eurofir | ~105 | macros, vitamins, minerals in the Parameter sheet | — | amino acids, individual FAs, sugars split |
| foodb-nutrient | 39 | fat, protein, carb, fiber, energy, ash | — | other 33 FA rows |
| foodb-compound | 1 rule row | — | — | all compounds |

WAFCT component sheet has no iodine, selenium, choline, B5, B7, or vitamin K. Those nutrients are still valid; those families just have no ticket.

## What this is not

- Not a load script
- Not a food identity crosswalk
- Not a change to `nutrient.schema.json` (that file still has `usda_nutrient_id` on Nutrient — that should move to NutrientCode in a later CR)
- Not a lock of the 13 proposed ids

OPEN QUESTIONS:
- Keep `salt` separate from `sodium`, or derive salt and drop the Nutrient?
- Canonical energy: USDA 208 vs Atwater 957/958 vs labelling vs metabolisable?
- Canonical vit_a stays RAE; do we store RE observations unconverted?
- Promote any FooDB compounds in v1 (ascorbate, etc.) or wait?

HANDOFF TO: role-research-critic after founder says the proposed Nutrient ids are ok
