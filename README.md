# food-sources-viewer

Local browser for landed food-composition dumps. One SQLite file per source in `data/`. **This is an
inspection viewer, not the product DB: there is no cross-source mapping or normalisation; every view
stays within one source.** (The product app, with its own stack, comes later.)

## Stack (viewer only)

- `apps/web`: React + Vite + TypeScript, plain CSS (no UI / graph libraries)
- `apps/api`: Node `http` + TypeScript run with `--experimental-strip-types`, `node:sqlite` (no Express / Nest, no native modules)
- `packages/ingest`: loaders (`npm run ingest -- <source-id>`)
- `packages/shared`: the source registry and the relation finder
- `datasources/` raw files (gitignored), `data/*.sqlite` generated (gitignored)

## Setup

```bash
npm install
npm run ingest -- usda-foundation      # or any source id, or: all
npm run dev:api                        # http://localhost:3001
npm run dev:web                        # http://localhost:5173
```

Copy the dumps into `datasources/` first (see that folder's README). Do not put USDA / OFF / FooDB /
Frida / WAFCT / FAO files in git.

### Extra ingest subcommands

```bash
npm run ingest -- prep <ids|all>       # composite-view helpers on an existing db (idempotent, in place)
npm run ingest -- relations <ids|all>  # recompute data/_relations/<id>.json
```

A normal ingest runs both at the end, so `prep` / `relations` only matter for dbs ingested before they existed.
`prep` adds (only where the tables exist):

| source | what | why |
|---|---|---|
| USDA (all 5) | `_composite_nutrients(nutrient_id, n_values)` | nutrient column list without scanning 26M `food_nutrient` rows |
| USDA | `branded_food(branded_food_category, fdc_id)`, `food(food_category_id, description, fdc_id)`, `food(data_type, description, fdc_id)` | category / data-type filter in name order |
| OFF | `product(pnns_groups_1, product_name, code)`, `product(pnns_groups_2, product_name, code)` | PNNS category filter (about 1 min to build on 4.5M rows) |
| FooDB | `Content(food_id, source_type, source_id, standard_content)`, `_compound_rank` | covering index for the per-page pivot; compounds ranked by the number of foods with a value |

Measured on this machine: all USDA dbs together took about 30 s, FooDB 6 s and OFF 58 s. No source
needed a precomputed `_composite` table; every page is pivoted at query time.

## Views of a source (`/s/:id`)

The toggle writes the mode to the URL: `?view=` missing (single table), `all`, `composite` or `relations`.

### Relations (`?view=relations`)

`GET /api/sources/:id/relations[?refresh=1]` returns how the tables of the db join. The result is cached in
`data/_relations/<id>.json`, keyed on the relation-finder version and the db's `loaded_at`. The finder
(`packages/shared/src/relations.ts`) works like this:

1. **Candidates:** same column name in two tables (`fdc_id`), the name pattern `x_id` / `xId` / `XID` → table `x`
   (plural and CamelCase aware, e.g. `food_category_id` → `food_category.id`, Frida `Data_Normalised.Source` → `Source.SourceID`),
   declared joins that names alone don't reveal (USDA `input_food.fdc_of_input_food`, `acquisition_samples.*`,
   FNDDS `wweia_food_category`, …), FooDB's polymorphic
   `Content.source_id` split by `source_type` (Nutrient / Compound), and the FAO `_food_index` → sheet rows.
2. **Confirmation:** a random sample of up to 1,000 distinct values of the referencing column is looked up in the
   referenced column. Inferred edges are kept when at least 50% match; declared and `_food_index` edges are kept
   down to 5%. Weaker candidates are listed as notes ("weak: … only 31% match (dropped)").
