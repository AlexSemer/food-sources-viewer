# USDA FoodData Central — landing-zone sample report

**Slice:** download files to disk, sample structure, do **not** load the product database.  
**Date landed:** 2026-09-22  
**License:** public domain / CC0. Cite FoodData Central as the source.

## What was landed (immutable raw)

| Dataset | File | Size |
|---|---|---|
| Foundation Foods CSV, 2026-04-30 | `data/raw/usda-fdc/foundation-2026-04-30/FoodData_Central_foundation_food_csv_2026-04-30.zip` | 3.7 MB zip |
| SR Legacy CSV, 2018-04 (final) | `data/raw/usda-fdc/sr-legacy-2018-04/FoodData_Central_sr_legacy_food_csv_2018-04.zip` | 5.8 MB zip |
| Field descriptions (Oct 2020 PDF) | `data/raw/usda-fdc/docs/Download_Field_Descriptions_Oct2020.pdf` | 146 KB |

Unzipped tables sit next to each zip. Head-200 samples of every CSV: `data/samples/usda-fdc/*_head200.csv`.  
Nutrient dictionaries + id comparison:  
- `data/samples/usda-fdc/nutrient_dictionary_foundation.csv`  
- `data/samples/usda-fdc/nutrient_dictionary_sr_legacy.csv`  
- `data/samples/usda-fdc/nutrient_id_comparison.csv`  
- machine-readable dump: `data/samples/usda-fdc/usda_fdc_sample_report.json`

Not downloaded (out of this slice): FNDDS, Branded, full-all-types zip.

## How the files are actually stored (not the website)

USDA is **not** one wide “food × nutrients” spreadsheet. It is a small relational dump:

```
food.csv                 one row per fdc_id (but Foundation pack mixes 5 data types)
foundation_food.csv      469 generic Foundation foods
sr_legacy_food.csv       7,793 SR foods
food_nutrient.csv        long table: fdc_id + nutrient_id + amount + method metadata
nutrient.csv             component dictionary (id, name, unit_name, nutrient_nbr, rank)
food_category.csv        category id → name
food_portion.csv         household measures / gram weights
food_nutrient_derivation.csv   (SR pack) why the number exists
```

Foundation pack also ships sample-level science tables we do **not** treat as Foods:

- `sample_food`, `sub_sample_food`, `market_acquisition`, `agricultural_samples`, `lab_method*`

`food.csv` in the Foundation zip has **87,990** rows. Only **469** are `data_type = foundation_food`. The rest are lab samples. If we ingest `food.csv` blindly we will pollute the Food entity with “APPLEBEES - AMERICAN CHEESE” sample rows.

SR pack `food.csv` is clean: **7,793** rows, all `sr_legacy_food`.

Shared food columns in both packs:

`fdc_id, data_type, description, food_category_id, publication_date`

Identity key on disk = **`fdc_id`** (integer, unique inside FDC, not stable across a food’s lifetime in the way a barcode is). Description is a free-text USDA name, not a scientific name.

## Nutrient dictionary on disk

| | Foundation 2026-04 | SR Legacy 2018-04 |
|---|---|---|
| Rows in `nutrient.csv` | 477 | 474 |
| Shared `id` | 474 | 474 |
| Only in Foundation | 3 | — |

Foundation-only components:

| id | name | unit | nutrient_nbr |
|---|---|---|---|
| 2067 | Vitamin A | UG | 960 |
| 2068 | Vitamin E | MG | 959 |
| 2069 | Glutathione | MG | 961 |

Same `id` but **different name** (6 cases). The important collisions:

- `1063` Foundation “Sugars, Total” vs SR “Sugars, Total NLEA”
- `2000` Foundation “Total Sugars” vs SR “Sugars, Total”
- `1406` / `1408` PUFA naming looks like a historical SR typo (“PUFA 2:4 n-6”) vs Foundation “PUFA 20:4 n-6”

**Do not use USDA `id` as our Nutrient primary key without a versioned crosswalk.** Ids are mostly stable between these two packs, but names and meaning drift, and other sources will not use these ids at all.

