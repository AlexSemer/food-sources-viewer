# Locked decisions

Project: NUTRI  
Last lock: 2026-09-28  
Do not amend in a mapping file. Change this document, then trickle down.

Read in this order.

---

## 1. What the product is tracking

**Nutrient** = intake figures people track (protein, vit_c, energy, added sugars, …).  
Goals and organ effects use only this list.

**Compound** = named chemicals reported in a food (anthocyanins, caffeine, …). Separate catalog.

**Observations** hold amounts: food + nutrient *or* food + compound + source + unit + expression.

Optional later link: this Compound *is* this Nutrient (ascorbic acid → vit_c). The Compound row stays.

Rejected:

- One Component table with a type flag
- Nutrients only, compounds deferred forever
- Treating every FooDB chemical as a Nutrient
- Claiming a complete chemical inventory of food

---

## 2. What V1 shows

UI is a dataset dropdown. V1 shows **one** source. Mix mode is later.

V1 source: USDA FoodData Central, default **Foundation Foods 2026-04-30**.

Do not blend Foundation + SR Legacy + branded into one number.

SR Legacy / OFF / Frida / WAFCT load in the first script and sit behind the dropdown.  
FooDB `Content.json` is not extracted yet (size). That is a pending import, not a delete.

V1 **intake panel** = that source + Nutrients.  
V1 **composition view** = Compounds (and extra expressions) for the same food.  
Nothing that was loaded is hidden because we lacked a Nutrient slug.

---

## 3. Ids

Our Nutrient id is a slug (`vit_c`, `protein`). Never use USDA integer id, OFF slug, INFOODS tagname, Frida ParameterID, or FooDB id as Nutrient PK.

Observations store ids, not display names.

An observation has `nutrient_id` **or** `compound_id`, not neither.  
The source ticket stays on NutrientCode (example: family `usda`, code `401` / FDC id `1162`).

---

## 4. Mapping waterfall

Every incoming code gets **one** fate. No parking lot. No published amount is dropped.

1. **ignore** — not a food amount (pH, archived column, yield factor, Nutri-Score). Not loaded as an observation.
2. **nutrient** — intake figure we named. `nutrient_id` set.
3. **compound** — published component that is not an intake Nutrient. `compound_id` set.

If we have not named a Nutrient slug yet, the amount still loads as Compound. Promoting later is a map change, not a re-download.

Apply in order:

1. Exact map already known → that Nutrient
2. Not a composition amount → ignore
3. Same substance, different accounting (added vs intrinsic, RE vs RAE, labelling vs lab) → **same Nutrient** + `expression` / fraction on the code. Never `iron_added`
4. People track it or the panel shows it → Nutrient
5. Named chemical, no target → Compound layer
6. Else Compound. Do not invent a Nutrient id. Do not drop the row.

Added vs intrinsic is an expression on the same Nutrient.

---

## 5. Locked Nutrient extras

On top of the original 38 in the July list:

water, alcohol, ash, cholesterol, sugars, added_sugars, starch, salt, trans_fat, ala, linoleic, retinol, beta_carotene, glucose, fructose, sucrose, lactose, maltose, galactose, chloride, fluoride, plus the single amino acids in §12

Working file: `data/nutrients/nutrient.csv`

Rules on those extras:

- Child sugars must not be added onto `sugars` in a daily total
- Salt is its own Nutrient. Sodium chloride codes do not become `sodium`
- `omega3` stays the lump. EPA, DHA, ALA are separate
- Child amino acids must not be added onto `protein` in a daily total
- Galactose is a Nutrient. Do not sum with `sugars`
- Chloride is a Nutrient. Not the same as `salt` or `sodium`
- Most single fatty acids, organic acids, phytate, amines: Compound until promoted
- Promote / demote is a map edit only. Observation rows stay. Optional Compound → Nutrient link.

---

## 6. NutrientCode shape

One published ticket in one family. Keeps the source unit and the expression. Many codes can point at one Nutrient.

Families:

| family | ticket | alt |
|---|---|---|
| `usda` | `nutrient_nbr` (208, 320, …) | FDC integer `id` |
| `off` | slug (`vitamin-c`) | — |
| `infoods` | tagname (`VITC`, `VITA_RAE`) | — |
| `eurofir` | component id (`ENERC`, `VITA`) | Frida ParameterID |
| `frida` | ParameterID | EuroFIR id |
| `foodb-nutrient` | public_id | numeric id |
| `foodb-compound` | Compound.public_id | chemistry; not V1 totals |

