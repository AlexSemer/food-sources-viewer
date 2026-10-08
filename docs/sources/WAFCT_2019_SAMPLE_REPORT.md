# FAO/INFOODS WAFCT 2019 — landing-zone sample report

**Slice:** land one official Excel workbook, sample sheets as stored, do **not** load the product database.  
**Date landed:** 2026-09-22  
**File:** `data/raw/fao-infoods/wafct-2019/WAFCT_2019.xlsx` (3.0 MB)  
**URL used:** `https://www.fao.org/fileadmin/user_upload/faoweb/2020/WAFCT_2019.xlsx`  
**What it is:** compiled *user* table for Western Africa (not a branded catalog, not USDA). Values per **100 g edible portion (EP)**.

## Workbook as stored (12 sheets)

| Sheet | Rows (approx) | Role |
|---|---|---|
| 01 Introduction | 26 | copyright / how to read |
| 02 Components | 60 | **tagname dictionary** (English, French, unit, method) |
| 03 NV_sum_39 (per 100g EP) | 1058 | condensed composition, ~39 components |
| 04 NV_stat_39 (per 100g EP) | 3812 | same foods with statistics rows |
| 05 NV_sum_57 (per 100g EP) | 1058 | fuller composition, ~57 components |
| 06 NV_stat_57 (per 100g EP) | 3812 | fuller + stats |
| 07 Yield factors | 758 | raw → cooked yield |
| 08 Retention factors | 74 | nutrient retention on processing |
| 09 Mixed dishes | 1714 | recipe ingredients |
| 10 FoodEx2 codes | 1030 | EFSA FoodEx2 mapping |
| 11 2012 vs 2019 names and codes | 491 | version bridge |
| 12 Data sources with BiblioID | 468 | citations |

Food identity on composition sheets:

`Code`, English name, French name, scientific name, `BiblioID/Source`, edible-portion coefficients.

Example codes look like `01_005` (group + sequence), not FDC ids and not barcodes. Many values are `calc. from recipe` or `calc. from / de 01_014` — compiled, not a single lab sample.

~1,000 food rows on the sum sheets (header + ~1,057).

## Nutrient codes = INFOODS tagnames

Sheet `02 Components` is the mapping gold for this source: **58 component rows**.

Units: g, mg, mcg, kJ, kcal. Denominator almost always `/100g EP`.

Same concept can have **two tagnames** when method differs, written as `FAT or [FATCE]`, `FIBTG or [FIBC]`, `VITE or [TOCPHA]`.

Energy is one tagname `ENERC` twice (kJ and kcal) — unit disambiguates.

Vitamin A is two tags on purpose:

- `VITA` = retinol equivalents (β-carotene / 6)  
- `VITA_RAE` = retinol activity equivalents (β-carotene / 12)

That is a different split than USDA (`id` 320 vs IU vs Foundation “Vitamin A” 2067) and OFF (`vitamin-a_100g` with unspecified expression). The crosswalk must keep **expression**, not only “vitamin A”.

Composition sheets themselves use **English multi-line headers** (`Energy\n(kcal)`), not the tagname in row 1. Map via the Components sheet, not by parsing header text alone.

Full extracted dictionary: `data/samples/fao-infoods/wafct_components_tagnames.csv`

## Mapping implications

1. Third code system: INFOODS tagnames. Canonical Nutrient cannot be USDA `id` or OFF slug.  
2. Basis is **100 g EP**, plus `EDIBLE1` / `EDIBLE2` coefficients — not the same as USDA “as described” 100 g or OFF 100 g-or-ml label.  
3. Wide format (like OFF), but grain is generic/regional food (like USDA Foundation), with recipes and processed forms.  
4. Yield + retention sheets are extra observation metadata, not nutrients.  
5. FoodEx2 column is a possible future join key to European tables.  
6. Scientific name is often present — useful for matching USDA Foundation cultivars later.

## Samples

- Sheet previews: `data/samples/fao-infoods/sheet_*_preview.csv`  
- Tagname list JSON: `data/samples/fao-infoods/wafct_tagname_list.json`  
- Inventory: `data/samples/fao-infoods/wafct_sheet_inventory.json`

## Still not landed

FooDB dump; other INFOODS workbooks (AnFooD, BioFoodComp); EuroFIR (no free bulk). Next candidate: FooDB **or** AnFooD if we want a second INFOODS grain (analytical archive vs user table).
