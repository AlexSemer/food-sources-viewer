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

## 5. Load shape under the lock (replaces the earlier schema sketch)

This replaces the schema sketch and decision list that were here. It follows `docs/decisions/LOCKED.md`, with the column names from `OBSERVATION-FIELDS.md`, the kinds from `SCHEMA-FREEZE.md`, and the headline tickets from `HEADLINES.md` and `CRITIC-FOLLOWUP.md`. It defines no tables, no SQL and no new Nutrient ids. The code maps are not redrawn here: every ticket already has its fate (`nutrient` / `compound` / `ignore`) on `data/nutrients/by-source/`.

Sections 2 and 3 are kept as surveyed, but two of their sentences are superseded by this section. "Map it into one canonical component list" (section 2) and "Map them as distinct components" (section 3, carbohydrate) both become: separate NutrientCode tickets on **one** Nutrient, told apart by `expression`.

**USDA numbering.** On NutrientCode, family `usda` has `code` = `nutrient_nbr` and `code_alt` = FDC `nutrient.id` (LOCKED §6). The tables in section 2 print "id (nbr)", for example "1005 (205)". Below, USDA tickets are written as "nbr 205 (id 1005)". The tickets 208, 268, 957, 958, 320, 323, 417 and 435 are nbrs. 1005, 1008, 1062, 1106, 1177, 2047, 2048 and 2066 are ids.

### 5.1 Ids: Nutrient, NutrientCode, Compound