Units already inside USDA alone:

`G, MG, UG, KCAL, KJ, IU, MCG_RE, MG_ATE, UMOL_TE, MG_GAE, PH, SP_GR`

Energy is three nutrient rows (Atwater general, Atwater specific, generic Energy kcal) plus kJ. Vitamin A exists as IU, µg, and RE-style units. That is why an observation row must keep **original nutrient_id + unit**, not assume “vitamin A = one number.”

The repo-root `artifacts/nutrient.csv` is this same USDA dictionary family (`id, name, unit_name, nutrient_nbr, rank`). Treat it as a *source coding*, not the canonical Nutrient list.

## Value table shape (`food_nutrient.csv`)

Headers are identical in both packs:

`id, fdc_id, nutrient_id, amount, data_points, derivation_id, min, max, median, footnote, min_year_acquired`

| | Foundation pack | SR Legacy |
|---|---|---|
| Rows | 170,469 | 644,125 |
| Empty `amount` | 33 | 0 |

Foundation values can carry **min / max / median / data_points** (variability). SR is mostly a single compiled `amount`.  
`derivation_id` is how USDA marks analytical vs calculated vs assumed — keep it on the observation.

Grain of a value = **per 100 g of the food identified by `fdc_id`**, unless a portion table is used. There is no “per serving” column on `food_nutrient.csv`.

## Real generic foods (after filtering data_type)

Keyword search on raw `food.csv` is unsafe (hits sample lots and restaurant strings). After restricting to `foundation_food` / `sr_legacy_food`:

**Foundation generics (examples):**

- Apples, red delicious / honeycrisp / granny smith / gala / fuji, with skin, raw (`1105430` …)
- Milk, whole, 3.25% milkfat, with added vitamin D (`322892`)
- Rice, white, long grain, unenriched, raw (`2512381`)
- Chicken, breast, boneless, skinless, raw (`2646170`)
- Oil, olive, extra virgin (`748608`)
- Bananas, ripe and slightly ripe, raw (`790991`)
- Egg, whole, raw, frozen, pasteurized (`323604`) — no simple “fresh whole egg” in this Foundation snapshot
- Fish, salmon, sockeye, wild caught, raw (`2684440`)

**SR Legacy compiled rows (examples):**

- Apples, raw, with skin (`171688`)
- Milk, whole, 3.25% milkfat, with added vitamin D (`171265`)
- Rice, white, long-grain, regular, raw, unenriched (`169756`)
- Oil, olive, salad or cooking (`171413`)
- Bananas, raw (`173944`)
- Egg, whole, raw, fresh (`171287`)

Same English idea, **different `fdc_id`, different description granularity, different method**. “Apple” is not one Food row in USDA. Foundation splits cultivars; SR publishes one composite.

## Mapping implications (for later lock, not done yet)

1. **Food** in our model ≠ `food.csv` row. Food = generic concept. Each USDA `fdc_id` is a *source observation set* attached to a Food (and for Foundation, sometimes to a cultivar/processing note).
2. **Nutrient** in our model ≠ `nutrient.id`. Need `NutrientCode(source, code, unit) → Nutrient`.
3. **FoodNutrientObservation** fits this file exactly: `fdc_id`, `nutrient_id`, `amount`, unit from dictionary, `derivation_id`, min/max/median, source version `2026-04-30` or `2018-04`.
4. Prefer Foundation analytical rows when we later pick a display value; SR fills foods Foundation does not cover.
5. Existing `food.schema.json` (`nutrients[]` embedded, `fdc_id` on Food, `brand`) is the document we must **not** load these CSVs into.

## Out of slice / next confirmation

Still not done: Open Food Facts file, FAO/INFOODS workbooks, FooDB dump, EuroFIR (blocked without membership).

Say which second landing you want:

- **OFF** CSV.gz or Parquet (large; we sample after the file is local), or  
- **one INFOODS Excel** (AnFooD or WAFCT) to see tagnames as headers.