EuroFIR and INFOODS look alike (`ENERC`) but are different families.  
Uniqueness is `(family, code, unit, expression)`, not `code` alone.

Expression is first-class. `VITA` (RE) and `VITA_RAE` both map to `vit_a`. Do not convert in the code table.

Unit stays as published. Convert to Nutrient.unit only as an extra column on the observation.

Label vs lab vs compiled is **not** on NutrientCode. That belongs on the observation.

---

## 7. Alignment meaning

Each source keeps its own foods. Alignment is our Nutrient + Compound ids.

Food-to-food matching across sources is a later job.

Composition is long observations, not `Food.nutrients = {…}`.

---

## 8. First load scope (2026-09-28)

First script writes observations for **all landed composition sources**:

- USDA Foundation 2026-04-30
- USDA SR Legacy 2018-04
- Open Food Facts (landed CSV)
- WAFCT 2019
- Frida 5.5

Still out of the first script:

- FooDB `Content.json` (3.5GB chemistry amounts)
- AnFooD, CIQUAL, CoFID, EuroFIR consortium extract
- Food-to-food matching across sources

Each source keeps its own foods. V1 UI still defaults to Foundation. Other loaded sources sit behind the dropdown. Intake panel = Nutrients. Composition view = Compounds.

OFF rows are Product grain (barcode), not generic Food. Store `source_food_id` as the barcode; `product_id` may be filled, `food_id` stays empty until we have a Food row.

---

## 9. Salt (confirmed 2026-09-28)

`salt` stays its own Nutrient. Sodium chloride codes do not become `sodium`.  
V1 may show both when the source published both.

---

## 10. Observation columns

Exact column list: `docs/decisions/OBSERVATION-FIELDS.md`.  
Full nullable set. Empty ≠ zero. Do not shrink this list to “V1 only.”

---

## 11. Keep every published amount (2026-09-28)

Import all composition data from the landed sources.  
Do not delete tickets because the intake list is short.  
Do not use “unmapped” as a rug.

Ignore = not an amount.  
Everything else is Nutrient or Compound and can be shown in the UI.

## 12. Class B promotions (2026-09-28)

Promoted to Nutrient (intake panel):

- galactose, chloride
- amino acids published as single residues: tryptophan, threonine, isoleucine, leucine, lysine, methionine, phenylalanine, valine, histidine, cystine, cysteine, tyrosine, arginine, alanine, aspartic_acid, glutamic_acid, glycine, proline, serine, asparagine, glutamine, hydroxyproline, taurine

Stay Compound (composition view) until a later promote:

- individual fatty acids beyond the fat Nutrients already named
- organic acids, biogenic amines, extra sterols, phytate, polyphenols
- pair/sum tickets (`Amino acids`, Cys+Met, Phe+Tyr)
- extra vitamin *forms* attach as expression on the parent vitamin where they are the same vitamin

Promote and demote stay cheap: change the code map, keep the observation.

---

## 13. V1 energy cell (2026-09-28)

Headline energy on the intake panel = USDA `nutrient_nbr` **208** (kcal).

- 268 is the same quantity in kJ — unit toggle, not a second Nutrient
- 957 Atwater general and 958 Atwater specific stay loaded as `energy` + expression
- Label / labelling kJ–kcal from other sources stay loaded as `energy` + expression
- Do not blend 208 with 957/958 into one number

When the dataset dropdown is not Foundation, pick that source’s metabolizable kcal ticket as the headline. Do not mix methods across sources.

---

## 14. V1 vitamin A cell (2026-09-28)

Headline `vit_a` on the intake panel = USDA `nutrient_nbr` **320** (RAE, µg).

- 392 RE, 318 IU, and 960 unspecified stay loaded as `vit_a` + expression
- `retinol` and `beta_carotene` stay separate Nutrients
- Do not convert RE or IU into RAE in the loader
- Do not build a silent RAE from retinol + carotenoids
- If a food has no 320 row, the headline is empty. A later calculated RAE must be stored as its own observation with derivation = calculated

When the dataset dropdown is not Foundation, pick that source’s RAE ticket (`VITA_RAE` / equivalent). Do not mix RE and RAE.

---

## 15. FooDB catalog vs amounts (2026-09-28)

`Compound.json` is the Compound dictionary. Slim catalog: `data/compounds/compound.csv` (70,477 rows).

`Content.json` stays in the zip. Those are food × compound amounts. Extract them after the five composition sources are in observations.

License is commonly CC-BY-NC. Not CC0. Do not treat FooDB chemistry as USDA-style public-domain panel data.

This is a delayed import, not a delete.
