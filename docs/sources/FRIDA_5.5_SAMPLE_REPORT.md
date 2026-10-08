# Frida 5.5 (DTU) — landing-zone sample report

**Why this file exists:** last mapping-survey source so a national European table cannot surprise the observation schema after load.  
**Date landed:** 2026-09-22  
**Files:**  
- `data/raw/frida/5.5/Frida_5.5_Dataset.xlsx` (12 MB)  
- `data/raw/frida/docs/Frida5.5_Documentation_English.pdf`  
**DOI:** 10.11583/DTU.29500682  
**License:** dataset CC-BY 4.0 (credit DTU Food / frida.fooddata.dk). Docs © DTU.

## Sheets as stored

| Sheet | Rows | Role |
|---|---|---|
| Readme | 20 | copyright |
| Data_Table | 1,385 × 234 | wide published values |
| **Data_Normalised** | **141,562 × 14** | long observations + stats + source |
| Food | 1,381 × 213 | generic foods + classification codes |
| FoodGroup | 143 | hierarchy |
| Parameter | 228 | component dictionary + external ids |
| Source | 500 | bibliographic refs |

Grain = generic Danish-market food (`FoodID` + English `FoodName` + Danish name). Not barcodes.

## The columns that would have caused a refactor

**Parameter** (228 components) already carries:

- `ParameterID` (Frida’s own ticket)
- `EurofirComponentID` (ENERC, PROT, VITA, RETOLAT, FOL, NIAEQ, …) — **EuroFIR tags, same family as INFOODS**
- `EurofirUnitID`, `EurofirMatrixUnitID`
- `EFSA_PARAM_Code` / name
- Chemistry: PubChem, KEGG, ChEBI, ChEMBL, HMDB, CAS, SMILES, formula

EuroFIR/EFSA/PubChem columns are populated on all 228 rows (some EFSA nulls exist in practice; energy four ways still share `ENERC`).

**Food** already carries:

- `FoodEx2Code` + description (same idea as WAFCT sheet 10)
- `LangualCode`
- `NCBI` taxonomy
- `EurofirFoodGroup`
- `TaxonomicName`

**Data_Normalised** is the observation table we would have designed anyway:

`FoodID`, names, `ParameterID`, `ResVal`, `Min`, `Max`, `Median`, `NumberOfDeterminations`, `Source`, `SourceFood`

Basis implied by Parameter.Unit (`g/100g`, `kJ/100g`, `RE (µg/100g)`, `NE`, `alfa-TE`).

## Expression splits (same pattern as WAFCT / USDA)

Frida stores **multiple parameters for one popular name**:

- Energy kJ / Energy labelling kJ / Energy kcal / Energy labelling kcal — all EuroFIR `ENERC`
- Protein / Protein from amino acids / Protein, labeling — all EuroFIR `PROT`
- Vitamin A (RE) vs Retinol vs beta-Carotene
- Vitamin D vs D2 vs D3 vs 25-OH D2/D3 (Frida changed 25-OH factors across versions; EFSA 2.5×)
- Niacin vs Niacin equivalent
- Folate vs Folate, free

Canonical Nutrient must keep **expression + unit**, not only “vitamin D”.

## Mapping implications

1. EuroFIR component ids are a **fifth ticket family**, but they are the international face of INFOODS-style tagnames. Crosswalk can treat `infoods:` and `eurofir:` as close cousins, not a new entity.
2. FoodEx2 + LanguaL belong on **Food classification**, not on Nutrient and not on Observation.
3. Min / max / median / n-samples belong on Observation (USDA has sample stats in Foundation; Frida makes them first-class).
4. SourceID is a bibliographic key — keep provenance, do not flatten.
5. Wide `Data_Table` is a published view of the same facts as `Data_Normalised`. Ingest the long sheet.

## Samples

- `data/samples/frida/parameters.csv` — full 228-row dictionary  
- `data/samples/frida/frida_sample_report.json`  
- sheet previews + example foods under `data/samples/frida/`
