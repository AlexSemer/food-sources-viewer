<!-- archived 2026-09-27 -->
> Archived July product sketch. Not a contract.
> Current rules: `docs/decisions/LOCKED.md` and `docs/README.md`.

# Nutrient Intelligence Platform — Architecture Blueprint

**Vision**  
The most comprehensive, science-grounded system for foods, nutrients, and human intake needs.  
Core principle: **Every nutrient has a physiological purpose. Every food is a vector of nutrients. Every individual has a unique requirement map.**

We map the entire food → nutrient → requirement → organ/system → outcome continuum with precision, personalization, and transparency.

---

## 1. High-Level Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Presentation / Interaction Layer                           │
│  (Body Visualizer, Food Explorer, Intake Tracker, Reports)  │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  Business Logic / Domain Services                           │
│  • Requirement Engine                                       │
│  • Nutrient Mapping & Scoring                               │
│  • Food Matching & Optimization                             │
│  • Deficiency / Excess Risk                                 │
│  • Organ Impact Aggregator                                  │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  Data Layer                                                 │
│  • Canonical Nutrient Registry                              │
│  • Food Composition Database                                │
│  • Dietary Reference Intakes (DRI) + Personalization        │
│  • Organ / System Effect Mappings                           │
│  • User Profiles & Intake Logs                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Core Domain Concepts

| Concept              | Description                                                                 | Key Relations                          |
|----------------------|-----------------------------------------------------------------------------|----------------------------------------|
| **Nutrient**         | Atomic unit (macro or micro). Has unit, category, bioavailability factors. | → Effects on organs, → Requirements   |
| **Food**             | Source of nutrients. Composition per 100 g or serving.                      | → Nutrient amounts                     |
| **Requirement**      | Target intake for a nutrient given life-stage, sex, activity, conditions.  | ← Nutrient, ← User profile             |
| **Effect Mapping**   | How a nutrient (or lifestyle factor) influences an organ/system (pos/neg). | Used by Body Visualizer                |
| **User Profile**     | Demographics + goals + conditions that modify requirements.                 | → Personalized DRI                     |
| **Intake Event**     | Logged consumption of foods → aggregated nutrient totals.                   | Compared against Requirements          |

---

## 3. Recommended Project File Structure

```
artifacts/
├── body-health-visualizer.html          # Existing interactive prototype (keep as UI reference)
├── docs/
│   ├── ARCHITECTURE.md                  # This file
│   ├── NUTRIENT_TAXONOMY.md             # Full classification of macros/micros
│   └── DATA_SOURCES.md                  # USDA FDC, DRI tables, evidence notes
├── schemas/
│   ├── nutrient.schema.json
│   ├── food.schema.json
│   ├── requirement.schema.json
│   ├── effect-mapping.schema.json
│   ├── user-profile.schema.json
│   └── intake-log.schema.json
├── data/
│   ├── nutrients/                       # Canonical nutrient definitions
│   ├── foods/                           # Composition data (start with curated + USDA subset)
│   ├── requirements/                    # DRI tables by life stage
│   ├── mappings/                        # Organ & system effect maps
│   └── examples/                        # Sample user profiles & day logs
├── src/
│   ├── core/                            # Pure domain logic (no UI)
│   │   ├── requirement-engine.js
│   │   ├── nutrient-scorer.js
│   │   ├── food-matcher.js
│   │   └── organ-impact.js
│   ├── services/                        # Higher-level orchestration
│   └── ui/                              # Future modular UI components
└── config/
    └── constants.js                     # Units, conversion factors, default multipliers
```

---

## 4. Schema Overview (see /schemas for formal JSON Schema)

### 4.1 Nutrient
- id, name, category (macro | vitamin | mineral | fatty_acid | amino_acid | other)
- unit (g, mg, µg, IU, kcal…)
- synonyms, aliases
- default_rda_notes, upper_limit notes
- bioavailability modifiers (e.g. iron heme vs non-heme)

### 4.2 Food
- id, name, description, food_group, brand (optional)
- serving_size + unit
- nutrients: array of { nutrient_id, amount, amount_per_100g }
- tags (vegan, high_protein, low_fodmap…)
- source (USDA FDC id, manual, lab)

### 4.3 Requirement (Dietary Reference)
- nutrient_id
- life_stage (infant, child, adolescent, adult, older_adult, pregnancy, lactation)
- sex
- value_type (RDA | AI | EAR | UL | AMDR)
- value + unit
- conditions modifiers (e.g. athlete multiplier, vegan adjustment)

### 4.4 Effect Mapping (extends current visualizer)
- factor_id (nutrient or lifestyle)
- factor_type
- organ / system
- direction (positive | negative | complex)
- strength (1–5)
- evidence_level
- notes (mechanism)

### 4.5 User Profile
- demographics (age, sex, height, weight, activity_level)
- goals (maintenance, muscle_gain, fat_loss, longevity…)
- conditions (pregnancy, vegan, IBD, anemia history…)
- calculated daily energy + nutrient targets

### 4.6 Intake Log
- timestamp, foods consumed (with quantities)
- computed nutrient totals
- comparison vs personal targets → surplus / deficit flags

---

## 5. Core Business Logic Modules

### 5.1 Requirement Engine
Input: User Profile  
Output: Map of nutrient_id → daily target (amount + unit) + upper limit  

Logic:
1. Select base DRI row by age band + sex + life stage.
2. Apply activity / energy multipliers for macros.
3. Apply condition-specific adjustments (e.g. + iron for menstruating, +B12 for vegan).
4. Return full target set.

### 5.2 Nutrient Aggregator & Scorer
Input: list of foods + quantities  
Output: total nutrients + % of personal target + RAG status (green/amber/red)

### 5.3 Organ Impact Aggregator
Input: current nutrient status (or selected factors)  
Output: organ-level positive/negative scores (powers the visualizer)

### 5.4 Food Matching / Recommendation
Given current deficits → rank foods by density of missing nutrients, bioavailability, user constraints (allergies, preferences, calories).

### 5.5 Meal / Day Optimizer (future)
Constraint solver or heuristic that builds a day of food meeting as many targets as possible within calorie budget.

---

## 6. Immediate Next Steps (Priority Order)

1. Formalize the six JSON Schemas (done in /schemas).
2. Create canonical `nutrients.json` with full macro + micro list (vitamins A–K, minerals, key fatty acids, amino acids).
3. Seed `requirements/` with official DRI tables (age/sex bands).
4. Expand the existing body-health-visualizer data model to use the new Effect Mapping schema.
5. Build pure JS core modules that the visualizer (and future UIs) can import.
6. Begin curated high-quality food entries + link to USDA FDC identifiers for scale.

---

*This architecture is designed to grow from the current single-file visualizer into a full-stack nutrient intelligence system without rewriting the domain core.*
