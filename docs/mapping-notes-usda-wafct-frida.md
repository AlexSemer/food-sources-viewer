# Mapping notes: USDA Foundation Foods × WAFCT 2019 × Frida 5.5

This is a quick correlation pass done on 2026-10-08 to prepare a combined schema. Every count below was queried read-only from `data/usda-foundation.sqlite`, `data/wafct.sqlite` and `data/frida.sqlite`. The value-flag semantics for WAFCT also come from the public WAFCT 2019 User Guide (FAO CA7779B).

## 0. Versions (confirmed)

| Source | Ingested file (`_meta`) | Confirmation |
|---|---|---|
| USDA Foundation | `usda-fdc/foundation-2026-04-30` CSV, loaded 2026-09-30 | version `2026-04-30` |
| WAFCT | `fao-infoods/wafct-2019/WAFCT_2019.xlsx` | version `2019`. The 2012 table is a separate source (`wafct-2012.sqlite`) and isn't used here. |
| Frida | `frida/5.5/Frida_5.5_Dataset.xlsx`. The `.ods` and 4.1–5.4 were skipped. | version `5.5`. The Readme sheet says "Frida version 5.5, November 2025", DOI 10.11583/DTU.29500682. |

All three are the intended versions, so no fallback to the raw files was needed.

## 1. Food identity

| | USDA Foundation | WAFCT 2019 | Frida 5.5 |
|---|---|---|---|
| Food table | `food` where `data_type='foundation_food'` | `05_NV_sum_57_per_100g_EP` (rows with an English name) | `Food` |
| Foods | 469 rows (468 have values). 395 of them are in `foundation_food` with an `NDB_number`. 74 have none. **67 descriptions are duplicated** (e.g. "Apples, fuji, with skin, raw" = 1105897 and 1750340, which are re-publications). | 1,028 | 1,381 |
| Key | `fdc_id` (int). There's also `NDB_number` for 395 foods. | `Code` `GG_NNN` (e.g. `05_046`). The prefix is the food group. | `FoodID` (int) |
| Names | `description` (EN only) | `Food name in English` and `Food name in French` (1,028/1,028) | `FoodName` (EN) and `FødevareNavn` (DA) |
| Scientific / taxon | `food_attribute` "NCBI Taxon" for 365 foods (143 taxa) | `Scientific name` text for 846 foods (176 distinct) | `TaxonomicName` for 846, `NCBI` id for 845 (248 taxa) |
| Ontology | `food_attribute` "FoodOn Ontology ID For FDC Item" for 365 foods (339 IDs), plus FoodOn "source" class | none | `FoodOntology` = FoodOn ID for 1,379 foods |
| FoodEx2 | none | sheet `10_FoodEx2_codes`: 934 rows with a code. `Exact Match` is Yes 633, No 296, `-` 99. | `FoodEx2Code` for 1,381 foods (1,147 with facets `#…`) |
| LanguaL | none | none | `LangualCode` (1,378) and `EurofirFoodGroup` (LanguaL A-code, 1,378) |
| Raw / cooked / prep | Only inside `description` ("raw", "dry", "frozen, pasteurized"…) | Inside the name. `*` means calculated with yield/retention factors (e.g. "boiled* (without salt), drained"). Sheets 07 (yield, 447), 08 (retention, 69) and 09 (recipes, 1,713 rows). | Inside the name, plus FoodEx2 facets (F28 process, etc.) |
| Other | `food_portion` (116 foods), `input_food` (the sample foods averaged into each food: 468 foods, 6,038 rows) | sheet 11 maps 2012↔2019 (490 rows) | `Nøglehulsmærket` keyhole flag (499 = 1) |

### Food groups (rough correspondence; counts = foods)

USDA uses `food_category` with 28 categories, 19 of them used by the 469 foods. WAFCT has 14 groups taken from the code prefix (the group header rows in the sheet). Frida's `FoodGroup` is a 3-level tree: 5 roots (DANSDA-GROUPS, Food Additives, Industrial / Catering Ingredients, Recipes), 21 level-2 groups and 116 level-3 groups. 1,375 foods hang on level 3, and 6 foods point to a `FoodGroupID` that is missing from `FoodGroup`.