3. **Cardinality:** a side is "1" if its column is unique. A column counts as unique if at most max(2, 0.5%) of
   its values are duplicated; the edge note then names the duplicates (e.g. Frida's Isomalt ID 344 is listed twice).
   Edges between two siblings of one unique parent (e.g. `Food.FoodGroupID` ↔ `Data_Table.FoodGroupID`) are dropped.
4. **Coverage / rows per parent:** the share of referenced values that have any row, and the average number of rows per parent.

The UI draws the main food table in the centre column, directly joined tables left and right of it, and tables
joined through those further out. Each edge is labelled `column · cardinality · match %`, and clicking a table
highlights its joins. Below the diagram is the full edge list and the notes (weak or unjoined tables).

### Composite (`?view=composite`)

One row per **main food** of the source, in the layout of a nutrition spreadsheet:

`Major Category | Sub-Category | Base Ingredient | Variant / Preparation | Notes / Serving Ideas | Food ID | Full name | extras… | one column per nutrient "Name (unit)", alphabetical | related-row summaries`

- **Identity columns** are taken only from what the source has. If the source has no second category level,
  Sub-Category is `-`; categories are never invented.
- **Base / variant split rule** (everywhere): the text before the first comma of the food name is the base, and the
  rest is the variant (`Apples, raw, with skin` → `Apples` / `raw, with skin`; `Eggs, Grade A, Large, egg whole` →
  `Eggs` / `Grade A, Large, egg whole`). A name without a comma has variant `-`. The full name is always a column too.
- **Nutrient columns:** long tables (USDA `food_nutrient`, FooDB `Content`, Frida `Data_Normalised`) are pivoted.
  Wide sheets (OFF, WAFCT, FAO) map their own columns, taking units from the header rows where the source has them.
  Values are shown as stored, with no unit conversion. Missing values show as `-`.
- **Related rows** (1:N tables) are summarised in one cell, e.g. portions `1 cup = 136 g; 1 large = 50 g`,
  attributes, input foods, conversion factors, FooDB content counts and citations, Frida sources.
- Every source's page has a "How this composite is built" panel (from `GET …/composite/meta`) with the exact
  main-food definition and column mapping.

| source | main food | Major / Sub category |
|---|---|---|
| usda-foundation | `food` of the selected data type (default `foundation_food`). Sample, sub-sample and acquisition rows are counted in "Input foods" and can be selected | `food_category` / - |
| usda-sr-legacy, usda-fndds, usda-branded | `food` rows of that data type | `food_category`, WWEIA category (FNDDS), `branded_food_category` / - |
| usda-full | `food` of the selected data type (default: branded + SR + FNDDS + foundation + experimental) | as above, per data type / - |
| off | `product` rows with a `product_name` | `pnns_groups_1` / `pnns_groups_2` |
| foodb | `Food` | `food_group` / `food_subgroup` |
| frida | `Food` | parent group (level 2) / `FoodGroup` (level 3) |
| wafct | `05_NV_sum_57_per_100g_EP` rows with an English name | the food-group header row above the food / - |
| wafct-2012 | `USERDATABASE` rows with Code `NN_NNN` | header row above the food / - |
| fao-anfood, fao-biofoodcomp, fao-phyfoodcomp | `_food_index` (every food row of every per-group sheet) | sheet / the sheet's Subgroup (phyfood: name from `Food_groups`) |
| fao-pulsesdm, fao-upulses | the `04_NV_sum…` sheet | - / Species |
| fao-ufish | `04_NV_sum_per_100_g_EP` | ISSCAAP group / species (via `02_Overview_Species`) |
| fao-supplement | `Main_extract` grouped by Product ID | supplement group / - |
| fao-density | `Density_DB` rows with a value | heading row above / - |

**How a page is built (query-time pivot).** One ordered query selects the page's rowids (filters on name, id and
category, in name order; `GROUP BY` for FAO supplement). One query per related table then fetches the values for
exactly those ids (`WHERE fdc_id IN (…50 ids…)`), and the rows are assembled in JS. The count uses the table
size when unfiltered, is exact for a short last page, and otherwise stops at 100,000 (shown as `100,000+`).
Name searches on the big tables (usda-branded, usda-full, off) stop after 2 s and flag the result as partial.

