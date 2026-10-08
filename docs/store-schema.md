# Store schema

How the composition sources sit in our own tables. Decided 2026-10-08.

Sources are stored in the same column shape and never joined. A Foundation row and a Frida row do not become one food. The active preset is a table name: version 1 reads `usda_foundation_amount` only.

Two tables are shared, because they are small. Every dataset then has its own food table and its own amount table. The dataset is the table name, so amount rows do not repeat `source_id`, `source_version`, or `family`.

`nutrient` and `nutrient_code` already exist as CSV under the NUTRI tree (`data/nutrients/`). This file names the tables a later load writes. It does not create them.

## Shared

### `nutrient`

Our intake list, about 82 rows. The id is the slug (`energy`, `protein`, `vit_a`). No USDA number, INFOODS tag, or Frida parameter is an id here.

### `nutrient_code`

One row per published ticket. This is the only place a family name is stored.

| column | notes |
|---|---|
| family | `usda`, `infoods`, `frida`, `eurofir`, `off`, `foodb-nutrient`, `foodb-compound` |
| code | as published: USDA `nutrient_nbr` (`208`), INFOODS tag (`VITA_RAE`), Frida ParameterID (`12`) |
| code_alt | FDC `nutrient.id` (`1008`), or the EuroFIR tag on a Frida row |
| source_unit | as published |
| expression | `RAE`, `RE`, `atwater_general`, `available_by_difference`, or empty |
| nutrient_id | slug, when status is `nutrient` |
| compound_id | when status is `compound` |
| status | `nutrient`, `compound`, or `ignore` |

Rows with status `ignore` are not loaded into an amount table.

## Per dataset

Same two shapes for every book. Version 1 defines three pairs. A later book (SR Legacy, FNDDS, branded, Open Food Facts) gets its own pair with the same columns, not a new design. A new release of a book is a new pair, not a version column.

| dataset | food table | amount table | food id | ticket in `code` |
|---|---|---|---|---|
| USDA Foundation 2026-04-30 | `usda_foundation_food` | `usda_foundation_amount` | `fdc_id` | `nutrient_nbr` |
| WAFCT 2019 | `wafct_food` | `wafct_amount` | `code` (WAFCT `Code`) | INFOODS tag |
| Frida 5.5 | `frida_food` | `frida_amount` | `food_id` (Frida `FoodID`) | ParameterID |

### Food table

One row per source food. Names below are ours. The third column is where the value comes from.

| column | USDA Foundation | WAFCT 2019 | Frida 5.5 |
|---|---|---|---|
| food id | `food.fdc_id` where `data_type = foundation_food` | `Code` | `FoodID` |
| name | `description` | `Food name in English` | `FoodName` |
| name_local | — | `Food name in French` | `FødevareNavn` |
| group_code | `food_category_id` | code prefix (`05`) | `FoodGroupID` |
| edible_1 | — | `EDIBLE1` | — |
| edible_2 | — | `EDIBLE2` | — |
| waste_pct | — | — | parameter 252 |
| n_factor | `food_protein_conversion_factor` | `XN` | parameter 219 |

Edible portion, waste, and the nitrogen factor are facts about the food. They are never amount rows.

### Amount table

One row per published cell. WAFCT is wide in the workbook: each nutrient column becomes rows here, one per food.

| column | required | notes |
|---|---|---|
| food id | yes | the id column of that dataset's food table |
| code | yes | the ticket. Joins to `nutrient_code` for this dataset's family |
| code_alt | no | FDC id, EuroFIR tag |
| nutrient_id | no | slug copied from `nutrient_code` when status is `nutrient` |
| compound_id | no | set when status is `compound`. Never both, never neither |
| expression | no | copied from `nutrient_code`. Empty string when the map has none |
| amount | no | as published. Blank stays empty |
| amount_unit | yes if amount is set | as published (`G`, `MG`, `mcg`, `ug`, `KCAL`, `kJ`) |
| basis | yes | `100g` (Foundation, as described) or `100g_ep` (WAFCT). Frida basis is not confirmed |
| is_empty | yes | true when the source cell was blank. Empty is not zero |
| amount_canonical | no | converted into `nutrient.unit` only. Not a second method |
| canonical_unit | no | set only when `amount_canonical` is set |
| derivation | no | USDA derivation id, WAFCT calculated (`*`), Frida borrowed-from FoodID |
| method_text | no | Frida free-text unit, when it disagrees with `EurofirUnitID` |
| n | no | determinations |
| min | no | |
| max | no | |
| median | no | |
| footnote | no | raw flag text until a qualifier column exists: `tr`, `[x]`, `oa`, bracket form |
| citation_id | no | WAFCT biblio id, Frida source id. Foundation has no bibliographic id |

Unique on `(food id, code, expression, basis)`.

USDA carbohydrate `205` and `205.2` both have an empty expression today. They stay distinct because `code` differs. Do not coalesce them.

## What the screen reads

The preset names one amount table. The intake grid groups that table by `nutrient_id`. Each expression is its own row under that nutrient.

Vitamin A RAE (`code` 320, expression `RAE`) and vitamin A RE (expression `RE`) are two rows, both `vit_a`. The headline is the row the preset names. For Foundation that is RAE. RE is the other row under it. It is not added, and a missing headline is empty, not zero. Energy (208 vs 957 vs 958) and carbohydrate (fibre in vs fibre out) work the same way.

Compound rows are the composition list for the same food, not the intake grid.

## Not in these tables

- No cross-source food id. FoodOn, NCBI, and FoodEx2 are not keys.
- No `ignore` tickets (yield, Nutri-Score, WAFCT `XN` as an amount, Frida waste as an amount).
- No qualifier column. The freeze list has to change before one is added.
- USDA nutrient id 2066 has no `nutrient_code` row. Do not load those 33 amounts until it has one.
- Do not average two expressions, and do not turn RE into RAE.
