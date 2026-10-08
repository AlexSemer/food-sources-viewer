# Headline tickets per source

Which published ticket is the intake-panel cell for `energy` and `vit_a` (and `vit_b9`, `vit_e` while we are here).

Other tickets for that Nutrient still load. They are expressions, not the headline.

| source_version | energy | vit_a | vit_b9 | vit_e |
|---|---|---|---|---|
| foundation-2026-04-30 | usda 208 kcal | usda 320 RAE | usda 435 DFE | usda 323 alpha-tocopherol |
| sr-legacy-2018-04 | usda 208 kcal | usda 320 RAE | usda 435 DFE | usda 323 alpha-tocopherol |
| frida-5.5 | frida 356 metabolisable kcal | none (only RE = frida 12). Cell empty unless we later add a calculated RAE | frida 143 total folate | frida 135 alpha_TE |
| wafct-2019 | infoods ENERC in kcal if present, else kJ converted in `amount_canonical` | infoods VITA_RAE | infoods FOLDFE if present, else FOL | infoods VITE (alpha_TE) |
| off-csv-2026-09-22 | off energy-kcal | off vitamin-a (unspecified — not RAE) | off vitamin-b9 if present, else folates | off vitamin-e if present |
| foodb-2020-04-07 | foodb-nutrient FDBN00038 | none | none | none |

Rules already locked:

- Do not convert RE → RAE in the loader.
- Do not blend energy methods.
- Empty headline ≠ zero.
- kJ is a unit face of energy (USDA 268), not a second Nutrient.
