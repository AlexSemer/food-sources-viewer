<!-- archived 2026-09-27 -->
> Merged into `docs/research/MAPPING-STATUS.md`. File list paths in this archive are old.

STAGE: role-data-combiner
TICKET: RES-NUTRI-20260927-01
STATUS: draft
NEXT: critic; observation fields for load scripts

# Mapping before any load script

Paper-plan waits. Load waits. This cell only produces maps the future scripts will read.

## What “aligned” means here

Not “one true apple.”  
Each source keeps its own foods. Alignment is **our Nutrient + Compound ids**, so a later feature can hang on those ids no matter which dropdown is selected.

Food-to-food matching (USDA honeycrisp = WAFCT mango? no) is a later job.

## Load contract the scripts must obey

1. Read raw files from `data/raw/<source>/<version>/` only.
2. Resolve every incoming component through `NutrientCode` (family + code + unit + expression). Unknown code → skip or quarantine, never invent a Nutrient id.
3. Write `FoodNutrientObservation` (or Compound observation), not `Food.nutrients = {…}`.
4. Keep source unit as published. Convert to Nutrient.unit only as an extra column.
5. Empty is not zero.
6. Pin FoodSource.version to the folder name (e.g. `foundation-2026-04-30`).
7. V1 *UI* filters to USDA Foundation. Other sources may still be loaded later behind the dropdown.

## Map files

| File | Role |
|---|---|
| `data/nutrients/draft-nutrient.csv` | our intake list (existing + proposed) |
| `data/nutrients/draft-nutrient-code.csv` | curated mappings (not complete dictionaries) |
| `data/nutrients/usda-foundation-nutrient-codes.csv` | all Foundation tickets |
| `data/nutrients/usda-sr-nutrient-codes.csv` | SR Legacy dictionary |
| `data/nutrients/off-nutrient-codes.csv` | OFF slugs |
| `data/nutrients/wafct-nutrient-codes.csv` | INFOODS tagnames |
| `data/nutrients/frida-nutrient-codes.csv` | Frida parameters |
| `data/nutrients/eurofir-from-frida-nutrient-codes.csv` | EuroFIR ids via Frida |
| `data/nutrients/foodb-nutrient-codes.csv` | FooDB 39 + compound rule |
| `data/nutrients/nutrient-codes-all.csv` | concat of the above |
| `docs/MAPPING_RULES.md` | locked waterfall |

## USDA Foundation snapshot (this pass)

After waterfall + five sugars (Foundation 477):

- **90 mapped**
- **10 ignore**
- **377 unmapped** (amino acids, most fatty acids, acids, vitamers, …)

Same rule applied to SR, OFF, WAFCT, Frida, FooDB. Combined file: 1636 code rows.

## Order of work

1. Same full-dictionary CSV for SR Legacy, OFF, WAFCT, Frida, FooDB-39  
2. Decide which unmapped tickets become new Nutrient ids (sugars first is the obvious set)  
3. Observation field list frozen for the script  
4. STOP mapping cell → you run download + load scripts locally  

OPEN QUESTIONS:
- Load UNMAPPED observations into a holding table, or only load mapped codes in the first script?
- Add the five sugar molecules to Nutrient now?

HANDOFF TO: founder for those two cuts, then next dictionary
