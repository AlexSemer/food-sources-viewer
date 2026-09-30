/**
 * Composite view: one row per "main food" of a source, with identity columns, one column per
 * nutrient/component (unit in the header, alphabetical) and compact summaries of related 1:N rows.
 *
 * Everything stays inside one source's db; nothing is mapped across sources and no values are
 * converted. Per-source definitions live in composite-specs.ts; this file is the engine:
 *  - page: one ordered rowid query (LIMIT/OFFSET, optional search time budget), then the spec pivots
 *    only that page's foods (long nutrient tables are read with one `WHERE food IN (...)` query).
 *  - CSV: the same rowid query is iterated and pivoted in chunks of CSV_CHUNK rows, written with
 *    back-pressure, so memory stays flat even for 2M USDA branded foods.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { getSource } from "@fsv/shared";
import { cappedCount, httpError, openDb, qi, withBudget } from "./db.ts";
import type { Agg, Ctx, Filters, Row, Spec } from "./composite-specs.ts";
import { specFor } from "./composite-registry.ts";

export const COMPOSITE_COUNT_CAP = 100_000;
const SEARCH_BUDGET_MS = 2_000;
const CSV_CHUNK = 500;

const memoStore = new Map<string, unknown>();

function filtersOf(url: URL): Filters {
  const p = url.searchParams;
  const agg = (p.get("agg") ?? "avg") as Agg;
  return {
    q: (p.get("q") ?? "").trim(),
    cat: p.get("cat") ?? "",
    sub: p.get("sub") ?? "",
    type: p.get("type") ?? "",
    mode: p.get("mode") ?? "",
    agg: ["avg", "min", "max", "n"].includes(agg) ? agg : "avg",
    full: false,
  };
}

function setup(sourceId: string, url: URL): { ctx: Ctx; spec: Spec } {
  const source = getSource(sourceId);
  if (!source) throw httpError(404, "unknown source");
  const info = openDb(sourceId);
  const prefix = `${sourceId}|${info.mtimeMs}|`;
  const ctx: Ctx = {
    sourceId,
    source,
    info,
    db: info.db,
    f: filtersOf(url),
    has: (t) => info.tables.has(t),
    cols: (t) => info.tables.get(t) ?? [],
    memo: <T>(key: string, fn: () => T): T => {
      const k = prefix + key;
      if (!memoStore.has(k)) memoStore.set(k, fn());
      return memoStore.get(k) as T;
    },
  };
  return { ctx, spec: specFor(ctx) };
}

type Sql = { sql: string; params: (string | number)[]; whereSql: string; from: string; groupTail: string };

function rowidSql(ctx: Ctx, spec: Spec, budget: boolean): Sql {
  const w = spec.where(ctx);
  const clauses = budget ? ["fsv_budget()", ...w.clauses] : w.clauses;
  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const from = `${qi(spec.table)} f`;
  const groupTail = spec.groupBy ? ` GROUP BY ${spec.groupBy}` : "";
  const sel = spec.groupBy ? "MIN(f.rowid) AS r" : "f.rowid AS r";
  return { sql: `SELECT ${sel} FROM ${from} ${whereSql}${groupTail} ORDER BY ${spec.orderBy}`, params: w.params, whereSql, from, groupTail };
}

function isFiltered(f: Filters): boolean {
  return !!(f.q || f.cat || f.sub);
}

export function compositeMeta(sourceId: string, url: URL) {
  const t0 = performance.now();
  const { ctx, spec } = setup(sourceId, url);
  const columns = spec.columns(ctx);
  const cats = spec.categories(ctx);
  const types = spec.types?.(ctx);
  return {
    sourceId,
    columns,
    categories: cats.cats,
    subcategories: cats.subs,
    categoryNote: cats.note ?? null,
    types: types ?? null,
    modes: spec.modes ?? null,
    aggs: spec.aggs ?? null,
    docs: spec.docs(ctx),
    large: !!spec.large,
    ms: Math.round(performance.now() - t0),
  };
}

function nonEmptyKeys(rows: Row[]): string[] {
  const keys = new Set<string>();
  for (const r of rows) for (const [k, v] of Object.entries(r)) if (v !== null && v !== undefined && v !== "") keys.add(k);
  return [...keys];
}

export function compositePage(sourceId: string, url: URL) {
  const t0 = performance.now();
  const { ctx, spec } = setup(sourceId, url);
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page") ?? 1)) || 1);
  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(url.searchParams.get("pageSize") ?? 50)) || 50));
  const offset = (page - 1) * pageSize;
  const budget = !!(ctx.f.q && spec.large);
  const q = rowidSql(ctx, spec, budget);
  const rowids: number[] = [];
  let total = 0;
  let capped = false;
  let tIds = 0;
  const { timedOut } = withBudget(
    budget ? SEARCH_BUDGET_MS : 0,
    () => {
      const stmt = ctx.db.prepare(`${q.sql} LIMIT ? OFFSET ?`);
      for (const r of stmt.iterate(...q.params, pageSize, offset) as Iterable<{ r: number }>) rowids.push(Number(r.r));
      tIds = performance.now();
      if (rowids.length < pageSize && (rowids.length > 0 || page === 1)) {
        total = offset + rowids.length; // the scan reached the end: exact
      } else if (!isFiltered(ctx.f) && spec.unfilteredTotal) {
        total = spec.unfilteredTotal(ctx);
      } else {
        ({ total, capped } = cappedCount(ctx.info, q.from, `${q.whereSql}${q.groupTail}`, q.params, COMPOSITE_COUNT_CAP));
      }
    },
    () => {
      total = offset + rowids.length;
      capped = true;
    },
  );
  if (!tIds) tIds = performance.now();
  const tCount = performance.now();
  const rows = rowids.length ? spec.rows(ctx, rowids) : [];
  const t1 = performance.now();
  return {
    rows,
    nonEmpty: nonEmptyKeys(rows),
    total,
    totalCapped: capped,
    page,
    pageSize,
    timedOut,
    ms: {
      ids: Math.round(tIds - t0),
      count: Math.round(tCount - tIds),
      pivot: Math.round(t1 - tCount),
      total: Math.round(t1 - t0),
    },
  };
}

function csvCell(v: unknown, sep: string): string {
  if (v === null || v === undefined || v === "") return "-";
  const s = typeof v === "number" ? String(v) : String(v);
  if (s.includes(sep) || /["\r\n]/.test(s) || s !== s.trim()) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function safeFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

/**
 * Streams the composite for the current filters (all pages) as CSV: UTF-8 with a BOM (so Excel
 * reads µ, ω, α correctly), CRLF line ends, "-" for missing values. `cols` = comma-separated
 * indexes into the meta column list (default: all columns); `sep=;` for semicolon-separated CSV;
 * `limit` caps the number of rows.
 */
