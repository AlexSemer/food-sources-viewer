# Open Food Facts — landing-zone sample report

**Slice:** land the official food dump on disk, sample the stored file, do **not** load the product database.  
**Date landed:** 2026-09-22  
**License:** Open Food Facts data — open, attribution required (see world.openfoodfacts.org/data).

## What was landed (immutable raw)

| Item | Path | Size |
|---|---|---|
| Food products CSV (gzip) | `data/raw/openfoodfacts/csv-en/en.openfoodfacts.org.products.csv.gz` | 1.19 GB (1,275,171,186 bytes) |
| Official field notes | `data/raw/openfoodfacts/docs/data-fields.txt` | small |

Source URL: `https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz`  
(S3 redirect; Last-Modified 2026-09-22.)

Not downloaded: Mongo dump, JSONL, cosmetics/pet dumps, Hugging Face Parquet.

The gzip is **not** fully decompressed (~9 GB). Sampling reads the stream. A first copy onto the artifacts mount failed mid-file; the kept dump was re-downloaded, `gzip -t` passed, then copied into `data/raw`.

## How the file is actually stored (not the website)

- Encoding: UTF-8  
- Delimiter: **tab**, not comma (website products look nothing like this row)  
- Grain: **one packaged product per row**, keyed by `code` (barcode / OFF-assigned 200… code)  
- Shape: **one very wide table** — **211 columns** in this dump  

That is the opposite of USDA (`food` ⨝ `food_nutrient` ⨝ `nutrient`). OFF puts every nutriment in a column on the product row.

Official `data-fields.txt` is a **partial, older list**. The live CSV has more columns (Nutri-Score fields, Nova, ecoscore, image URLs, `added-sugars_100g`, `fruits-vegetables-legumes_100g`, …). Mapping must use the **header from the file**, not the txt doc alone.

## Identity fields (first 60,000 rows)

| Column | Fill rate in scan |
|---|---|
| `code` | 100% |
| `countries_tags` | 99.4% |
| `nutriscore_grade` | 99.0% |
| `product_name` | 92.4% |
| `brands` | 60.7% |
| `serving_size` | 59.1% |
| `categories` / `categories_tags` | 48.6% |
| `ingredients_text` | 47.0% |
| `nova_group` | 43.9% |
| `quantity` | 26.8% |
| `allergens` | 9.0% |
| `generic_name` | 1.0% |

`generic_name` is almost empty. `product_name` is a label string, not a canonical food. Same generic “whole milk” will appear as thousands of SKUs.

## Nutrition columns on disk

- **123** columns ending `_100g` (per 100 g **or** 100 ml — OFF does not split solid vs liquid in the column name)  
- **0** columns ending `_serving` in this dump (the old doc still talks about `_serving`; the file uses `serving_size` plus `_100g` only)  
- Energy exists three ways: `energy_100g`, `energy-kcal_100g`, `energy-kj_100g`  
- Salt and sodium both present (`salt_100g`, `sodium_100g`)

Fill rates among the first 60k rows (not the whole planet — early rows are biased):

| Column | Fill in scan |
|---|---|
| `energy_100g` / `energy-kcal_100g` | ~20% |
| `carbohydrates_100g`, `proteins_100g`, `fat_100g` | ~19–20% |
| `sugars_100g`, `saturated-fat_100g` | ~18–19% |
| `salt_100g` / `sodium_100g` | ~16% |
| `fiber_100g` | ~13% |
| `added-sugars_100g` | ~8% |
| `iron_100g`, `calcium_100g`, `potassium_100g` | ~5–6% |
| Most vitamins | sparse / often 0 in this slice |

**50 of 123** `_100g` columns were entirely empty in the first 60k rows. They still exist as headers (mapping targets), they are just rare on labels.

Only **12,368 / 60,000** scanned rows had *any* `_100g` value. A large share of OFF is packaging metadata without a usable nutrient panel.

Values are label-declared, not lab means. Units are implied by the suffix (`_100g`) and by OFF convention (energy also in kJ). There is no `derivation_id`.

## Sample artifacts

- `data/samples/openfoodfacts/header_columns.txt` — all 211 real headers  
- `data/samples/openfoodfacts/nutriment_100g_columns.csv` — slugs + fill rates  
- `data/samples/openfoodfacts/products_head200_slim.csv` — first 200 rows, identity + core macros  
- `data/samples/openfoodfacts/example_product_hits.csv` — keyword hits (apple juice, whole milk, rice, chicken, olive oil, banana, yogurt, eggs)  
- `data/samples/openfoodfacts/off_sample_report.json`

## Mapping implications vs USDA / locked model

1. This dump is **Product**, not **Food**. Barcode + brand + label name. Do not merge these rows into the generic Food entity.  
2. Nutrient codes are **string slugs** (`vitamin-c`, `saturated-fat`, `energy-kcal`), not USDA integer ids. Crosswalk table must accept both.  
3. Wide format must be **unpivoted** into observations (`product_code`, `nutriment_slug`, `amount`, basis=`100g_or_100ml`, derivation=`label`).  
4. Empty cells are missing label data, not zero.  
5. `nutriscore_grade` / `nova_group` are scores, not nutrients — keep them off the Nutrient list.  
6. First-N-row fill rates are not global coverage. Later ingest can compute full-file fill if we need it; not required to lock the crosswalk.

## Out of slice / next

Still not landed: FAO/INFOODS workbook(s), FooDB dump. EuroFIR still has no free bulk file.

Confirm the next landing: **one INFOODS Excel** (AnFooD or WAFCT) so we see tagnames as sheet headers.
