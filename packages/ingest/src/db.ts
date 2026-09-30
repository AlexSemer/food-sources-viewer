import { renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SourceDef } from "@fsv/shared";
import { dataRoot, ensureDataDir } from "./paths.ts";
import { prepareComposite } from "./compositePrep.ts";

/** Quote an SQLite identifier. */
export function qi(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export type IngestDb = {
  db: DatabaseSync;
  source: SourceDef;
  finalPath: string;
  tmpPath: string;
};

/**
 * Opens a fresh build file `data/<dbFile>.partial`. The finished file only replaces
 * `data/<dbFile>` in finalizeIngestDb, so a failed ingest never leaves a half-built db behind.
 */
export function openIngestDb(source: SourceDef): IngestDb {
  ensureDataDir();
  const finalPath = join(dataRoot, source.dbFile);
  const tmpPath = `${finalPath}.partial`;
  for (const p of [tmpPath, `${tmpPath}-wal`, `${tmpPath}-shm`, `${tmpPath}-journal`]) {
    rmSync(p, { force: true });
  }
  const db = new DatabaseSync(tmpPath);
  db.exec("PRAGMA page_size = 8192");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = OFF");
  db.exec("PRAGMA cache_size = -1048576"); // 1 GiB page cache while bulk loading
  return { db, source, finalPath, tmpPath };
}

export function tableNames(db: DatabaseSync): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
}

export function columnsOf(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${qi(table)})`).all() as { name: string }[]).map(
    (c) => c.name,
  );
}

/** Case-insensitive column lookup (SQLite column names are case-insensitive). */
export function findColumn(db: DatabaseSync, table: string, wanted: string): string | undefined {
  const w = wanted.toLowerCase();
  return columnsOf(db, table).find((c) => c.toLowerCase() === w);
}

export function createIndex(db: DatabaseSync, table: string, cols: string[]): void {
  const name = `ix_${table}_${cols.join("_")}`;
  const t0 = Date.now();
  db.exec(`CREATE INDEX IF NOT EXISTS ${qi(name)} ON ${qi(table)} (${cols.map(qi).join(", ")})`);
  const dt = Date.now() - t0;
  if (dt > 2000) console.log(`  index ${table}(${cols.join(", ")}) ${(dt / 1000).toFixed(1)}s`);
}

/** Index every listed column that exists in the table (case-insensitive). */
export function indexColumnsIfPresent(db: DatabaseSync, table: string, wanted: string[]): void {
  const cols = columnsOf(db, table);
  const done = new Set<string>();
  for (const w of wanted) {
    const col = cols.find((c) => c.toLowerCase() === w.toLowerCase());
    if (col && !done.has(col)) {
      createIndex(db, table, [col]);
      done.add(col);
    }
  }
}

/** Covering index for the Foods search: name order + id, so LIKE scans stay on the narrow index. */
export function indexFoodTable(db: DatabaseSync, source: SourceDef): void {
  const cols = columnsOf(db, source.foodTable);
  if (cols.length === 0) {
    console.warn(`  WARNING foodTable ${source.foodTable} was not created; the Foods search will not work`);
    return;
  }
  for (const f of [source.foodIdField, source.foodNameField]) {
    if (!cols.includes(f)) {
      console.warn(`  WARNING ${source.foodTable} has no column "${f}"`);
      return;
    }
  }
  createIndex(db, source.foodTable, [source.foodIdField]);
  createIndex(db, source.foodTable, [source.foodNameField, source.foodIdField]);
  if (source.foodTypeField && cols.includes(source.foodTypeField)) {
    createIndex(db, source.foodTable, [source.foodTypeField, source.foodNameField, source.foodIdField]);
  }
}

export function tableCounts(db: DatabaseSync): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of tableNames(db)) {
    if (t === "_meta") continue;
    counts[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${qi(t)}`).get() as { n: number }).n;
  }
  return counts;
}

export type FinalizeResult = { counts: Record<string, number>; bytes: number; path: string };

/**
 * Writes `_meta` (same keys usdaFoundation.ts wrote, plus raw_path and loader extras), runs a
 * bounded ANALYZE, checkpoints + truncates the WAL, switches back to a rollback journal so the
 * file is self-contained, closes it and moves it into place.
 */
export function finalizeIngestDb(
  h: IngestDb,
  rawPath: string,
  extra: Record<string, string> = {},
): FinalizeResult {
  const { db, source } = h;
  // Composite-view helpers (indexes, _composite_nutrients, _compound_rank); see compositePrep.ts.
  prepareComposite(db, source);
  const counts = tableCounts(db);

  db.exec(`DROP TABLE IF EXISTS _meta`);
  db.exec(`CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT)`);
  const put = db.prepare("INSERT INTO _meta (key, value) VALUES (?, ?)");
  put.run("source_id", source.id);
  put.run("label", source.label);
  put.run("version", source.version);
  put.run("raw_path", rawPath);
  for (const [k, v] of Object.entries(extra)) put.run(k, v);
  put.run("loaded_at", new Date().toISOString());
  put.run("counts", JSON.stringify(counts));

  db.exec("PRAGMA analysis_limit = 1000");
  db.exec("ANALYZE");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.exec("PRAGMA journal_mode = DELETE");
  db.close();

  // The API dev server closes idle handles after ~15 s; on Windows an open file cannot be
  // replaced, so retry for a while before giving up.
  const deadline = Date.now() + 90_000;
  let warned = false;
  for (;;) {
    try {
      for (const p of [`${h.finalPath}-wal`, `${h.finalPath}-shm`, `${h.finalPath}-journal`]) {
        rmSync(p, { force: true });
      }
      rmSync(h.finalPath, { force: true });
      renameSync(h.tmpPath, h.finalPath);
      break;
    } catch (err) {
      const code = (err as { code?: string }).code ?? String(err);
      const busy = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (busy && Date.now() < deadline) {
        if (!warned) console.log(`  ${h.finalPath} is in use (${code}), waiting for it to be released...`);
        warned = true;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
        continue;
      }
      throw new Error(
        `Could not replace ${h.finalPath} (${code}). Is something (the API server, a SQLite browser) holding it open? ` +
          `Close it and re-run the ingest. The finished db is at ${h.tmpPath}.`,
      );
    }
  }
  return { counts, bytes: statSync(h.finalPath).size, path: h.finalPath };
}