/** Resolves on "drain" or "close" and removes both listeners (events.once would leave the loser attached). */
function drained(res: ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      res.off("drain", done);
      res.off("close", done);
      resolve();
    };
    res.on("drain", done);
    res.on("close", done);
  });
}

export async function compositeCsv(sourceId: string, url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { ctx, spec } = setup(sourceId, url);
  ctx.f.full = true;
  const all = spec.columns(ctx);
  const colsParam = url.searchParams.get("cols");
  let columns = all;
  if (colsParam) {
    const wanted = new Set(colsParam.split(",").map((x) => Number(x)));
    columns = all.filter((_c, i) => wanted.has(i));
    if (!columns.length) columns = all;
  }
  const sep = url.searchParams.get("sep") === ";" ? ";" : ",";
  const limit = Math.floor(Number(url.searchParams.get("limit") ?? 0)) || Infinity;
  const q = rowidSql(ctx, spec, false);
  const stmt = ctx.db.prepare(q.sql);
  const iter = stmt.iterate(...q.params) as IterableIterator<{ r: number }>;

  const parts = [sourceId, "composite", ctx.f.type, ctx.f.mode, ctx.f.cat && `cat-${ctx.f.cat}`, ctx.f.sub && `sub-${ctx.f.sub}`, ctx.f.q && `q-${ctx.f.q}`];
  const filename = `${safeFilename(parts.filter(Boolean).join("_"))}.csv`;
  res.writeHead(200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`,
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  });
  let closed = false;
  res.on("close", () => {
    closed = true;
  });
  req.on("aborted", () => {
    closed = true;
  });
  ctx.info.pins++;
  let written = 0;
  let msIds = 0;
  let msRows = 0;
  let msFormat = 0;
  const started = Date.now();
  try {
    res.write(`\uFEFF${columns.map((c) => csvCell(c.label, sep)).join(sep)}\r\n`);
    let done = false;
    while (!done && !closed && written < limit) {
      const ids: number[] = [];
      let t = performance.now();
      while (ids.length < CSV_CHUNK && written + ids.length < limit) {
        const n = iter.next();
        if (n.done) {
          done = true;
          break;
        }
        ids.push(Number(n.value.r));
      }
      if (!ids.length) break;
      msIds += performance.now() - t;
      t = performance.now();
      const rows = spec.rows(ctx, ids);
      msRows += performance.now() - t;
      t = performance.now();
      written += rows.length;
      let buf = "";
      for (const r of rows) buf += `${columns.map((c) => csvCell(r[c.key], sep)).join(sep)}\r\n`;
      ctx.info.lastUsed = Date.now();
      msFormat += performance.now() - t;
      if (!res.write(buf) && !closed) await drained(res);
      // Let other requests run between chunks.
      await new Promise((r) => setImmediate(r));
    }
    if (!closed) res.end();
  } finally {
    ctx.info.pins--;
    ctx.info.lastUsed = Date.now();
    try {
      iter.return?.();
    } catch {
      /* statement already reset */
    }
    console.log(
      `csv ${sourceId}: ${written} rows in ${Date.now() - started} ms (ids ${Math.round(msIds)}, pivot ${Math.round(msRows)}, format ${Math.round(msFormat)})` +
        `${closed && written < limit ? " (client closed)" : ""}, rss ${Math.round(process.memoryUsage().rss / 1e6)} MB`,
    );
  }
}
