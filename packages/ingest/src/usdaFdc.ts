import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { getSource, type SourceId } from "@fsv/shared";
import { sourceRawDir } from "./paths.ts";
import { loadCsvFile, type CsvLoadStats } from "./loadCsv.ts";
import {
  columnsOf,
  createIndex,
  finalizeIngestDb,
  indexFoodTable,
  openIngestDb,
  tableNames,
  type FinalizeResult,
} from "./db.ts";

export function findCsvDir(root: string): string {
  if (existsSync(join(root, "food.csv"))) return root;
  const queue = [root];
  while (queue.length) {
    const dir = queue.shift()!;
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    if (existsSync(join(dir, "food.csv"))) return dir;
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      queue.push(join(dir, name));
    }
  }
  throw new Error(`No food.csv under ${root}. Extract the FoodData Central CSV zip into datasources/.`);
}

/**
 * Any FoodData Central CSV download (Foundation, SR Legacy, FNDDS, Branded, Full): every
 * *.csv in the extracted folder becomes a table of the same name, streamed.
 */
export function usdaLoader(id: SourceId): () => Promise<FinalizeResult> {
  return async () => {
    const source = getSource(id)!;
    const csvDir = findCsvDir(sourceRawDir(source.datasourcesDir));
    console.log(`raw: ${csvDir}`);
    const h = openIngestDb(source);
    const { db } = h;
    const files = readdirSync(csvDir)
      .filter((f) => f.toLowerCase().endsWith(".csv") && !f.startsWith("."))
      .sort();
    const stats: CsvLoadStats[] = [];
    for (const f of files) {
      const table = basename(f, ".csv");
      const st = await loadCsvFile(db, table, join(csvDir, f));
      console.log(`  ${table}: ${st.rows} rows (${st.seconds.toFixed(1)}s)`);
      stats.push(st);
    }

    console.log("indexing");
    for (const t of tableNames(db)) {
      const cols = columnsOf(db, t);
      if (cols.includes("id")) createIndex(db, t, ["id"]);
      if (cols.includes("fdc_id") && !(t === "food")) createIndex(db, t, ["fdc_id"]);
    }
    indexFoodTable(db, source);
    if (columnsOf(db, "food_nutrient").includes("nutrient_id")) createIndex(db, "food_nutrient", ["nutrient_id"]);
    if (columnsOf(db, "branded_food").includes("gtin_upc")) createIndex(db, "branded_food", ["gtin_upc"]);
    if (columnsOf(db, "wweia_food_category").length) createIndex(db, "wweia_food_category", ["wweia_food_category"]);
    if (columnsOf(db, "food_category").includes("description")) createIndex(db, "food_category", ["description"]);
    if (columnsOf(db, "nutrient").includes("name")) createIndex(db, "nutrient", ["name"]);

    const skipped = readdirSync(csvDir).filter((f) => !f.toLowerCase().endsWith(".csv"));
    return finalizeIngestDb(h, csvDir, {
      csv_dir: csvDir,
      loader: "usdaFdc.ts (every CSV in the download, streamed)",
      skipped: JSON.stringify(skipped.map((f) => `${f}: documentation, not a data table`)),
      csv_stats: JSON.stringify(stats.map(({ table, rows, columns, shortRows, longRows, seconds }) => ({ table, rows, columns, shortRows, longRows, seconds }))),
    });
  };
}
