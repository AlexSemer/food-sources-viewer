# Critic follow-up decisions

Date: 2026-09-28  
Ticket: RES-NUTRI-20260927-01  
Who decided: combiner pass after founder said decide and note the result.

---

## 1. Fluoride

**Question:** Compound, or promote like chloride?

**Options:** leave as Compound / promote to Nutrient `fluoride`.

**Decision: promote.**  
Fluoride has dietary reference values (AI / UL). It is an intake mineral, same family as chloride. Not a curiosity chemical.

- id: `fluoride`
- unit: µg
- USDA 313 maps to it. USDA 374 stays ignore (archived duplicate).

---

## 2. Folate vitamers

**Question:** Expression on `vit_b9`, or Compound?

**Options:** each vitamer a Compound / each vitamer a new Nutrient / all expressions on `vit_b9`.

**Decision: expression on `vit_b9`.**  
Folic acid, food folate, 5-MTHF, THF, formyl folates, DFE are accountings of the same vitamin. Same pattern as RAE / RE / IU.

Headline `vit_b9` on USDA Foundation = **435 DFE** (requirement language).  
417 total, 432 food, 431 folic acid, 419 free, 433–438 vitamers stay loaded with expression.

Do not add vitamer amounts onto DFE in a daily total.

---

## 3. EuroFIR null / reused codes

**Question:** How to key rows when EuroFIR component id is `NULL` or reused (`SUGAR`, `THIA`)?

**Decision: when EuroFIR id is null or reused across different Frida parameters, `code` = Frida ParameterID (`alt_code`).**  
Family stays `eurofir`. Uniqueness is then `(eurofir, 424, g, …)` not three rows all called `NULL`.

`SUGAR`: split by expression (`total` vs `free`) and map both to Nutrient `sugars`.  
Exact duplicate rows (ISOMALT ×2, THIA ×2 with only a spelling difference): keep one.

---

## 4. Tocopherol / tocotrienol vitamers (bundled)

**Decision: expression on `vit_e`.**  
α-tocopherol / ATE is the usual headline. β/γ/δ tocopherols and tocotrienols are the same vitamin family, different forms.

---

## 5. Niacin 409 / 407

**Decision:**  
- 406 → `vit_b3` expression `preformed`  
- 409 → `vit_b3` expression `NE`  
- 407 (niacin from tryptophan) → `vit_b3` expression `from_tryptophan`  
Do not add 407 onto 406 in a total.

---

## WAFCT double headings

WAFCT prints “X equivalents or [X]” and also “X” under the same tagname.  
**Decision:** keep both rows, different `expression` (`equivalents_or_as_published` vs the specific form).
