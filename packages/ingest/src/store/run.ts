/**
 * NUTRI store (docs/store-schema.md): `npm run ingest -- store [dataset...]` builds data/store.sqlite from scratch
 * (temp file, then swap; same _meta conventions as the other loaders). Shared tables nutrient + nutrient_code,
 * then one food/amount table pair per dataset. Logs: data/logs/store-skipped.csv, data/logs/store-conflicts.csv.
 *
 * Datasets: usda-foundation (implemented). wafct and frida are planned and fail with "not implemented yet".
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getSource } from "@fsv/shared";
import { dataRoot } from "../paths.ts";
import { finalizeIngestDb, openIngestDb, type FinalizeResult } from "../db.ts";
import { MAP_FILES, nutrientsDir, readMaps, readNutrients, SkipLog, writeSharedTables, type AmountRow } from "./mapCode.ts";
import { loadUsdaFoundation, type DatasetResult } from "./usdaFoundation.ts";

const DATASETS: Record<string, ((...a: Parameters<typeof loadUsdaFoundation>) => DatasetResult) | null> = {
  "usda-foundation": loadUsdaFoundation,
  wafct: null,
  frida: null,
};

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
const csvLine = (cells: unknown[]) => cells.map(csvCell).join(",");

export async function runStore(args: string[]): Promise<FinalizeResult> {
  const wanted = args.length && !args.includes("all") ? args : Object.keys(DATASETS).filter((d) => DATASETS[d]);
  for (const d of wanted) {
    if (!(d in DATASETS)) throw new Error(`Unknown store dataset: ${d}. Known: ${Object.keys(DATASETS).join(", ")}`);
    if (!DATASETS[d]) throw new Error(`store dataset "${d}" is not implemented yet (only: ${Object.keys(DATASETS).filter((x) => DATASETS[x]).join(", ")})`);
  }
  const source = getSource("store")!;
  const nutrients = readNutrients();
  const maps = readMaps();
  console.log(`maps: nutrient.csv ${nutrients.length} rows; nutrient_code ${maps.length} rows from ${MAP_FILES.join(", ")}`);

  const h = openIngestDb(source);
  const skips = new SkipLog();
  const results: DatasetResult[] = [];
  try {
    writeSharedTables(h.db, nutrients, maps);
    for (const d of wanted) {
      const t0 = Date.now();
      h.db.exec("BEGIN");
      const r = DATASETS[d]!(h.db, maps, nutrients, skips);
      h.db.exec("COMMIT");
      results.push(r);
      console.log(
        `  ${r.dataset}: ${r.foods} foods; ${r.sourceRows} source rows -> ${r.amounts} amount rows ` +
          `(${r.ignored} ignore, ${r.skipped} skipped unmapped, ${r.collapsed} exact duplicates collapsed, ${r.conflicts.length} conflict rows) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      for (const n of r.notes) console.log(`    note: ${n}`);
    }
  } catch (err) {
    try {
      h.db.close();
    } catch {
      /* already closed */
    }
    throw err;
  }

  const logDir = join(dataRoot, "logs");
  mkdirSync(logDir, { recursive: true });
  const skipped = skips.list();
  writeFileSync(
    join(logDir, "store-skipped.csv"),
    [csvLine(["dataset", "family", "code", "code_alt", "name", "unit", "reason", "rows"]), ...skipped.map((s) => csvLine([s.dataset, s.family, s.code, s.code_alt, s.name, s.unit, s.reason, s.rows]))].join("\r\n") + "\r\n",
  );
  const conflicts = results.flatMap((r) => r.conflicts);
  const cols: (keyof AmountRow)[] = ["food", "code", "code_alt", "expression", "basis", "amount", "amount_unit", "derivation", "n", "min", "max", "median", "footnote"];
  writeFileSync(
    join(logDir, "store-conflicts.csv"),
    [csvLine(["dataset", "key", ...cols]), ...conflicts.map((c) => csvLine([c.dataset, c.key, ...cols.map((k) => c.row[k])]))].join("\r\n") + "\r\n",
  );
  console.log(`  logs: store-skipped.csv (${skipped.length} lines), store-conflicts.csv (${conflicts.length} rows)`);

  return finalizeIngestDb(h, nutrientsDir, {
    loader: "store/run.ts (docs/store-schema.md)",
    datasets: wanted.join(","),
    maps: JSON.stringify(MAP_FILES),
    schema_deviations: "none",
    results: JSON.stringify(results.map(({ conflicts: c, ...r }) => ({ ...r, conflictRows: c.length }))),
  });
}