**Column picker:** "non-empty on this page" (default), "show all", or a custom checklist. The choice is stored per
source in localStorage. The first identity columns stay pinned while you scroll sideways.

**CSV:** `GET /api/sources/:id/composite.csv?<same filters>[&cols=<indexes>][&sep=;]` streams every page of the
current filter. It iterates rowids in chunks of 500 and waits for the socket's back-pressure (`drain`), so memory
stays flat. The file is UTF-8 with a BOM and CRLF, so `µg` / `ω-3` headers open correctly in Excel. Use `sep=;`
for Excel with a comma-decimal locale. usda-branded exports at about 5,000–10,000 rows/s (2M rows ≈ 4–7 min).

### API

| endpoint | |
|---|---|
| `GET /api/sources/:id/relations[?refresh=1]` | relation document (cached JSON) |
| `GET /api/sources/:id/composite/meta?type&mode&agg` | columns, categories, sub-categories, data types / modes, docs |
| `GET /api/sources/:id/composite?q&cat&sub&type&mode&agg&page&pageSize` | one page (50 rows default, 200 max) |
| `GET /api/sources/:id/composite.csv?…&cols&sep&limit` | streamed CSV |

FooDB `mode=nutrients` (default; the 39 Nutrient rows) or `mode=compounds` (the 200 compounds quantified in the
most foods); `agg=avg|min|max|n` sets how its several values per food × component are combined in a cell.

## Online sample (Vercel)

A password-protected copy with sample data runs on Vercel (project `food-sources-viewer`, personal account). It
serves only the five main sources, `usda-foundation`, `wafct`, `frida`, `foodb` and `store`, each cut to its
first 200 main foods. The full `data/` stays local.

- `npm run sample [ids...]` writes `data-sample/<dbFile>` from `data/` (read-only), keeping the first 200 main foods
  and only the rows that belong to them. It also rebuilds the composite helpers and `data-sample/_relations/`. The
  rules for each source are at the top of `packages/ingest/src/sample.ts`. FooDB keeps all Nutrient rows plus at
  most 5 quantified rows per food × compound, so the file stays under 50 MB. `data-sample/` is committed.
- `npm run build:vercel` (`scripts/vercel/build.mjs`) writes `.vercel/output` (Build Output API). That holds the
  Vite build as static files, `apps/api` bundled by esbuild into one function with `data-sample/` beside it, and a
  Basic-auth middleware on every request. Any user name works. The password is the project env var `SITE_PASSWORD`,
  which is never committed.
- The function runs the same handler as `npm run dev:api` (`apps/api/src/app.ts`) with `FSV_SAMPLE=1`. In that
  mode the API lists only the sampled sources, never writes (the relations cache comes prebuilt), and `/api/meta`
  reports the sample, which turns on the banner in the web app. Locally nothing changes: `data/` and every source.
- Pushes to `main` redeploy. After changing the data, run `npm run sample`, commit `data-sample/`, then push.

## Caveats

- OFF has no units in its export header. Units follow OFF's documented `_100g` conventions.
- FooDB often has several values per food × nutrient (DUKE, DTU, USDA …). The cell shows their average by default.
- WAFCT 2012 per-food `n` / `SD` rows, FAO `Sports_products` and FAO uFish `06_AA` / `07_FA` (own ids) are not merged.
- USDA `food_component.fdc_id` is empty in the 2026-04 Foundation release, so that table joins to nothing.
- The first-comma base/variant split is naive (e.g. brand names in branded foods rarely have commas).
- USDA Foundation: `food` has 469 `foundation_food`-type rows, but the `foundation_food` table lists 395 of them; the
  composite follows `food.data_type`.
- Deep pages use `OFFSET`, which is fine up to thousands of pages. Use a filter rather than paging to page 40,000.
