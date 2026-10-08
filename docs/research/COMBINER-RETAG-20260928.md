STAGE: role-data-combiner
TICKET: RES-NUTRI-20260927-01
STATUS: draft
NEXT: light re-critic on these diffs

# Combiner retag after critic

Decisions: `docs/decisions/CRITIC-FOLLOWUP.md`  
Headlines: `docs/decisions/HEADLINES.md`

## Done

- Fate vocabulary is now `nutrient` / `compound` / `ignore`. Zero `unmapped` / `mapped` left.
- `COMPOUND` removed from `nutrient_id`.
- `fluoride` added to `data/nutrients/nutrient.csv` (82 Nutrients). USDA 313 + Frida 142 + EuroFIR FD + OFF fluoride mapped.
- Folate vitamers → `vit_b9` + expression. Tocopherol / tocotrienol forms → `vit_e` + expression. Niacin 406/407/409 distinguished.
- EuroFIR `NULL` codes rewritten to Frida ParameterID. `SUGAR` split total vs free, both → `sugars`.
- WAFCT `CARTB` / `NIA` / `TOCPHA` split by expression.
- Exact spelling-twin rows dropped (3). `nutrient-codes-all.csv` rebuilt from `by-source/`.
- Uniqueness `(family, code, unit, expression, source_version)`: 0 collisions.

## Counts now

1633 tickets: 561 nutrient / 1035 compound / 37 ignore.

## Not done

- FooDB Content.json still zipped.
- Compound → Nutrient identity links (ascorbate is `vit_c`) still later.
- No database.