| Concept | WAFCT | Frida L2 (DANSDA) | USDA category |
|---|---|---|---|
| Cereals | 01 Cereals (183) | Cereals and starch products (124) | Cereal Grains and Pasta (44), Baked Products (8) |
| Starchy roots | 02 Starchy roots, tubers (96) | *inside* Vegetables (e.g. Potato → "Root and tuber vegetables") | *inside* Vegetables |
| Legumes | 03 (137) | Legumes and legume products (43) | Legumes and Legume Products (61) |
| Vegetables | 04 (132) | Vegetables and vegetable products (166) | Vegetables and Vegetable Products (99) |
| Fruit | 05 (53) | Fruit, berries and their products (110) | Fruits and Fruit Juices (75) |
| Nuts / seeds | 06 (34) | Nuts and high-fat seeds (29) | Nut and Seed Products (19) |
| Meat & poultry | 07 Meat, poultry (128) | Meat and meat products (153) + Poultry (35) | Beef (21), Pork (7), Poultry (12), Lamb/Veal/Game (2), Sausages & Luncheon Meats (18) |
| Eggs | 08 (14) | Eggs and egg products (20) | *inside* Dairy and Egg Products |
| Fish | 09 (106) | Fish, aquatic animals (128) | Finfish and Shellfish (24) |
| Milk & dairy | 10 (27) | Milk (54) + Cheese (68) + Ice cream (21) | Dairy and Egg Products (50) |
| Fats & oils | 11 (35) | Fats and fatty products (67) | Fats and Oils (12) |
| Beverages | 12 (24) | Beverages (121) | Beverages (4) |
| Sugar / misc | 13 Miscellaneous (25, includes sugar) | Sugar, honey, confectionery (27), Spices (35), Other foods (10), Particular nutritional uses (6), Substitutes for animal products (21) | Sweets (2), Spices and Herbs (3) |
| Composite | 14 Soups and sauces (34) | Ready meals, fastfood, composite (137) | Soups, Sauces, Gravies (3), Restaurant Foods (5) |

The groups mostly line up 1:n. The two clear splits are WAFCT's separate starchy-roots group and USDA's combined dairy+egg category. For a common group axis, **FoodEx2 is the better pivot**: Frida has 707 distinct base terms and WAFCT has 279. They share 123 base terms, which cover 352 WAFCT rows. USDA has no FoodEx2 and would need mapping by hand or via FoodOn.

### Food overlap (rough sample, normalised token match on names)

| Food | USDA | WAFCT | Frida |
|---|---|---|---|
| Apple, raw | 10 hits, by variety ("Apples, fuji, with skin, raw") | 05_026 Apple, with skin, raw | 2 Apple, raw, all varieties |
| Banana, raw | 790991 Bananas, ripe and slightly ripe, raw (5 hits) | 05_003 / 05_028 (white / yellow flesh) | 3 Banana, raw |
| Orange, raw | 746771 Oranges, raw, navels | 05_016 Orange, raw | 70 Orange, raw |
| Chicken breast, raw | 2646170 / 2727569 | none (only light/dark meat: 07_033, 07_036…) | 907 Chicken, breast, flesh and skin, raw |
| Egg, chicken, whole, raw | only 323604 "frozen, pasteurized" | 08_001 Egg, chicken, raw | 1662–1665 (by farming system) |
| Milk, cow, whole | 322892 Milk, whole, 3.25% | 10_029 Milk, cow, whole, raw, 4.5% fat | 6 Milk, whole, 3.5 % fat |
| Rice, white, raw | 2512381 Rice, white, long grain, unenriched, raw | 01_037 Rice, white, raw | 1225 Rice groats, raw (no "white") |
| Rice, cooked | none | 01_135 Rice, white, boiled* | 1973 Rice, boiled |
| Lentils, dry | 2644283 Lentils, dry | 03_030 Lentil, dry, raw | 681 Lentils, dried (+ red/brown/beluga) |
| Chickpeas, dry | 2644282 | none | 1803 Chickpeas, dry, raw |
| Spinach, raw | 1750353 "Spinach, mature" (no "raw") | 04_057 Spinach, leaves, fresh, raw | 50 Spinach, raw |
| Tomato, raw | 321360 Tomatoes, grape, raw | 04_021 Tomato, red, ripe, raw | 52 / 451 / 624 (by origin) |
| Onion, raw | red / white / yellow | 04_018 Onion, fresh, raw | 716 Onion, raw |
| Carrot, raw | 2258586 Carrots, mature, raw | 04_006 Carrot, raw | 24 / 559 / 606 (all "Carrot, raw") |
| Potato, raw | by variety, without skin | 02_009 Potato, raw | 4 Potato, raw (+ seasonal) |
| Peanut / groundnut | 2515376 Peanuts, raw | 06_010 Groundnut, shelled, dried, raw | 150 Peanut, dried |
| Wheat flour, white | 790018 / 789890 (enriched or not) | 01_043 Wheat flour, white, unfortified | 1301 Wheat flour |
| Butter | 790508 Butter, stick, salted | 11_011 / 11_001 | 1052 / 1015 |
| Sugar, white | 334247 Sugars, granulated | 13_002 Sugar, white | 77 Sugar, sucrose, white |
| Beef, raw | 17 cuts | mostly offal + 07_009 lean meat | 36 cuts |
| Cowpea | none | 44 hits | none |

