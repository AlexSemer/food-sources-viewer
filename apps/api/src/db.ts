import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { getSource } from "@fsv/shared";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const dataRoot = resolve(repoRoot, "data");

/** Filtered counts stop here and report `totalCapped`. */
export const COUNT_CAP = 10_000;

/*
 * node:sqlite is synchronous, so one slow LIKE scan (e.g. 4.5M OFF products) blocks every other request.
 * A request may run a query under a time budget; the query then carries `fsv_budget()`, which SQLite
 * calls for each scanned row and which aborts the statement once the deadline has passed.
 */
let budgetDeadline = Infinity;
let budgetTicks = 0;
let budgetHit = false;

function budgetFn(): number {
  if ((++budgetTicks & 1023) === 0 && Date.now() > budgetDeadline) {
    budgetHit = true;
    throw new Error("search time budget exceeded");
  }
  return 1;
}

/** Runs `fn` with fsv_budget() armed for `ms` (0 = no budget). `timedOut` is true if the budget stopped it. */
export function withBudget<T>(ms: number, fn: () => T, onTimeout: () => T): { value: T; timedOut: boolean } {
  budgetDeadline = ms > 0 ? Date.now() + ms : Infinity;
  budgetHit = false;
  try {
    return { value: fn(), timedOut: false };
  } catch (err) {
    if (!budgetHit) throw err;
    return { value: onTimeout(), timedOut: true };
  } finally {
    budgetDeadline = Infinity;
    budgetHit = false;
  }
}

export type DbInfo = {
  db: DatabaseSync;
  meta: Record<string, string>;
  counts: Record<string, number>;
  /** table -> columns, in sqlite_master order */
  tables: Map<string, string[]>;
  /** table -> columns that lead an index */
  indexed: Map<string, Set<string>>;
  /** index name -> table */
  indexNames: Map<string, string>;
  foodTypes?: string[];
  lastUsed: number;
  /** > 0 while a streaming response (CSV export) still reads from the handle. */
  pins: number;
  /** File mtime when opened; part of cache keys. */
  mtimeMs: number;
};

const openDbs = new Map<string, DbInfo>();

/**
 * Handles are closed after a short idle period. On Windows an open SQLite file cannot be replaced,
 * so this lets `npm run ingest` swap in a fresh db while the dev server keeps running.
 */
const IDLE_CLOSE_MS = 15_000;
setInterval(() => {
  const now = Date.now();
  for (const [id, info] of openDbs) {
    if (info.pins === 0 && now - info.lastUsed > IDLE_CLOSE_MS) {
      openDbs.delete(id);
      try {
        info.db.close();
      } catch {
        /* already closed */
      }
    }
  }
}, 5_000).unref();

export function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

export const qi = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Rows with INTEGERs read as BigInt, so values beyond 2^53 survive (serialized as strings). */
export function all(stmt: StatementSync, ...params: (string | number | null)[]): Record<string, unknown>[] {
  stmt.setReadBigInts(true);
  return stmt.all(...params) as Record<string, unknown>[];
}

export function get(stmt: StatementSync, ...params: (string | number | null)[]): Record<string, unknown> | undefined {
  stmt.setReadBigInts(true);
  return stmt.get(...params) as Record<string, unknown> | undefined;
}

function metaOf(db: DatabaseSync): Record<string, string> {
  try {
    const rows = db.prepare("SELECT key, value FROM _meta").all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch {
    return {};
  }
}

export function dbPath(sourceId: string): string {
  const source = getSource(sourceId);
  if (!source) throw httpError(404, "unknown source");
  return resolve(dataRoot, source.dbFile);
}

export function openDb(sourceId: string): DbInfo {
  const source = getSource(sourceId);
  if (!source) throw httpError(404, "unknown source");
  const cached = openDbs.get(sourceId);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached;
  }
  const path = resolve(dataRoot, source.dbFile);
  if (!existsSync(path)) throw httpError(404, `No database yet. Run: npm run ingest -- ${source.id}`);
  const db = new DatabaseSync(path, { readOnly: true });
  db.function("fsv_budget", { deterministic: false, directOnly: true }, budgetFn);
  const meta = metaOf(db);
  let counts: Record<string, number> = {};
  try {
    counts = JSON.parse(meta.counts ?? "{}");
  } catch {
    counts = {};
  }
  const tables = new Map<string, string[]>();
  const indexed = new Map<string, Set<string>>();
  const indexNames = new Map<string, string>();
  const names = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as { name: string }[];
  for (const { name } of names) {
    tables.set(name, (db.prepare(`PRAGMA table_info(${qi(name)})`).all() as { name: string }[]).map((c) => c.name));
    const lead = new Set<string>();
    for (const ix of db.prepare(`PRAGMA index_list(${qi(name)})`).all() as { name: string }[]) {
      indexNames.set(ix.name, name);
      const first = (db.prepare(`PRAGMA index_info(${qi(ix.name)})`).all() as { seqno: number; name: string }[]).find(
        (c) => c.seqno === 0,
      );
      if (first?.name) lead.add(first.name);
    }
    indexed.set(name, lead);
  }
  const info: DbInfo = { db, meta, counts, tables, indexed, indexNames, lastUsed: Date.now(), pins: 0, mtimeMs: statSync(path).mtimeMs };
  openDbs.set(sourceId, info);
  return info;
}

export function rowCount(info: DbInfo, table: string): number {
  if (info.counts[table] === undefined) {
    info.counts[table] = (info.db.prepare(`SELECT COUNT(*) AS n FROM ${qi(table)}`).get() as { n: number }).n;
  }
  return info.counts[table];
}

export function cappedCount(
  info: DbInfo,
  from: string,
  where: string,
  params: (string | number)[],
  cap = COUNT_CAP,
): { total: number; capped: boolean } {
  const n = (
    info.db.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${from} ${where} LIMIT ${cap + 1})`).get(...params) as {
      n: number;
    }
  ).n;
  return n > cap ? { total: cap, capped: true } : { total: n, capped: false };
}

/** Values from the URL are text; xlsx cells may hold numbers. Match either representation. */
export function eqParams(value: string): [string, string | number] {
  return [value, /^-?\d+(\.\d+)?$/.test(value) && value.length < 16 ? Number(value) : value];
}

export function findCol(cols: string[] | undefined, wanted: string): string | undefined {
  if (!cols) return undefined;
  return cols.find((c) => c === wanted) ?? cols.find((c) => c.toLowerCase() === wanted.toLowerCase());
}
