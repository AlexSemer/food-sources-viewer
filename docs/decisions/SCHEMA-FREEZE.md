# Schema freeze checklist

Purpose: list every *kind of fact* seen in landed files so a later source cannot force a rewrite.

New **rows** are fine. New **kinds** need this file updated first.  
No database load until this list still matches what we are about to write.

---

## Entities that stay separate

- Food (generic, source-agnostic)
- Product (barcode / brand / label)
- Nutrient (ours; not USDA id, not Frida ParameterID)
- NutrientCode (source ticket → Nutrient + unit + expression)
- FoodNutrientObservation (one measured / compiled / label value)
- FoodSource + version
- Compound (FooDB chemistry; optional promote to Nutrient later)
- Classification codes on Food (FoodEx2, LanguaL, NCBI) — not nutrients
- Bibliographic Source / citation on observations

---

## Observation fields we must allow

- amount + unit + basis (`100 g`, `100 g EP`, `100 ml`, serving, label)
- min / max / median / n determinations (Frida, USDA Foundation)
- derivation (lab, compiled, recipe, label, calculated)
- expression (labelling energy vs Atwater; protein N×6.25 vs food-specific; VITA vs VITA_RAE; folate vs free folate)
- method / original unit as text when the source has it
- source id + source version + source food id + citation id
- edible portion / yield / retention as related facts, not nutrient values
- empty ≠ zero

Column names: `docs/decisions/OBSERVATION-FIELDS.md` (locked 2026-09-28).

---

## Ticket families for NutrientCode

- `usda` nutrient.id / nutrient_nbr
- `off` slug (`vitamin-c`)
- `infoods` tagname (`VITC`, `ENERC`)
- `eurofir` component id (Frida Parameter.EurofirComponentID — often same strings as INFOODS)
- `frida` ParameterID
- `foodb-nutrient` id (39 macros/FA only)
- `foodb-compound` public_id (chemistry)

---

## Explicitly out of Nutrient

- Nutri-Score, Nova, ecoscore
- HealthEffect / Flavor graphs
- Food groups and LanguaL facets

---

## Still deferred (coverage, not new kinds)

- AnFooD (same tagnames, analytical-only grain)
- CIQUAL (same compiled-national job as Frida)
- EuroFIR consortium extract (license)
- FooDB Content.json full stream
- CoFID

If a new file only adds foods or more codes in the families above: append.  
If it invents a fact not on this list: stop and extend this checklist before load.