How messy matching will be:
- Of these ~21 foods, about 15 have a plausible counterpart in all three. The gaps are regional: WAFCT lacks salmon, chickpea and chicken breast, and USDA and Frida lack cowpea.
- One-to-many is the norm. USDA and Frida split foods by variety, cut, farming system or origin, while WAFCT splits by colour, ripeness or local breed. Frida even repeats the same name ("Carrot, raw" ×3, with different IDs).
- Naming conventions differ: plurals ("Apples" vs "Apple"), inverted heads ("Wheat flour" vs "Flour, wheat"), synonyms (groundnut/peanut, groats), and missing "raw".
- Name matching only gives candidates, so expect a manual crosswalk.
- Usable bridges:
  - FoodOn: 107 USDA foods share a FoodOn ID with 148 Frida foods.
  - NCBI taxon: 223 USDA foods share one of 70 taxa with Frida.
  - FoodEx2 between WAFCT and Frida, as above.
  - Binomial scientific name between WAFCT and Frida: 56 shared.

## 2. Nutrients / components

| | USDA | WAFCT | Frida |
|---|---|---|---|
| Identifier | `nutrient.id` + legacy `nutrient_nbr` (SR number; 12 of 477 have none) | **INFOODS tagname** (`02_Components`) | `ParameterID` + **`EurofirComponentID`** (EuroFIR/INFOODS-style tag, 223/228 filled) + `EFSA_PARAM_Code` + chemical ids (PubChem, ChEBI, CAS…) |
| INFOODS tags | **No** (crosswalk needed) | yes, but some columns are composite: "FAT or [FATCE]", "FIBTG or [FIBC]", "VITE or [TOCPHA]", "FOL or [FOLSUM]", "NIAEQ or [NIA]", "CARTBEQ or [CARTB]", "PHYTCPP or [...]" | yes, but tags are not unique: ENERC×4 (kJ/kcal, normal/labelling), PROT×3, CHO×2, FIBT×2 (incl. neutral detergent fibre), SUGAR×2, THIA×2 |
| Count | 235 nutrient ids used by the 469 foods (234 defined; **id 2066 is used 33× but missing from `nutrient`**) | 58 component rows (ENERC twice; EDIBLE1/2, SOP, XFA, XN are factors/meta) → ~52 value columns | 228 Parameter rows / 227 with data (ParameterID 344 Isomalt listed twice) |

Tag spelling differs between WAFCT and Frida even for the same concept: PROTCNT vs PROT, FIBTG vs FIBT, CHOLE vs CHORL, VITB6C vs VITB6, RETOL vs RETOLAT, CARTB vs CARTBTRANS. Treat each as its own source tag and map it into one canonical component list. Also, one Frida row has bad metadata: C18:1,n-12 has `EFSA_PARAM_Code` = "Ornithine".

**Shared components (rough concept-level crosswalk, factors excluded, fatty acids collapsed to chain:double-bonds(+trans)):** the union is ~296 concepts.

| Present in | Count | Notes |
|---|---|---|
| All three | ~36 | energy kJ/kcal, water, protein, fat, fibre, ash, Ca/Fe/Mg/P/K/Na/Zn/Cu, retinol, β-carotene, tocopherols α/β/γ/δ, B1, B2, niacin, B6, folate total, B12, C, D, cholesterol, SFA/MUFA/PUFA, 18:2, 18:3, tryptophan |
| Exactly two | ~98 | USDA+Frida 91 (individual FAs, amino acids, sugars, trace minerals, D2/D3, K1, biotin, pantothenate, choline…), USDA+WAFCT 3 (α-carotene, β-cryptoxanthin, vit A RAE), WAFCT+Frida 4 (alcohol, niacin eq., vit A RE, vit E α-TE) |
| One only | ~162 | USDA 73 (phytosterols, isoflavones, carotenoid isomers, choline forms, AOAC-2011 fibre fractions…), Frida 79 (organic acids, biogenic amines, heavy metals, polyols, labelling values, K2/MK-n…), WAFCT 10 (phytate + IP3–IP6, folate DFE/food folate/folic acid, β-carotene eq., CHOAVLDF) |

