<!-- archived 2026-09-27 -->
> Merged into `docs/decisions/LOCKED.md` §§4–5.

STAGE: role-data-combiner
TICKET: RES-NUTRI-20260927-01
STATUS: approved
NEXT: critic pass, then observation field list — still no DB

PROJECT: NUTRI

# Mapping rules (locked 2026-09-27)

You do not need to be a chemist. Every incoming code gets **one of four fates**.

## Fates

1. **mapped** — this is an intake Nutrient we named (`protein`, `vit_c`, `sucrose`, …).
2. **ignore** — not a food amount (pH, archived column, yield factor, Nutri-Score).
3. **unmapped** — real number, no Nutrient id yet. Load it anyway. Hide it from V1 totals.
4. **compound** (noted as unmapped + COMPOUND) — named chemical, not an intake target.

## Waterfall (apply in order)

1. Exact map already known → that Nutrient.  
2. Not a composition amount → ignore.  
3. Same substance, different accounting (added vs intrinsic, RE vs RAE, labelling vs lab) → **same Nutrient** + `expression` / fraction on the code. Never `iron_added`.  
4. People track it or the panel shows it → Nutrient.  
5. Named chemical, no target → Compound layer.  
6. Else unmapped. Do not invent an id.

## Load

Scripts store **all** observations that have an amount.  
`nutrient_id` may be empty. Source code is always stored.  
V1 UI = USDA Foundation + **mapped** Nutrients only.

## Locked Nutrient extras

On top of the original 38: water, alcohol, ash, cholesterol, sugars, added_sugars, starch, salt, trans_fat, ala, linoleic, retinol, beta_carotene, **glucose, fructose, sucrose, lactose, maltose**.

Child sugars must not be added onto `sugars` in a daily total.

Galactose, amino acids, most single fatty acids, organic acids, phytate: still unmapped / compound. Promote later if a feature needs them.

OPEN QUESTIONS:
- Observation field list freeze for the load script
- Whether first user-run script loads Foundation values only or all landed sources

HANDOFF TO: role-research-critic
