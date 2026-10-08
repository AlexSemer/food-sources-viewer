/**
 * USDA Foundation 2026-04-30 -> usda_foundation_food / usda_foundation_amount (docs/store-schema.md).
 * Reads data/usda-foundation.sqlite read-only. Ticket = nutrient.nutrient_nbr (family usda), code_alt = FDC
 * nutrient.id. A nutrient without a nutrient_nbr (id 2066, beta-glucan, the sterols, vitamin D4 ...) has no ticket:
 * those rows are skipped and logged, never given a code. A missing food_nutrient row is no amount row, not a zero.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataRoot } from "../paths.ts";
import {
  canonical,
  CodeMap,
  createDatasetTables,
  indexDatasetTables,
  writeAmounts,
  type AmountRow,
  type Conflict,
  type MapRow,
  type NutrientRow,
  type SkipLog,
} from "./mapCode.ts";

export const USDA_FOUNDATION = { dataset: "usda_foundation", prefix: "usda_foundation", idCol: "fdc_id", family: "usda", version: "foundation-2026-04-30", rawDb: "usda-foundation.sqlite" };

export type DatasetResult = {
  dataset: string;
  foods: number;
  sourceRows: number;
  amounts: number;
  ignored: number;
  skipped: number;
  collapsed: number;
  conflicts: Conflict[];
  notes: string[];
};

type FnRow = {
  fdc_id: number;
  nutrient_id: number | null;
  nbr: string | null;
  name: string | null;
  unit: string | null;
  amount: number | null;
  data_points: number | null;
  derivation_id: number | null;
  min: number | null;
  max: number | null;
  median: number | null;
  footnote: string | null;
};

export function loadUsdaFoundation(db: DatabaseSync, maps: MapRow[], nutrients: NutrientRow[], skips: SkipLog): DatasetResult {
  const c = USDA_FOUNDATION;
  const rawPath = join(dataRoot, c.rawDb);
  if (!existsSync(rawPath)) throw new Error(`${rawPath} missing. Run: npm run ingest -- usda-foundation`);
  const src = new DatabaseSync(rawPath, { readOnly: true });
  const notes: string[] = [];
  try {
    const map = new CodeMap(maps, c.family, c.version);
    const unitOf = new Map(nutrients.map((n) => [n.id, n.unit]));
    createDatasetTables(db, c.prefix, c.idCol, "INTEGER");

    // Food table: the foundation foods only; n_factor from food_protein_conversion_factor.
    const multi = src
      .prepare(
        `SELECT COUNT(*) AS n FROM (SELECT c.fdc_id FROM food_nutrient_conversion_factor c
           JOIN food_protein_conversion_factor p ON p.food_nutrient_conversion_factor_id = c.id GROUP BY c.fdc_id HAVING COUNT(DISTINCT p.value) > 1)`,
      )
      .get() as { n: number };
    if (multi.n > 0) throw new Error(`${multi.n} foods have more than one protein conversion factor; refusing to pick one`);
    const foods = src
      .prepare(
        `SELECT f.fdc_id, f.description, f.food_category_id,
           (SELECT p.value FROM food_nutrient_conversion_factor c JOIN food_protein_conversion_factor p ON p.food_nutrient_conversion_factor_id = c.id
            WHERE c.fdc_id = f.fdc_id LIMIT 1) AS n_factor
         FROM food f WHERE f.data_type = 'foundation_food' ORDER BY f.fdc_id`,
      )
      .all() as { fdc_id: number; description: string | null; food_category_id: number | null; n_factor: number | null }[];
    const insFood = db.prepare(
      `INSERT INTO ${c.prefix}_food (fdc_id, name, name_local, group_code, edible_1, edible_2, waste_pct, n_factor) VALUES (?, ?, NULL, ?, NULL, NULL, NULL, ?)`,
    );
    for (const f of foods) insFood.run(f.fdc_id, f.description, f.food_category_id === null ? null : String(f.food_category_id), f.n_factor);

    // Amounts: every food_nutrient row of those foods, in source order.
    const fn = src
      .prepare(
        `SELECT fn.fdc_id, fn.nutrient_id, n.nutrient_nbr AS nbr, n.name, n.unit_name AS unit, fn.amount, fn.data_points, fn.derivation_id,
           fn.min, fn.max, fn.median, fn.footnote
         FROM food_nutrient fn JOIN food f ON f.fdc_id = fn.fdc_id AND f.data_type = 'foundation_food'
         LEFT JOIN nutrient n ON n.id = fn.nutrient_id
         ORDER BY fn.fdc_id, fn.id`,
      )
      .all() as FnRow[];
    const out: AmountRow[] = [];
    let ignored = 0;
    let skipped = 0;
    let altMismatch = 0;
    for (const r of fn) {
      const nbr = r.nbr === null || r.nbr === undefined || String(r.nbr).trim() === "" ? null : String(r.nbr).trim();
      const alt = r.nutrient_id === null ? null : String(r.nutrient_id);
      const res = map.resolve(nbr, r.unit);
      if (!res.ok) {
        skipped++;
        skips.add({
          dataset: c.dataset,
          family: c.family,
          code: nbr,
          code_alt: alt,
          name: r.name ?? null,
          unit: r.unit ?? null,
          reason: nbr === null ? (r.name === null ? "nutrient id not in the nutrient table (no nutrient_nbr)" : "no nutrient_nbr") : res.reason === "ambiguous" ? "several map rows, unit does not decide" : "no map row",
        });
        continue;
      }
      const m = res.row;
      if (m.status === "ignore") {
        ignored++;
        skips.add({ dataset: c.dataset, family: c.family, code: nbr, code_alt: alt, name: r.name ?? null, unit: r.unit ?? null, reason: "status ignore (not loaded)" });
        continue;
      }
      if (m.code_alt !== null && m.code_alt !== alt) altMismatch++;
      const amount = r.amount === null || r.amount === undefined ? null : Number(r.amount);
      const can = m.status === "nutrient" ? canonical(amount, r.unit, unitOf.get(m.nutrient_id!)) : null;
      out.push({
        food: r.fdc_id,
        code: m.code,
        code_alt: alt,
        nutrient_id: m.nutrient_id,
        compound_id: m.compound_id,
        expression: m.expression,
        amount,
        amount_unit: r.unit ?? null,
        basis: "100g",
        is_empty: amount === null ? 1 : 0,
        amount_canonical: can?.value ?? null,
        canonical_unit: can?.unit ?? null,
        derivation: r.derivation_id === null || r.derivation_id === undefined ? null : String(r.derivation_id),
        method_text: null,
        n: r.data_points ?? null,
        min: r.min ?? null,
        max: r.max ?? null,
        median: r.median ?? null,
        footnote: r.footnote ?? null,
        citation_id: null,
      });
    }
    if (altMismatch) notes.push(`${altMismatch} rows whose FDC nutrient.id differs from the map's alt_code (FDC id kept in code_alt)`);
    const w = writeAmounts(db, c.prefix, c.idCol, c.dataset, out);
    indexDatasetTables(db, c.prefix, c.idCol);
    return { dataset: c.dataset, foods: foods.length, sourceRows: fn.length, amounts: w.inserted, ignored, skipped, collapsed: w.collapsed, conflicts: w.conflicts, notes };
  } finally {
    src.close();
  }
}