When fatty acids are matched at isomer level (n-3/n-6, cis/trans), the USDA+Frida count goes down.

### Core nutrients

The "n" column is the number of foods with a value (USDA out of 469, WAFCT out of 1,028, Frida out of 1,381).

| Nutrient | USDA id (nbr) name, unit, n | WAFCT tag, unit, n | Frida ParameterID tag name, unit, n |
|---|---|---|---|
| Energy kcal | 1008 (208) Energy KCAL 135; **2047 (957) Atwater General 347**; 2048 (958) Atwater Specific 312 | ENERC kcal 1,028 | 356 ENERC Energy (kcal) 1,381; 359 labelling |
| Energy kJ | 1062 (268) Energy kJ 135 | ENERC kJ 1,028 | 137 ENERC Energy (kJ) 1,381; 316 labelling |
| Protein | 1003 (203) Protein G 425 | PROTCNT g 1,028 | 218 PROT Protein g 1,381 (+421 from AA, 317 labelling) |
| Nitrogen | 1002 (202) G 375 | — (XN factor only) | 300 NT Nitrogen g 1,381 |
| Fat | 1004 (204) Total lipid G 413; 1085 NLEA 91 | FAT or [FATCE] g 1,028 (374 bracketed) | 141 FAT Fat g 1,381 |
| Carbohydrate | 1005 (205) by difference G 377; 1050 (205.2) by summation 47 | CHOAVLDF *available, by difference* g 1,028 | 170 CHOT *by difference* 1,381; 172 CHO *available* 1,381 |
| Fibre | 1079 (291) total dietary G 241; 2033 AOAC 2011.25 36 | FIBTG or [FIBC] g 1,027 (43 crude) | 168 FIBT Dietary fibre g 1,381; 123 FIBC crude |
| Sugars | 1063 (269.3) Sugars, Total G 185; 2000 (269) 5 | — | 245 SUGAR Sum sugars g 1,380; 418 Free sugars |
| Water | 1051 (255) G 460 | WATER g 1,028 | 268 WATER g 1,381 |
| Ash | 1007 (207) G 424 | ASH g 1,028 | 33 ASH g 1,381 |
| Na | 1093 (307) MG 403 | NA mg 1,024 | 201 NA mg 1,381 |
| K | 1092 (306) MG 439 | K mg 1,025 | 165 K mg 1,304 |
| Ca | 1087 (301) MG 439 | CA mg 1,028 | 108 CA mg 1,320 |
| Fe | 1089 (303) MG 439 | FE mg 1,028 | 162 FE mg 1,323 |
| Zn | 1095 (309) MG 439 | ZN mg 1,024 | 274 ZN mg 1,307 |
| Mg | 1090 (304) MG 439 | MG mg 1,026 | 184 MG mg 1,280 |
| P | 1091 (305) MG 439 | P mg 1,028 | 214 P mg 1,284 |
| Vitamin A | 1106 (320) RAE UG 79 (no RE) | VITA_RAE mcg 1,003 **and** VITA (RE) mcg 1,003 | 12 VITA "RE (µg/100g)" 1,338 (no RAE) |
| Retinol / β-carotene | 1105 (319) 71 / 1107 (321) 59 | RETOL 1,025 / CARTB 972, CARTBEQ 1,001 | 225 RETOLAT 1,298 / 303 CARTBTRANS 1,235 |
| Vitamin C | 1162 (401) MG 140 | VITC mg 1,025 | 47 VITC mg 1,209 |
| Vitamin D | 1114 (328) D2+D3 UG 63; 1110 (324) IU 63 | VITD mcg 1,005 | 126 VITD µg 1,232 (+D2, D3, 25-OH) |
| Vitamin E | 1109 (323) α-tocopherol MG 87 | VITE (α-TE) or [TOCPHA] mg 1,009 (136 bracketed); TOCPHA 899 | 135 VITE "alfa-TE" 1,171; 276 TOCPHA 1,069 |
| B12 | 1178 (418) UG 94 | VITB12 mcg 1,020 | 38 VITB12 µg 1,203 |
| Folate | 1177 (417) total UG 172 (no DFE on these foods) | FOL or [FOLSUM] 1,011; FOLDFE 1,011; FOLFD, FOLAC | 143 FOL µg 1,156; 145 free folate |
| SFA / MUFA / PUFA | 1258 (606) 152 / 1292 (645) 152 / 1293 (646) 137, G | FASAT / FAMS / FAPU g 1,007 each | 248 / 247 / 251 FASAT FAMS FAPU g 1,363 / 1,361 / 1,361 |
| Cholesterol | 1253 (601) MG 108 | CHOLE mg 1,021 | 115 CHORL mg 1,141 |

