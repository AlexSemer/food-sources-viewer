<!-- archived 2026-09-27 -->
> Merged into `docs/decisions/LOCKED.md` §§1–2. Keep only as the original lock note.

STAGE: founder-decision
TICKET: none
STATUS: approved
NEXT: USDA-first V1 mapping (Foundation only); still no DB load

PROJECT: NUTRI

# Nutrient vs Compound — option A locked

Date: 2026-09-27

## Decision

Option A:

- **Nutrient** = intake figures people track (protein, vit_c, energy, added sugars, …). Goals and organ effects use only this list.
- **Compound** = named chemicals reported in a food (anthocyanins, caffeine, …). Separate catalog.
- **Observations** hold amounts: food + nutrient or food + compound + source + unit + expression.
- Optional link later: this Compound *is* this Nutrient (ascorbic acid → vit_c). Compound row stays.
- Product focus is nutrients. Extra chemical / observation data is shown when we have it.
- UI: dataset dropdown. V1 shows **one** source. Mix (USDA + extras) is later, not V1.
- **V1 source: USDA.** Default slice = FoodData Central **Foundation Foods** (2026-04-30 on disk). SR Legacy can sit in the dropdown later; V1 does not blend Foundation + SR + branded.

Rejected:

- B — one Component table with a type flag
- C — nutrients only, compounds deferred entirely
- Blending several databases into one “true” number in V1
- Treating every FooDB chemical as a Nutrient
- Claiming a complete chemical inventory of food

## What we show in V1

USDA Foundation nutrient panel for the food.  
SR Legacy / OFF / Frida / WAFCT stay landed for later dropdown values.  
FooDB compounds are extra data only, not V1 totals.

## Not decided here

- Sugar molecule rows (glucose, lactose, …)
- Salt vs sodium as two Nutrients
- Canonical energy / vitamin A expression
- Loading any database or FooDB Content.json

OPEN QUESTIONS:
- Treat USDA 208 kcal as the energy number shown in V1, or leave all Energy codes visible?
- Next: paper-plan, or finish USDA NutrientCode slice only?

HANDOFF TO: founder
