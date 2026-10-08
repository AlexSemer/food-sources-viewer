# Source landing index

Mapping survey, not a warehouse load.

Raw files stay immutable under `data/raw/`. Samples under `data/samples/`.  
Do not ingest into Food / Nutrient product tables until the crosswalk is locked.

Locked reminder: Food is generic; Product is branded; composition lives as observations with source + version; our Nutrient ids are not USDA ids.

Also read `docs/decisions/SCHEMA-FREEZE.md` before any load.

| Source | Raw | Report | Grain on disk | Nutrient codes |
|---|---|---|---|---|
| USDA FDC Foundation 2026-04-30 + SR Legacy 2018-04 | `data/raw/usda-fdc/` | `docs/sources/USDA_FDC_SAMPLE_REPORT.md` | `fdc_id`; long `food_nutrient` | integer `nutrient.id` + `nutrient_nbr` |
| Open Food Facts food CSV.gz (2026-09-22 dump) | `data/raw/openfoodfacts/` | `docs/sources/OFF_SAMPLE_REPORT.md` | barcode `code`; wide product row | slugs `vitamin-c_100g` |
| FAO/INFOODS WAFCT 2019 xlsx | `data/raw/fao-infoods/wafct-2019/` | `docs/sources/WAFCT_2019_SAMPLE_REPORT.md` | local food `Code`; wide sheet per 100 g EP | INFOODS tagnames `VITA_RAE`, `PROTCNT` |
| FooDB JSON 2020-04-07 | `data/raw/foodb/2020-04-07/` | `docs/sources/FOODB_SAMPLE_REPORT.md` | 992 generic foods (`public_id`); Content = food × compound/nutrient | FooDB Nutrient.id (only 39) + Compound.public_id |
| Frida 5.5 (DTU, CC-BY) | `data/raw/frida/5.5/` | `docs/sources/FRIDA_5.5_SAMPLE_REPORT.md` | FoodID generic; long Data_Normalised + wide Data_Table | ParameterID + EuroFIR component id + EFSA PARAM |