## 3. Units and bases

- **Basis**:
  - USDA amounts are per 100 g of food as described. Foundation has no refuse field: `food_component` (refuse) has 0 rows for these foods.
  - WAFCT is per 100 g **edible portion** (`02_Components.Denominator = /100g EP`). It also has `EDIBLE1` (as purchased → as described: 918 filled, 110 null, 551 = 1) and `EDIBLE2` (as described → as eaten, mainly fish).
  - Frida is per 100 g. Every nutrient parameter has `EurofirMatrixUnitID` = W, and "Waste" (ParameterID 252, %) is given for all 1,381 foods (345 are > 0, max 90).
- **Units**:
  - USDA uses uppercase `G/MG/UG/KCAL/kJ/IU/SP_GR`.
  - WAFCT puts the unit in the column header (`mcg`, not µg).
  - Frida puts free text in `Unit` ("g/100g", "µg/100g", "kcal/100 g", "RE (µg/100g)", "alfa-TE", "NE", "%", "No Unit"), but `EurofirUnitID` is clean (g, mg, ug, kJ, kcal, PCT, R). Use that.
- **Energy**:
  - WAFCT (per the guide) = 17·P + 37·F + 17·CHOAVLDF + 8·fibre + 29·alcohol kJ (4/9/4/2/7 kcal).
  - Frida reproduces the same EU factors: kJ matches for 1,349/1,381 foods and kcal (4/9/4/2/7) for 1,351, using *available* carbohydrate.
  - USDA has three energies. 2047 "Atwater General" is 4·P + 9·F + 4·CHO-by-difference (matches 332/346). 2048 uses food-specific factors (`food_calorie_conversion_factor`, 369 foods). 1008/1062 exist for only 135 foods (kJ ≈ 4.184·kcal for 114/135).
  - **Don't merge these into one "energy" value without recording the method.**
- **Carbohydrate**:
  - WAFCT CHOAVLDF = 100 − (water + protein + fat + ash + fibre + alcohol), so fibre is *excluded*.
  - USDA 1005 = 100 − (water + protein + fat + ash) (matches 359/377), so fibre is *included*.
  - Frida 170 (CHOT) = 100 − water − protein − fat − ash − alcohol (matches 1,333/1,381), so fibre is included. Frida's 172 is separate available carbohydrate.
  - So WAFCT CHOAVLDF ≠ USDA 1005 ≠ Frida 170. Map them as distinct components.
- **Nitrogen factor**:
  - WAFCT `XN` per food (6.25 ×753, 5.83 ×48, 6.38 ×29, 5.30/5.3 ×33…; 100 empty).
  - Frida ParameterID 219 NCF (6.25 ×952, 6.38 ×165, 5.7 ×102, 5.83 ×61…).
  - USDA `food_protein_conversion_factor` (317 of the 395 foods: 6.25 ×245, 6.38 ×31, 5.3 ×15, 5.83 ×13…; 3 rows have 0).
  - WAFCT stores numbers as both REAL and text ("6.25" vs 6.25), so normalise them.
- **Vitamin conventions**:
  - Vitamin A is RAE in USDA, RE and RAE in WAFCT, and RE only in Frida.
  - Vitamin E is α-tocopherol in USDA and α-TE in WAFCT and Frida.
  - Vitamin D also appears in IU in USDA (1110).
  - Folate: USDA Foundation has no DFE. WAFCT has DFE.

## 4. Value metadata

