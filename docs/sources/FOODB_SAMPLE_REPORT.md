# FooDB — landing-zone sample report

**Slice:** official JSON dump on disk, sample stored tables, do **not** load the product database.  
**Date landed:** 2026-09-22  
**File:** `data/raw/foodb/2020-04-07/foodb_2020_04_07_json.zip` (86.6 MB)  
**URL:** `https://foodb.ca/public/system/downloads/foodb_2020_04_07_json.zip`  
**Dump date:** 2020-04-07 (still the current public bulk).  
**License:** read `foodb.ca/about` before reuse — often cited CC-BY-NC. Not CC0 like USDA.

Spectra / images / XML / MySQL were **not** downloaded.

## How it is stored (not the website)

Files inside the zip are **NDJSON** (one JSON object per line), not a JSON array. `json.load()` fails; read line by line.

| File | Size uncompressed | Role |
|---|---|---|
| Food.json | 1.3 MB | **992** generic foods |
| Nutrient.json | 18 KB | only **39** “nutrient” rows |
| Compound.json | 66 MB | **70,477** chemicals |
| Content.json | **3.50 GB** | food × source amounts (not extracted) |
| Flavor.json | 159 KB | 883 flavors |
| HealthEffect.json | 477 KB | 1,435 effect labels |
| FoodTaxonomy.json | 170 KB | taxonomy |

`Content.json` is the observation table. Do not unzip it until we need a real ingest. Stream from the zip.

## Food grain

Generic botanical / commodity foods, closer to our locked **Food** than to OFF products.

- Keys: `id`, `public_id` (e.g. FOOD00nnn), `name`, `name_scientific`, `food_group`, `food_subgroup`, `ncbi_taxonomy_id`
- 992 foods. Groups: Aquatic 169, Fruits 157, Vegetables 147, Herbs and Spices 126, …
- Names are short (“Apple”, “Olive oil”, “Milk (Cow)”). Scientific name is often present — good join hint to USDA Foundation / WAFCT.

Extract: `data/samples/foodb/foods_slim.csv`

## “Nutrient” in FooDB is not our Nutrient list

The Nutrient table is **39 rows**: Fat, Proteins, Carbohydrate, Fatty acids, Fiber, Energy, Ash, then a pile of fatty-acid shorthand (`18:2 undifferentiated`, `22:5 n-3`, …).

There is **no vitamin C, iron, folate** in `Nutrient.json`. Those live as **Compounds** (`public_id`, name, InChI, CAS, chemical class).

Content rows point at either:

- `source_type = Nutrient` + `source_id` → Nutrient.id  
- or `source_type = Compound` + `source_id` → Compound.id  

First 20k Content lines in this dump were all `source_type=Nutrient` (file is grouped). Compound contents come later in the same file.

## Content row shape (the mapping that matters)

From the first Content object (Kiwi / FAT):

- `food_id` → Food.json  
- `source_type` + `source_id` → Nutrient or Compound  
- `orig_source_id` / `orig_source_name` — borrowed codes (`FAT` looks INFOODS-like)  
- `orig_content`, `orig_min`, `orig_max`, `orig_unit` (`mg/100 g` in the peek)  
- `standard_content`  
- `orig_food_part` (Fruit, …), `preparation_type`  
- `citation`, `citation_type` (`DUKE` / `DATABASE`)

This is already an observation model: food + component + amount + unit + min/max + citation. Units are **not** normalized to one scheme.

## Mapping implications

1. FooDB is a **chemistry / bioactive layer**, not a fourth copy of the vitamin panel. Do not flatten 70k compounds into canonical Nutrient.  
2. The 39 FooDB nutrients can crosswalk to our macros / fatty acids. Vitamins and phytochemicals stay Compound observations until we promote a short “intake-relevant” subset.  
3. `orig_source_id` like `FAT` may align to INFOODS tagnames — useful, not proven for every row.  
4. HealthEffect / Flavor are side graphs, not composition.  
5. Dump is frozen 2020. Treat version as `foodb-2020-04-07`.

## Samples

- `data/samples/foodb/foodb_sample_report.json`  
- `data/samples/foodb/nutrients.json`  
- `data/samples/foodb/foods_slim.csv`  
- `data/samples/foodb/compounds_head80.json`
