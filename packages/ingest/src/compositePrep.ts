/**
 * Composite-view preparation for an already ingested source db (idempotent, runs in place).
 *
 *   npm run ingest -- prep <source-id...|all>
 *
 * The composite view pivots each page at query time; this only adds what makes that fast on the big dbs:
 *  - USDA:  _composite_nutrients(nutrient_id, n_values): nutrients actually used (column list without a
 *           26M-row scan); branded_food(branded_food_category, fdc_id) for the category filter; in usda-full
 *           food(food_category_id, description, fdc_id) for category + name order.
 *  - OFF:   product(pnns_groups_1|2, product_name, code) for the PNNS category filter in name order.
 *  - FooDB: Content(food_id, source_type, source_id, standard_content) covering index for the per-page
 *           pivot, and _compound_rank(compound_id, foods, rank): compounds by number of foods with a
 *           quantified value (the "compounds" mode shows the top 200).
 * Loaders call it right before finalizeIngestDb, so a fresh ingest is already prepared.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SourceDef } from "@fsv/shared";
import { dataRoot } from "./paths.ts";
import { columnsOf, createIndex, tableNames } from "./db.ts";

function timed(label: string, fn: () => void, log: string[]): void {
  const t0 = Date.now();
  fn();
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  log.push(`${label} (${s}s)`);
  // createIndex already prints indexes that took over 2 s
  if (!label.startsWith("index ") || Date.now() - t0 <= 2000) console.log(`  ${label} ${s}s`);
}

/** Adds the composite helpers to an open, writable db. Returns what was done. */
export function prepareComposite(db: DatabaseSync, source: SourceDef): string[] {
  const log: string[] = [];
  const tables = new Set(tableNames(db));
  const has = (t: string, ...cols: string[]) => tables.has(t) && cols.every((c) => columnsOf(db, t).includes(c));
  if (source.id.startsWith("usda-")) {
    if (has("food_nutrient", "nutrient_id")) {
      timed(
        "_composite_nutrients",
        () => {
          db.exec("DROP TABLE IF EXISTS _composite_nutrients");
          db.exec(`CREATE TABLE _composite_nutrients AS SELECT nutrient_id, COUNT(*) AS n_values FROM food_nutrient GROUP BY nutrient_id`);
        },
        log,
      );
    }
    if (has("branded_food", "branded_food_category", "fdc_id"))
      timed("index branded_food(branded_food_category, fdc_id)", () => createIndex(db, "branded_food", ["branded_food_category", "fdc_id"]), log);
    if (has("food", "food_category_id", "description", "fdc_id"))
      timed("index food(food_category_id, description, fdc_id)", () => createIndex(db, "food", ["food_category_id", "description", "fdc_id"]), log);
    if (has("food", "data_type", "description", "fdc_id"))
      timed("index food(data_type, description, fdc_id)", () => createIndex(db, "food", ["data_type", "description", "fdc_id"]), log);
  }
  if (source.id === "off" && has("product", "pnns_groups_1", "pnns_groups_2", "product_name", "code")) {
    timed("index product(pnns_groups_1, product_name, code)", () => createIndex(db, "product", ["pnns_groups_1", "product_name", "code"]), log);
    timed("index product(pnns_groups_2, product_name, code)", () => createIndex(db, "product", ["pnns_groups_2", "product_name", "code"]), log);
  }
  if (source.id === "foodb" && has("Content", "food_id", "source_type", "source_id", "standard_content")) {
    timed(
      "index Content(food_id, source_type, source_id, standard_content)",
      () => createIndex(db, "Content", ["food_id", "source_type", "source_id", "standard_content"]),
      log,
    );
    timed(
      "_compound_rank",
      () => {
        db.exec("DROP TABLE IF EXISTS _compound_rank");
        db.exec(`CREATE TABLE _compound_rank (compound_id INTEGER PRIMARY KEY, foods INTEGER, rank INTEGER)`);
        db.exec(`INSERT INTO _compound_rank (compound_id, foods, rank)
                 SELECT id, foods, ROW_NUMBER() OVER (ORDER BY foods DESC, id) FROM (
                   SELECT source_id AS id, COUNT(DISTINCT food_id) AS foods FROM Content
                   WHERE source_type = 'Compound' AND standard_content IS NOT NULL AND source_id IS NOT NULL GROUP BY source_id)`);
        db.exec(`CREATE INDEX ix__compound_rank_rank ON _compound_rank (rank)`);
      },
      log,
    );
  }
  if (log.length) {
    db.exec("PRAGMA analysis_limit = 1000");
    db.exec("ANALYZE");
    try {
      db.prepare(`INSERT OR REPLACE INTO _meta (key, value) VALUES ('composite_prepared_at', ?)`).run(new Date().toISOString());
    } catch {
      /* no _meta yet (called before finalize, which writes it) */
    }
  }
  return log;
}

/** `npm run ingest -- prep <id>`: prepares the existing data/<dbFile> in place. */
export function prepareExisting(source: SourceDef): string[] {
  const path = join(dataRoot, source.dbFile);
  if (!existsSync(path)) throw new Error(`No database yet: ${path}. Run: npm run ingest -- ${source.id}`);
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 60000");
    db.exec("PRAGMA cache_size = -1048576");
    return prepareComposite(db, source);
  } finally {
    db.close();
  }
}

