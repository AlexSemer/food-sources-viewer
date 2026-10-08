STAGE: role-research-critic
TICKET: RES-NUTRI-20260927-01
STATUS: draft
NEXT: combiner retag, then STOP (no DB)
PROJECT: NUTRI

# Critic pass — maps before load

Attack the brief DONE WHEN, then the locks added 2026-09-28.

This pass does not change maps.

---

## Verdict

**VERDICT: more-research**

Not redo-merge. The dictionaries exist and the Nutrient list is coherent.  
Not accept. A load script cannot read the files as written without guessing.

**SAFE TO USE IN STUDIO: no**

Paper-plan / UML / contracts are not this cell. Do not start Dev on these CSVs.

---

## Brief DONE WHEN

| # | Ask | Result |
|---|---|---|
| 1 | Every landed dictionary ticket is a NutrientCode row | Yes, 1636 rows. Status values are still `mapped` / `unmapped` / `ignore` — not the locked `nutrient` / `compound` / `ignore` |
| 2 | Nutrient list explicit | Yes. 81 rows in `data/nutrients/nutrient.csv`. Every `mapped` `nutrient_id` exists there. No orphans |
| 3 | Observation fields listed once | Yes. `docs/decisions/OBSERVATION-FIELDS.md` |
| 4 | Food identity not required | Yes. Locked |
| 5 | FooDB Compound catalog; Content.json waits | Yes. `data/compounds/compound.csv` 70,477. Content.json still zipped |
| 6 | No production DB | Yes |

Question of the brief is answered *on paper*. It is not answered *in the code tables* after the 28 Sep locks.

---

## Blockers (fix before any load script)

1. **Stale fate labels.** 1,093 rows still say `unmapped`. Locked rule: a real amount is Nutrient or Compound. 34 of those already stuffed `COMPOUND` into `nutrient_id` (FooDB FAs + wildcard). Wrong column. Retag: `status=compound`, `compound_id` set, `nutrient_id` empty.

2. **Uniqueness broken.** Lock says a ticket is unique on `(family, code, unit, expression)`. Violations:
   - eurofir `NULL` + unit g — three different Frida parameters (C20:1 n-15, sum FA below LOD, residual)
   - eurofir `NULL` + unit mg — ornithine vs sum non-essential AA
   - eurofir `SUGAR` — “Sum sugars” vs “Free sugars”
   - eurofir `THIA` / `ISOMALT` duplicated
   - infoods `CARTB`, `NIA`+preformed, `TOCPHA`+alpha_tocopherol — two WAFCT names, same key
   Load will collide or drop a row.

3. **Vitamin A headline on non-USDA sources.** Foundation has 320 RAE. Frida / EuroFIR `VITA` is **RE only**. WAFCT has both `VITA` (RE) and `VITA_RAE`. OFF `vitamin-a` is unspecified. If the dropdown is Frida, the locked “headline = RAE” cell is empty. That is allowed by the empty≠zero rule, but the script needs a per-source headline table or it will silently pick RE.

4. **FooDB Content.json still out.** Correct per lock. Do not pretend the 70k catalog is composition data.

---

## Weak spots (not blockers, will bite later)

- **Fluoride.** USDA 374 ignore → use 313 is correct. 313, Frida 142, OFF `fluoride` are still “unmapped.” Under the new rule they are Compound (or a future Nutrient). Do not leave them as a special case.
- **Folate vitamers** (folic acid, 5-MTHF, THF, 10-HCOFA…) sit unmapped. They should be `vit_b9` + expression *or* Compound. Same pattern as tocopherol β/δ/γ vs `vit_e`.
- **Niacin.** USDA 406 (niacin) and 409 (NE = 406+407) both map to `vit_b3` with weak/empty expression. 409 is a different accounting. Needs `expression=NE`.
- **omega3.** In the Nutrient list. No Foundation ticket maps to it. EPA/DHA/ALA do. Do not sum those onto `omega3` in a panel rebuild.
- **Salt unit.** Nutrient unit is `g`. USDA 375 is `MG`. Conversion belongs on `amount_canonical`, not by changing the source unit.
- **OFF ignore list.** `cocoa`, `glycemic-index`, `collagen-meat-protein-ratio` are not composition nutrients. Correct ignore. GI is a property, not a Nutrient — do not sneak it onto the intake list later without a model change.
- **OFF `energy` vs `energy-kcal`.** Both mapped to `energy`. Unspecified vs kcal. Headline for OFF must be `energy-kcal`, not the bare slug.
- **License.** USDA CC0. Frida CC-BY. FooDB commonly CC-BY-NC. OFF terms are not CC0. Composition view that ships FooDB names + later amounts is not the same license as the Foundation panel. Attribution must stay on FoodSource.
- **Compound → Nutrient link.** Catalog has ascorbic acid etc. as chemicals. No row yet says FDB compound X *is* `vit_c`. Optional and locked as later. Do not use FooDB amounts for the intake panel.
- **by-source vs all.** Counts add up (USDA 951 = 477 Foundation + 474 SR). Good. `draft-nutrient-code.csv` in archive is still the old 333-row file — do not load it.

---

## What is already sound

- No mapped ticket points at two Nutrients.
- No mapped ticket points at a missing Nutrient id.
- Child sugars and single amino acids were promoted without mapping the parent lumps (`Amino acids`, Phe+Tyr, Cys+Met).
- Energy 208 / 268 / 957 / 958 already distinguished by expression on USDA.
- Observation column list matches the kinds in SCHEMA-FREEZE.
- Raw trees were not edited.

---

## Required combiner work (small)

1. Retag leftover `unmapped` → `compound` (or `nutrient` if already promoted). Move `COMPOUND` out of `nutrient_id`.
2. Split eurofir `NULL` / `SUGAR` so uniqueness holds (use Frida ParameterID as `code` when EuroFIR id is null or reused).
3. Disambiguate WAFCT double names (`CARTB` equivalents vs β-carotene; `NIA` NE vs preformed) with expression, not a second identical key.
4. Write a one-page **headline ticket per source** for `energy` and `vit_a` (Foundation 208 / 320; Frida metabolisable kcal / RE-or-empty; WAFCT ENERC kcal / VITA_RAE; OFF energy-kcal / unspecified A).
5. Stamp folate/tocopherol vitamers as expression or compound — pick one rule and apply it.

Then critic again on those five diffs only.

OPEN QUESTIONS:
- Fluoride: stay Compound or promote like chloride?
- Folate vitamers: expression on `vit_b9` or Compound?
- EuroFIR null codes: always key by Frida ParameterID?

HANDOFF TO: role-data-combiner

---

## Follow-up (same day)

Combiner ran the five mechanical fixes. Decisions: `docs/decisions/CRITIC-FOLLOWUP.md`.  
Re-scan: uniqueness 0, stale labels 0, fluoride promoted, vitamers on parent + expression, headline table written.

Still true: FooDB license, Compound→Nutrient links, empty Frida RAE cell (now explicit in HEADLINES.md). Not load-script blockers. Studio still needs a paper-plan before Dev.