- **One intake Nutrient, one slug.** The Nutrient id is ours, from `data/nutrients/nutrient.csv`: `energy`, `protein`, `carbohydrate`, `vit_a`, `vit_e`, `vit_b9`, and the locked extras such as `retinol` and `beta_carotene`. An INFOODS tagname, a USDA nbr or id, a EuroFIR component id or a Frida ParameterID is never the Nutrient PK (LOCKED §3).
- **Source tickets live on NutrientCode**, one row per `(family, code, unit, expression)`. Many tickets can point at one Nutrient. The families for these three sources are `usda` (Foundation), `infoods` (WAFCT tagnames), `frida` (ParameterID) and `eurofir` (Frida's `EurofirComponentID`, keyed by ParameterID where the EuroFIR id is null or reused, per CRITIC-FOLLOWUP §3).
- **No single component table.** That was rejected in LOCKED §1. Compound stays a second catalog, and an observation carries `nutrient_id` *or* `compound_id`.
- **The one-source concepts are not promoted to close the gap.** Phytate and IP3–IP6, individual fatty acids beyond the fat Nutrients already named, organic acids, biogenic amines, extra sterols, polyphenols and pair/sum tickets stay Compound (LOCKED §12). Factors and meta columns stay `ignore`: WAFCT `EDIBLE1`, `EDIBLE2`, `SOP`, `XFA` and `XN`, and Frida 219 (NCF) and 252 (Waste). Every other ticket keeps the fate already on its by-source row. Some of the "one source only" concepts in section 2 are not new concepts at all. They are other expressions of a Nutrient we already have (Appendix A).

### 5.2 Same substance, different accounting = same Nutrient + `expression`

kJ is a unit face of energy, never a second Nutrient. kJ↔kcal and other conversions go only into `amount_canonical` / `canonical_unit`, and the published `amount` and `amount_unit` stay as they are. Expressions are never averaged or coalesced. A headline cell with no value of its own expression is empty, not zero, and is not filled from another expression.

In the tables below, code-formatted expressions are tokens the docs already use (`RAE`, `RE`, `IU`, `atwater_general`, `atwater_specific`, `labelling_kJ`, `total`, `free`, `NE`, `equivalents_or_as_published`). Expressions described in plain words take the exact string already on the by-source row. This note adds no expression strings.

**`energy`** (the method is the expression; record it, and also use `method_text` where the source gives one)

| Source | Ticket | Expression | Headline (HEADLINES.md) |
|---|---|---|---|
| USDA | nbr 208 (id 1008) kcal | USDA "Energy" ticket, as on the CSV row | **headline** (LOCKED §13). Only 135 of 469 foods have it, so it's empty for the other 334 |
| USDA | nbr 268 (id 1062) kJ | unit face of 208 | – |
| USDA | nbr 957 (id 2047) | `atwater_general` (347 foods) | – |
| USDA | nbr 958 (id 2048) | `atwater_specific` (312 foods) | – |
| WAFCT | infoods `ENERC` kcal / kJ | EU factors | **headline**: kcal, else kJ converted in `amount_canonical` |
| Frida | 356 kcal (137 is its kJ face) | EU factors, metabolisable | **headline** |
| Frida | 359 kcal (316 is its kJ face) | labelling (`labelling_kJ` for 316) | – |

**`carbohydrate`** (never one number for all three)

| Source | Ticket | Expression |
|---|---|---|
| USDA | nbr 205 (id 1005) | by difference, fibre included |
| USDA | nbr 205.2 (id 1050) | by summation |
| WAFCT | infoods `CHOAVLDF` | available, by difference, fibre excluded |
| Frida | 170 CHOT | by difference, fibre included (alcohol subtracted) |
| Frida | 172 CHO | available |

HEADLINES.md has no carbohydrate headline, and this note doesn't pick one (see 5.4).

**`vit_a`** (no RE→RAE or IU→RAE conversion, and no RAE built from retinol + carotenoids. A later calculated RAE would be its own observation with `derivation = calculated`, per LOCKED §14)

| Source | Ticket | Expression | Headline |
|---|---|---|---|
| USDA | nbr 320 (id 1106) µg | `RAE` | **headline**. Only 79 of 469 foods have it, so it's empty for the rest |
| WAFCT | infoods `VITA_RAE` | `RAE` | **headline** |
| WAFCT | infoods `VITA` | `RE` | – |
| Frida | 12 VITA | `RE` | Frida has no RAE, so the **headline is empty** (not zero, and not RE) |

Retinol (USDA nbr 319, WAFCT `RETOL`, Frida 225 RETOLAT) and β-carotene (USDA nbr 321, WAFCT `CARTB`, Frida 303) are their own Nutrients, `retinol` and `beta_carotene`. They are not `vit_a` expressions.

**`vit_e`**

| Source | Ticket | Expression | Headline |
|---|---|---|---|
| USDA | nbr 323 (id 1109) | α-tocopherol | **headline** |
| WAFCT | infoods `VITE` (column "VITE or [TOCPHA]") | α-TE (`equivalents_or_as_published`) | **headline** |
| WAFCT | infoods `TOCPHA` (own column) | α-tocopherol | – |
| Frida | 135 VITE | α-TE | **headline** |
| Frida | 276 TOCPHA | α-tocopherol | – |

The β/γ/δ tocopherols and the tocotrienols are `vit_e` expressions too (CRITIC-FOLLOWUP §4). The headline expression differs by source (α-tocopherol for USDA, α-TE for WAFCT and Frida), so the headline cells are not comparable across sources.

**`vit_b9`** (vitamer amounts are never added onto DFE)

| Source | Ticket | Expression | Headline |
|---|---|---|---|
| USDA | nbr 435 | DFE | **headline**. No DFE on these Foundation foods, so it's **empty** for this file |
| USDA | nbr 417 (id 1177) | `total` (172 foods). Still loads | – |
| WAFCT | infoods `FOLDFE` | DFE | **headline** |
| WAFCT | infoods `FOL` (column "FOL or [FOLSUM]") | `total` (`equivalents_or_as_published`) | – (HEADLINES uses it only when FOLDFE is absent) |
| WAFCT | infoods `FOLFD`, `FOLAC` | food folate, folic acid | – |
| Frida | 143 FOL | `total` | **headline** per HEADLINES.md (see the contradiction noted with this pass) |
| Frida | 145 | `free` | – |

**`protein`**: the tickets are USDA nbr 203 (id 1003), WAFCT `PROTCNT` and Frida 218 PROT. Frida 421 (from amino acids) and 317 (labelling) are `protein` expressions. Nitrogen factors are a fact about the source food, not an expression on the observation (see 5.3).

### 5.3 Observation row: per source food, not per canonical food

The grain is one row per published amount, for one source food + one ticket + one expression + one basis (OBSERVATION-FIELDS). The keys are `source_id`, `source_version` and `source_food_id`, which is `fdc_id` for USDA, WAFCT `Code` and Frida `FoodID`. `food_id` stays empty because there's no food crosswalk in this pass. Duplicate USDA descriptions (67) and repeated Frida names ("Carrot, raw" ×3) stay separate source rows. FoodOn, NCBI taxon, FoodEx2 and scientific name are the bridges counted in section 1. They are classification facts, not a merge.

| Must carry | Column (OBSERVATION-FIELDS) | USDA Foundation | WAFCT 2019 | Frida 5.5 |
|---|---|---|---|---|
| amount or empty | `amount`, `is_empty` | `food_nutrient.amount`. The 33 null amounts become `is_empty`. A **missing row is not zero**: no row, no observation | Cell value. A blank cell becomes `is_empty`. `tr` becomes an empty `amount` with `is_empty` false, plus a qualifier | `ResVal`. **0 stays 0**: it's not trace and not "not detected". A literal `'NULL'` becomes `is_empty` |
| source unit | `amount_unit` (+ `amount_canonical`, `canonical_unit`) | `nutrient.unit_name` (`G`, `MG`, `UG`, `KCAL`, `kJ`, `IU`) | Header unit (`g`, `mg`, `mcg`, `kJ`, `kcal`) | `EurofirUnitID` (`g`, `mg`, `ug`, `kJ`, `kcal`). The free-text `Unit` goes to `method_text` |
| basis | `basis` | `100g` (100 g as described; no refuse data) | `100g_ep` | `100g` as published (see 5.4) |
| edible coefficient / waste | not an observation column: a related fact on the source food | none | `EDIBLE1`, `EDIBLE2` per food | 252 Waste % per food |
| nitrogen factor | related fact on the source food | `food_protein_conversion_factor` | `XN` per food | 219 NCF per food |
| qualifier (tr, lower quality, calculated, borrowed) | no column yet (see 5.4). For now the raw cell text goes in `footnote` | none in Foundation values | `tr`, `[tr]`, `[x]` (lower quality), bracketed form, `oa` (non-African) | none. Zero is not a qualifier |
| derivation | `derivation` | `derivation_id` as the source id (1 A, 4 AS, 49 NC) | `calculated` for `*` foods (yield/retention) and recipe rows | Borrowed: `SourceFood` is set, so derivation records the FoodID it was borrowed from (source text) |
| n / min / max / median | `n`, `min`, `max`, `median` | `data_points`, `min`, `max`, `median` | Sheet 06 n, min, max, median (SD has no column) | `NumberOfDeterminations`, `Min`, `Max`, `Median` |
| reference | `citation_id` (+ `footnote`) | No bibliographic id. `footnote` (22) | `BiblioID/Source` per food (refs in sheet 12) | `Source` (refs in the Source sheet). `'NULL'` becomes empty |

**WAFCT bracketed cells.** A value printed as `[FATCE]` in the "FAT or [FATCE]" column keeps the base ticket (`FAT`, with the column's expression `equivalents_or_as_published` per CRITIC-FOLLOWUP) and adds a qualifier saying the cell is the bracketed form. The same goes for `[FIBC]`, `[TOCPHA]`, `[FOLSUM]`, `[NIA]` and `[CARTB]`. A bracketed cell is not a new ticket and not a new Nutrient.

Edible coefficient, waste and nitrogen factor reach the value through `(source_version, source_food_id)`. They are not written as amounts or columns on the observation (OBSERVATION-FIELDS: "Do not write yield, retention, or edible-portion factors as amounts"), so a reader can still take the edible coefficient, waste or N factor of the source food the value belongs to.

### 5.4 Not decided here (needs a decision-doc change first)

1. **Qualifier column.** OBSERVATION-FIELDS has no qualifier, and SCHEMA-FREEZE doesn't list trace or quality flags as a kind. A new kind means updating SCHEMA-FREEZE first. Until then, the raw cell text (`tr`, `[x]`, the bracket, `oa`) goes in `footnote`, and calculated or borrowed goes in `derivation`.
2. **Carbohydrate headline.** HEADLINES.md has none for any source.
3. **Frida basis.** It's 100 g with `EurofirMatrixUnitID` = W plus a Waste %. Whether that 100 g is edible portion (`100g_ep`) needs the Frida 5.5 documentation PDF, which hasn't been checked yet.
4. **USDA id 2066.** It's used 33 times but has no dictionary row, so it has no ticket on the Foundation CSV. Per the load contract it can't be dropped and can't get an invented Nutrient id. It needs a ticket (likely `compound`) added to the map, which this pass doesn't do.
5. **SD.** WAFCT sheet 06 publishes SD, and there's no column for it.

Known source defects carried from the survey: Frida ParameterID 344 Isomalt appears twice (the CSV keeps one, per COMBINER-RETAG), 6 Frida foods point at a missing FoodGroupID, the Frida C18:1 n-12 row has the wrong EFSA code, WAFCT numbers come as REAL and as text, and Frida writes the string `'NULL'` for empty.

### 5.5 Viewing it next to the current sources

The combined observations should show in the viewer as **one more source** in the dataset list, beside `usda-foundation`, `wafct`, `frida` and the rest. Nothing is built here, and there's no store to point at until a load script exists. What that implies, using the viewer's existing per-source pattern:

- **One more `SourceDef`** in `packages/shared/src/index.ts`, with its own `dbFile` and food table, and a composite spec in `apps/api/src/composite-registry.ts` (`specFor`). It follows the long-table pattern of `fridaSpec` / `foodbSpec` in `apps/api/src/composite-long.ts`, with `foodIdRepeats` set because the table is long.
- **The food list shows source foods** keyed by `(source_version, source_food_id)`, with a `source_version` filter that defaults to `foundation-2026-04-30`. LOCKED §2 allows one source at a time, and mix mode comes later. Duplicate source rows show as separate rows.
- **Composite columns are `nutrient_id` × `expression`**, with `amount_unit` in the header and a kJ/kcal toggle that reads `amount_canonical`. The headline column per Nutrient follows HEADLINES.md. A second mode (like FooDB's "compounds" mode) shows `compound_id` observations, which is the composition view.
- **No averaging.** Each cell is one observation. The spec offers no avg/min/max/n aggregation (`aggs`), and the n/min/max/median it shows are the source's published statistics. Empty stays empty, never 0.
- **The food page** lists every observation of the source food with ticket, expression, basis, derivation, qualifier/footnote and citation, plus the related facts (edible coefficient, waste, N factor). The same `fdc_id` / `Code` / `FoodID` opens the raw source in its existing viewer for a side-by-side check.

## Appendix A. Section 2 rows the existing code CSVs classify differently

Checked on 2026-10-08 against the CSVs themselves: `data/nutrients/by-source/usda-foundation-nutrient-codes.csv` (USDA tickets are `nutrient_nbr`, FDC id in `alt_code`), `wafct-nutrient-codes.csv`, `frida-nutrient-codes.csv` and `eurofir-from-frida-nutrient-codes.csv`. No CSV was changed. Ticket = `code`; "→" gives the CSV's `nutrient_id` + `expression` (status), with `''` for an empty expression.

General: section 2 says to "map it into one canonical component list". The CSVs map each ticket to our Nutrient slug or to Compound, with `expression` on the ticket.

| Source | Ticket | Section 2 said | CSV says |
|---|---|---|---|
| USDA | 268 (id 1062) kJ | separate "Energy kJ" row / concept | `energy` + `''` (nutrient), same empty expression as 208; kJ is only the unit |
| USDA | 957, 958 | Atwater energies inside "Energy kcal" | `energy` + `atwater_general` / `atwater_specific` (nutrient) |
| USDA | 298 (id 1085) Total fat (NLEA) | listed in the Fat row | no Nutrient: **compound** |
| USDA | 205, 205.2 | carbohydrate by difference vs by summation as different things | both `carbohydrate` + `''` (nutrient). They differ by code only |
| USDA | 291, 293 (id 2033, AOAC 2011.25) | AOAC 2011 fibre fractions counted as USDA-only | 293 total is `fiber` + `''` (nutrient), like 291 |
| USDA | 269.3, 269 (id 2000) | Sugars row | both `sugars` + `''` (nutrient) |
| USDA | 202 Nitrogen | core nutrient row | **ignore** (Frida 300 NT also ignore) |
| USDA | 320 RAE | "vit A RAE" as its own USDA+WAFCT concept | `vit_a` + `RAE` |
| USDA | 323, 341, 342, 343 | "tocopherols α/β/γ/δ" as concepts | `vit_e` + `alpha_tocopherol` / `beta_` / `gamma_` / `delta_tocopherol` |
| USDA | 328 / 324 | Vitamin D (D2+D3) / IU | `vit_d` + `''` / `vit_d` + `IU`. WAFCT VITD and Frida 126 use expression `D2+D3` for the same quantity |
| USDA | 325 D2, 326 D3 | "D2/D3" as a USDA+Frida shared concept | **compound** (both). Frida 127 / 128 are `vit_d` + `D2` / `D3` (nutrient): the two maps disagree |
| USDA | 618 PUFA 18:2, 619 PUFA 18:3 | collapsed "18:2" / "18:3" in all three | **compound**. Only 675 (18:2 n-6 c,c) → `linoleic` and 851 (ALA) → `ala` |
| USDA | 322 α-carotene, 334 β-cryptoxanthin | USDA+WAFCT concepts | compound (WAFCT CARTA, CRYPXB also compound): agrees on fate |
| USDA | 406 Niacin | "niacin" in all three | `vit_b3` + `preformed` |
| USDA | 2052, 2053, 2057–2063 (no `nutrient_nbr`) | part of the 235 ids used | rows exist with the FDC id written into `code` (`code` = `alt_code`, compound). That is not a `nutrient_nbr` ticket, so the store loader skips these 99 amounts (9 ids) and logs them. id 2066 has no row at all (33 amounts) |
| WAFCT | `ENERC` kJ / kcal | separate "Energy kJ" row | two tickets: `energy` + `kJ`, `energy` + `kcal` (nutrient) |
| WAFCT | `VITA`, `VITA_RAE` | "vit A RE" (WAFCT+Frida) and "vit A RAE" (USDA+WAFCT) as two concepts | both `vit_a`, + `RE` / `RAE` |
| WAFCT | `VITE`, `TOCPHA`, `TOCPHB/D/G` | "vit E α-TE" as its own WAFCT+Frida concept; tocopherols as concepts | `vit_e` + `alpha_TE`; `TOCPHA` has two rows (`ATE_or_alpha` for the bracket form under VITE, `alpha_tocopherol` for its own column); B/D/G by expression |
| WAFCT | `NIAEQ`, `NIA` | "niacin eq." as its own concept | `vit_b3` + `NE`; `NIA` has two rows (`NE_or_preformed`, `preformed`) |
| WAFCT | `FOL`, `FOLSUM`, `FOLDFE`, `FOLFD`, `FOLAC` | folate DFE, food folate, folic acid as WAFCT-only concepts | all `vit_b9` + `total` / `sum_vitamers` / `DFE` / `food_folate` / `folic_acid` |
| WAFCT | `CARTBEQ`, `CARTB` | "β-carotene eq." as a WAFCT-only concept | `beta_carotene` + `equivalents`; `CARTB` has two rows (`equivalents_or_as_published`, `beta_carotene`) |
| WAFCT | `CHOAVLDF` | WAFCT-only concept | `carbohydrate` + `available_by_difference` |
| WAFCT | `FIBTG`, `FIBC` | one Fibre row | `fiber` + `TDF` / `fiber` + `crude` (nutrient). Frida 123 FIBC crude fibre is **compound**: the two maps disagree |
| WAFCT | `FAT`, `FATCE` | "FAT or [FATCE]" as one column | `total_fat` + `''` / `total_fat` + `FATCE` |
| Frida | 137, 316, 356, 359 | separate "Energy kJ" row; labelling as Frida-only | `energy` + `metabolisable_kJ` / `labelling_kJ` / `metabolisable_kcal` / `labelling_kcal` |
| Frida | 218, 317, 421 | protein; labelling and from-AA as Frida-only | `protein` + `total` / `labelling` / `from_amino_acids` |
| Frida | 170, 172, 318 | CHOT by difference, CHO available | `carbohydrate` + `by_difference` / `available` / `available_labelling` |
| Frida | 248, 247, 251 (FASAT, FAMS, FAPU) | SFA / MUFA / PUFA in all three | **compound**. USDA 606/645/646 and WAFCT FASAT/FAMS/FAPU are the `saturated_fat` / `monounsaturated_fat` / `polyunsaturated_fat` Nutrients |
| Frida | 71 C18:2 n-6, 74 C18:3 n-3 | "18:2", "18:3" in all three | **compound**. USDA 675 / 851 and WAFCT F18D2CN6 / F18D3CN3 are `linoleic` / `ala` |
| Frida | 245 Sum sugars, 418 Free sugars | Sugars row (245) | **compound** in the Frida map, but `sugars` + `total` / `free` (nutrient) in the EuroFIR-from-Frida map |
| Frida | 123 FIBC, 202 neutral detergent fibre | fibre variants | compound (both) |
| Frida | 12 VITA | "vit A RE" as its own concept | `vit_a` + `RE` |
| Frida | 135, 276, 279, 282, 286 | "vit E α-TE" as its own concept; tocopherols | `vit_e` + `alpha_TE` / `alpha_tocopherol` / `beta_` / `delta_` / `gamma_tocopherol` |
| Frida | 203, 294 | "niacin eq." as its own concept | `vit_b3` + `NE` / `preformed` |
| Frida | 143, 145 | folate total; free folate | `vit_b9` + `total` / `free` |
| Frida | 303 CARTBTRANS | β-carotene | `beta_carotene` + `trans` |
| EuroFIR-from-Frida | same tickets as Frida | as for Frida | same as Frida except 245 / 418 (above). The EuroFIR map has 226 rows: Frida 36 (Thiamine) has no EuroFIR row; Frida 37 carries `THIA` |

Agrees, no change: amino acids (class B Nutrients), phytate and IP3–IP6 (compound), the WAFCT factors `EDIBLE1/2`, `SOP`, `XFA` and `XN` (ignore), retinol (USDA 319, WAFCT RETOL, Frida 225) and β-carotene as their own Nutrients, cholesterol, water, ash and the minerals.

Outside section 2 but relevant to 5.1: Frida 219 (NCF) and 252 (Waste) are **compound** in the Frida map, while 5.1 and `store-schema.md` treat them as food facts (`n_factor`, `waste_pct`), never amounts. Frida 140 (fatty acid conversion factor) is also compound, while WAFCT `XFA` is ignore. Frida 243 Starch/Glycogen is compound although `starch` is a locked Nutrient.
