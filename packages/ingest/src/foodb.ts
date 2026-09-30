import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { getSource } from "@fsv/shared";
import { sourceRawDir } from "./paths.ts";
import { loadCsvFile, type CsvLoadStats } from "./loadCsv.ts";
import {
  createIndex,
  finalizeIngestDb,
  indexColumnsIfPresent,
  indexFoodTable,
  openIngestDb,
  tableNames,
  type FinalizeResult,
} from "./db.ts";

/** FooDB 2020-04-07 CSV dump: every CSV (Food, Content, Compound, ...) as its own table. */
export async function ingestFoodb(): Promise<FinalizeResult> {
  const source = getSource("foodb")!;
  const root = sourceRawDir(source.datasourcesDir);
  const csvDir = [join(root, "foodb_2020_04_07_csv"), root].find((d) => existsSync(join(d, "Food.csv")));
  if (!csvDir) throw new Error(`No Food.csv under ${root}. Extract foodb_2020_4_7_csv.tar.gz there.`);
  console.log(`raw: ${csvDir}`);
  const h = openIngestDb(source);
  const stats: CsvLoadStats[] = [];
  const files = readdirSync(csvDir)
    .filter((f) => f.toLowerCase().endsWith(".csv") && !f.startsWith("."))
    .sort();
  for (const f of files) {
    const table = basename(f, ".csv");
    const st = await loadCsvFile(h.db, table, join(csvDir, f));
    console.log(`  ${table}: ${st.rows} rows (${st.seconds.toFixed(1)}s)`);
    stats.push(st);
  }
  console.log("indexing");
  for (const t of tableNames(h.db)) {
    indexColumnsIfPresent(h.db, t, ["id", "public_id", "name", "food_id", "compound_id", "source_id"]);
  }
  indexFoodTable(h.db, source);
  createIndex(h.db, "Content", ["source_type", "source_id"]);
  return finalizeIngestDb(h, csvDir, {
    loader: "foodb.ts (every CSV of the dump, streamed)",
    csv_stats: JSON.stringify(stats.map(({ table, rows, columns, shortRows, longRows, seconds }) => ({ table, rows, columns, shortRows, longRows, seconds }))),
    skipped: JSON.stringify([
      "foodb_2020_04_07_json/: same tables as JSON (Content.json 3.5 GB); the CSV dump is loaded instead",
      "._* / .DS_Store: macOS metadata from the tarball",
    ]),
  });
}