| | USDA | WAFCT | Frida |
|---|---|---|---|
| Missing | no row | empty cell (5,856 of 57,568 cells, 10.2%) | no row (141,561 rows = 45% of 1,381 × 227) |
| Trace / < LOD | no flags in Foundation values (all amounts numeric; 4,083 zeros and 33 nulls on the 469 foods) | `tr` (338) and `[tr]` (4) | no flag. 37,949 values are 0 (27%), so you can't tell zero from not detected. There's also a "Sum fatty acids below the detection limit" parameter. |
| Quality / estimated | `derivation_id`: 1 = A Analytical (17,524), 4 = AS Summed (1,811), 49 = NC Calculated (1,702), null 422. The derivation table isn't in the Foundation download (descriptions taken from `usda-full`). | `[x]` = "value of lower quality" (2,023 cells): doubtful, different method/definition (FATCE, FIBC, TOCPHA, FOLSUM…), or a mixed dish with a missing/low-quality ingredient. `*` in the name = calculated with yield/retention. | `Source` (ref id, or text 'NULL' for 15,762 rows); `SourceFood` (11,158 rows borrowed from another FoodID) |
| Stats | `data_points` (14,158), `min`/`max` (14,094), `median` (14,484), `footnote` (22), on the 395 NDB foods; also `sub_sample_result` (134,267) + `lab_method` (305) | sheet 06: SD / min / max / median / n rows for 453 foods. A "Non-African data" row marks `oa` (9,410 cells). | `Min` (31,035), `Max` (33,582), `Median` (19,095), `NumberOfDeterminations` (100,073 non-null) |
| References | acquisition / sample tree (`input_food`, `market_acquisition`, `agricultural_samples`) | `BiblioID/Source` text per food (e.g. "6N, 2P(110), FAO(996)") → sheet 12 (467 refs) | `Source` → `Source` sheet (499 refs, EuroFIR ref type, year, title) |

Load-time cleanup is needed:
- WAFCT mixes REAL cells with numeric text (21,694 cells) and has bracketed or `tr` strings.
- Frida writes empty cells as the literal string `'NULL'`.

## 5. Schema sketch and main decisions

```
food                (food_id, canonical_name, foodex2_base, foodon_id, ncbi_taxon, group_id, state/prep facets)
source_food         (source_id, source_food_key, name_en, name_local, lang_local, sci_name, foodex2_full, foodon_id,
                     langual, source_group_code, edible_coef_1, edible_coef_2, waste_pct, n_factor, fa_factor,
                     is_calculated_recipe, superseded_by, food_id NULL)   -- source row stays even if unmapped
food_group          (group_id, name, parent_id)          -- canonical, FoodEx2-aligned
source_group_map    (source_id, source_group_code, group_id)
component           (component_id, infoods_tag, name, unit_canonical, definition)  -- e.g. CHOAVLDF ≠ CHOCDF ≠ CHO
source_component    (source_id, source_component_key [nutrient.id | tag+col | ParameterID], source_tag,
                     source_unit, component_id, unit_factor, method_note)
value               (source_food_id, component_id, value NULL, unit, basis ['100g EP' | '100g as described'],
                     qualifier ['=','tr','<LOD','lower_quality','estimated','calculated'], derivation_code,
                     n, min, max, median, sd, outside_region bool, reference_id, borrowed_from_source_food_id)
reference           (source_id, reference_key, citation)
```

Mapping decisions and risks:
1. **Component crosswalk is the core job.** Use INFOODS tags as the canonical id. USDA needs a hand map of about 235 ids → tags, and Frida's and WAFCT's tag variants need to be aligned (PROT vs PROTCNT etc.). Composite WAFCT columns (`FAT or [FATCE]`) should map to the base tag *plus* a qualifier when the cell is bracketed, because the bracket can mean a different component.
2. **Energy and carbohydrate** need separate components per definition (EU-factor ENERC, Atwater general, Atwater specific; CHO by difference with/without fibre, available). Never coalesce them silently.
3. **Vitamin A/E/folate equivalents**: keep RE, RAE, α-TE and α-tocopherol as distinct components, and only derive between them where the inputs exist.
4. **Basis**: store the edible-portion coefficient and waste, so the basis is explicit. Treat USDA's "per 100 g" as-described with no refuse info.
5. **Qualifiers**:
   - WAFCT: parse `tr`, `[x]`, `[tr]` and `oa` into flags and keep the raw string.
   - Frida: zeros are ambiguous.
   - USDA: carry derivation A/AS/NC.
6. **Food identity**: keep every source row and map to the canonical `food` (often n:1), with FoodEx2 (WAFCT↔Frida) and FoodOn/NCBI (USDA↔Frida) as bridges. Expect manual curation. Name matching is noisy.
7. **Dedupe USDA** (67 duplicate descriptions, 74 foods without an NDB number) and **Frida** (repeated names such as "Carrot, raw" ×3) before mapping.
8. **Data defects to handle**: USDA nutrient 2066 has no definition; Frida ParameterID 344 is duplicated; Frida has 6 foods with an unknown group and a wrong EFSA code on C18:1 n-12; WAFCT has mixed text/real types.
