# Observation fields (locked 2026-09-28)

These are the load-script columns for `FoodNutrientObservation` (and the same shape for a compound observation, with `compound_id` set instead of `nutrient_id`).

Kinds were already listed in `SCHEMA-FREEZE.md`. This file names the columns.

Do not add a new kind without updating SCHEMA-FREEZE first.  
Nullable means the script writes empty, not zero.

---

## Keys

| column | required | notes |
|---|---|---|
| source_id | yes | `usda-fdc`, `off`, `wafct`, `frida`, … |
| source_version | yes | folder name, e.g. `foundation-2026-04-30` |
| source_food_id | yes | `fdc_id`, OFF barcode, WAFCT Code, Frida FoodID |
| food_id | no | our generic Food id. Empty on first load |
| product_id | no | branded / barcode row when the grain is Product (OFF) |
| code_family | yes | `usda`, `off`, `infoods`, `eurofir`, `frida`, `foodb-nutrient`, `foodb-compound` |
| code | yes | ticket as published (`208`, `vitamin-c`, `VITC`, …) |
| code_alt | no | FDC integer id, EuroFIR id, … |
| nutrient_id | no | our slug when mapping_status is nutrient |
| compound_id | no | set when mapping_status is compound |
| mapping_status | yes | `nutrient` or `compound`. Do not load `ignore` rows |

One row = one published amount for one source food + one ticket + one expression + one basis.

---

## Amount

| column | required | notes |
|---|---|---|
| amount | no | as published. Empty if the cell was blank |
| amount_unit | yes if amount set | as published (`G`, `MG`, `KCAL`, `kJ`, …) |
| amount_canonical | no | converted into Nutrient.unit. Empty if compound or no conversion |
| canonical_unit | no | copy of Nutrient.unit when `amount_canonical` is set |
| basis | yes | `100g` \| `100g_ep` \| `100ml` \| `serving` \| `label` |
| expression | no | `RAE`, `RE`, `IU`, `atwater_general`, `atwater_specific`, `added`, `labelling_kJ`, … |
| is_empty | yes | true when the source cell was blank. Empty ≠ zero |

Do not write yield, retention, or edible-portion factors as amounts. Those are related facts, not this table.

---

## Quality

| column | required | notes |
|---|---|---|
| derivation | no | lab, compiled, recipe, label, calculated, or source derivation id/text |
| method_text | no | method / original unit text when the source has it |
| min | no | Foundation / Frida |
| max | no | |
| median | no | |
| n | no | number of determinations |
| footnote | no | |
| citation_id | no | bibliographic source when present |

---

## Not on this table

- Food name, group, LanguaL, FoodEx2 (those live on Food / classification)
- Nutri-Score / Nova
- Panel denormalized columns (that is `FoodNutrientPanel`, rebuilt after load)
- Organ effects

---

## V1 read path

Long observations are the source of truth.  
V1 intake panel: selected source_version + `mapping_status = nutrient` + the display expression chosen per Nutrient (energy / vit_a still open).  
V1 composition view: same food + `mapping_status = compound` (and extra nutrient expressions).
