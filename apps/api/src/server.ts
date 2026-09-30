import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getSource, sources, type SourceDef } from "@fsv/shared";
import {
  all,
  cappedCount,
  dataRoot,
  eqParams,
  findCol,

  httpError,
  openDb,
  qi,
  rowCount,
  withBudget,
  type DbInfo,
} from "./db.ts";
import { compositeCsv, compositeMeta, compositePage } from "./composite.ts";
import { relationsFor } from "./relations.ts";

const PORT = Number(process.env.PORT ?? 3001);

/** Above this many rows, the free-text table filter only searches indexed columns. */
const LARGE_TABLE = 500_000;
/** Upper bound for the optional per-request search time budget (`timeout` query param, ms). */
const MAX_TIMEOUT_MS = 30_000;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(
    JSON.stringify(body, (_k, v) =>
      typeof v === "bigint" ? (v >= Number.MIN_SAFE_INTEGER && v <= Number.MAX_SAFE_INTEGER ? Number(v) : v.toString()) : v,
    ),
  );
}

function parseUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
}

function pageParams(url: URL, def: number, max: number): { page: number; pageSize: number } {
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page") ?? 1)) || 1);
  const pageSize = Math.min(max, Math.max(1, Math.floor(Number(url.searchParams.get("pageSize") ?? def)) || def));
  return { page, pageSize };
}

function foodTypes(info: DbInfo, source: SourceDef): string[] | undefined {
  const typeCol = source.foodTypeField && findCol(info.tables.get(source.foodTable), source.foodTypeField);
  if (!typeCol) return undefined;
  if (!info.foodTypes) {
    info.foodTypes = (
      info.db
        .prepare(`SELECT DISTINCT ${qi(typeCol)} AS t FROM ${qi(source.foodTable)} WHERE ${qi(typeCol)} IS NOT NULL ORDER BY 1`)
        .all() as { t: string }[]
    ).map((r) => String(r.t));
  }
  return info.foodTypes;
}

/** Correlated lookups declared in the registry (e.g. category name); skipped if the table is absent. */
function joinSelects(info: DbInfo, source: SourceDef): string[] {
  const out: string[] = [];
  for (const j of source.foodJoins ?? []) {
    const cols = info.tables.get(j.table);
    if (!findCol(cols, j.key) || !findCol(cols, j.value)) continue;
    if (!findCol(info.tables.get(source.foodTable), j.foodField)) continue;
    out.push(
      `(SELECT j.${qi(j.value)} FROM ${qi(j.table)} j WHERE j.${qi(j.key)} = f.${qi(j.foodField)} LIMIT 1) AS ${qi(j.as)}`,
    );
  }
  return out;
}

function listFoods(source: SourceDef, url: URL) {
  const info = openDb(source.id);
  const cols = info.tables.get(source.foodTable);
  if (!cols) throw httpError(500, `foodTable ${source.foodTable} is missing from ${source.dbFile}`);
  const t = qi(source.foodTable);
  const idc = qi(source.foodIdField);
  const nc = qi(source.foodNameField);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const type = url.searchParams.get("type") ?? url.searchParams.get("dataType") ?? source.foodTypeDefault ?? "all";
  const { page, pageSize } = pageParams(url, 40, 100);
  const types = foodTypes(info, source);

  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (types && type && type !== "all") {
    clauses.push(`${qi(source.foodTypeField!)} = ?`);
    params.push(type);
  }
  if (q) {
    clauses.push(`(${nc} LIKE ? OR CAST(${idc} AS TEXT) LIKE ?)`);
    params.push(`%${q}%`, `%${q}%`);
  } else {
    clauses.push(`${nc} > ''`); // rows with a name; also lets SQLite walk the (name, id) index
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  // Phase 1 walks the narrow (name, id) index; phase 2 fetches the page's rows.
  const rowids = (
    info.db.prepare(`SELECT rowid AS r FROM ${t} ${where} ORDER BY ${nc} LIMIT ? OFFSET ?`).all(
      ...params,
      pageSize,
      (page - 1) * pageSize,
    ) as { r: number }[]
  ).map((x) => x.r);
  const { total, capped } = cappedCount(info, t, where, params);

  const listFields = (source.foodListFields ?? []).map((f) => findCol(cols, f)).filter((f): f is string => !!f);
  const selectCols = [source.foodIdField, source.foodNameField, ...(types ? [source.foodTypeField!] : []), ...listFields].filter(
    (c, i, arr) => arr.indexOf(c) === i,
  );
  const joins = joinSelects(info, source);
  let rows: Record<string, unknown>[] = [];
  if (rowids.length) {
    const fetched = all(
      info.db.prepare(
        `SELECT f.rowid AS "__rowid", ${[...selectCols.map((c) => `f.${qi(c)}`), ...joins].join(", ")}
         FROM ${t} f WHERE f.rowid IN (${rowids.map(() => "?").join(", ")})`,
      ),
      ...rowids,
    );
    const byRowid = new Map(fetched.map((r) => [Number(r.__rowid), r]));
    rows = rowids.map((r) => byRowid.get(r)!).filter(Boolean);
    for (const r of rows) delete r.__rowid;
  }
  const columns = [...selectCols, ...(source.foodJoins ?? []).map((j) => j.as).filter((a) => rows[0] ? a in rows[0] : false)];
  return { source, columns, rows, total, totalCapped: capped, page, pageSize, types };
}

function relatedFor(info: DbInfo, source: SourceDef, food: Record<string, unknown>) {
  const out: { table: string; field: string; total: number; columns: string[]; rows: Record<string, unknown>[] }[] = [];
  const done = new Set<string>();
  for (const rel of source.foodRelated ?? []) {
    const value = food[rel.foodField ?? source.foodIdField];
    if (value === null || value === undefined) continue;
    const exclude = new Set([source.foodTable, ...(rel.exclude ?? [])]);
    const targets =
      rel.table === "*"
        ? [...info.tables.keys()].filter((t) => !exclude.has(t) && !t.startsWith("_meta") && findCol(info.tables.get(t), rel.field))
        : info.tables.has(rel.table)
          ? [rel.table]
          : [];
    for (const table of targets) {
      const field = findCol(info.tables.get(table), rel.field)!;
      if (done.has(`${table}\u0000${field}`)) continue;
      done.add(`${table}\u0000${field}`);
      const p = eqParams(String(value));
      const where = `WHERE ${qi(field)} IN (?, ?)`;
      const total = (info.db.prepare(`SELECT COUNT(*) AS n FROM ${qi(table)} ${where}`).get(...p) as { n: number }).n;
      if (total === 0) continue;
      const rows = all(info.db.prepare(`SELECT * FROM ${qi(table)} ${where} LIMIT ?`), ...p, rel.limit ?? 50);
      out.push({ table, field, total, columns: info.tables.get(table)!, rows });
    }
  }
  return out;
}

function foodDetail(source: SourceDef, foodId: string) {
  const info = openDb(source.id);
  const cols = info.tables.get(source.foodTable);
  if (!cols) throw httpError(500, `foodTable ${source.foodTable} is missing from ${source.dbFile}`);
  const joins = joinSelects(info, source);
  const p = eqParams(foodId);
  const matches = all(
    info.db.prepare(
      `SELECT f.*${joins.length ? `, ${joins.join(", ")}` : ""} FROM ${qi(source.foodTable)} f
       WHERE f.${qi(source.foodIdField)} IN (?, ?) LIMIT 21`,
    ),
    ...p,
  );
  if (matches.length === 0) throw httpError(404, "food not found");
  const food = matches[0];

  let nutrients: Record<string, unknown>[] | undefined;
  if (source.usdaNutrients && info.tables.has("food_nutrient") && info.tables.has("nutrient")) {
    const rank = findCol(info.tables.get("nutrient"), "rank");
    const hasNbr = findCol(info.tables.get("nutrient"), "nutrient_nbr");
    // FNDDS survey downloads put the legacy nutrient_nbr (e.g. 203) in food_nutrient.nutrient_id
    // instead of nutrient.id (e.g. 1003), so fall back to matching on nutrient_nbr.
    const n = (col: string) => (hasNbr ? `COALESCE(n.${col}, n2.${col})` : `n.${col}`);
    nutrients = all(
      info.db.prepare(
        `SELECT fn.*, ${n("name")} AS name, ${n("unit_name")} AS unit_name${hasNbr ? `, ${n("nutrient_nbr")} AS nutrient_nbr` : ""}
         ${rank ? `, ${n("rank")} AS nutrient_rank` : ""}
         FROM food_nutrient fn
         LEFT JOIN nutrient n ON n.id = fn.nutrient_id
         ${hasNbr ? "LEFT JOIN nutrient n2 ON n.id IS NULL AND n2.nutrient_nbr = CAST(fn.nutrient_id AS TEXT)" : ""}
         WHERE fn.fdc_id = ?
         ORDER BY ${rank ? "nutrient_rank IS NULL, nutrient_rank, " : ""}name`,
      ),
      p[1],
    );
  }
  return {
    source,
    idField: source.foodIdField,
    nameField: source.foodNameField,
    food,
    otherMatches: matches.length - 1,
    nutrients,
    related: relatedFor(info, source, food),
  };
}

function tablePage(sourceId: string, table: string, url: URL) {
  const info = openDb(sourceId);
  const cols = info.tables.get(table);
  if (!cols) throw httpError(404, "unknown table");
  const ident = qi(table);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const col = url.searchParams.get("col");
  const val = url.searchParams.get("val");
  const { page, pageSize } = pageParams(url, 50, 200);
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (col && val !== null) {
    const c = findCol(cols, col);
    if (!c) throw httpError(400, `unknown column ${col}`);
    clauses.push(`${qi(c)} IN (?, ?)`);
    params.push(...eqParams(val));
  }
  let searchedColumns: string[] | undefined;
  if (q) {
    let searched = cols;
    if (rowCount(info, table) > LARGE_TABLE) {
      const idx = cols.filter((c) => info.indexed.get(table)?.has(c));
      if (idx.length) {
        searched = idx;
        searchedColumns = idx;
      }
    }
    clauses.push(`(${searched.map((c) => `${qi(c)} LIKE ?`).join(" OR ")})`);
    for (const _ of searched) params.push(`%${q}%`);
  }
  const timeoutMs = Math.floor(Number(url.searchParams.get("timeout") ?? 0)) || 0;
  const budgetMs = q && timeoutMs > 0 ? Math.min(timeoutMs, MAX_TIMEOUT_MS) : 0;
  if (budgetMs) clauses.unshift("fsv_budget()"); // first, so it runs for every scanned row
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const offset = (page - 1) * pageSize;
  const rows: Record<string, unknown>[] = [];
  let total = 0;
  let capped = false;
  let timedOut = false;
  ({ timedOut } = withBudget(
    budgetMs,
    () => {
      const stmt = info.db.prepare(`SELECT * FROM ${ident} ${where} LIMIT ? OFFSET ?`);
      stmt.setReadBigInts(true);
      for (const r of stmt.iterate(...params, pageSize, offset)) rows.push(r as Record<string, unknown>);
      if (!clauses.length) {
        total = rowCount(info, table);
      } else if (rows.length < pageSize && (rows.length > 0 || page === 1)) {
        total = offset + rows.length; // the scan already reached the end, so this is exact
      } else {
        ({ total, capped } = cappedCount(info, ident, where, params));
      }
    },
    () => {
      // Out of time: report what was found so far as a lower bound.
      total = offset + rows.length;
      capped = true;
    },
  ));
  return { columns: cols, rows, total, totalCapped: capped, page, pageSize, searchedColumns, timedOut };
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET" });
    res.end();
    return;
  }

  const url = parseUrl(req);
  let parts: string[];
  try {
    parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    json(res, 400, { error: "bad url" });
    return;
  }

  try {
    if (req.method !== "GET") {
      json(res, 405, { error: "method not allowed" });
      return;
    }
    if (url.pathname === "/api/health") {
      json(res, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/sources") {
      json(
        res,
        200,
        sources.map((s) => {
          const loaded = existsSync(resolve(dataRoot, s.dbFile));
          let meta = {};
          if (loaded) {
            try {
              meta = openDb(s.id).meta;
            } catch {
              meta = {};
            }
          }
          return { ...s, loaded, meta };
        }),
      );
      return;
    }

    if (parts[0] === "api" && parts[1] === "sources" && parts[2] && parts[3] === "tables" && !parts[4]) {
      const info = openDb(parts[2]);
      json(res, 200, {
        source: getSource(parts[2]),
        meta: info.meta,
        // Row counts come from `_meta.counts` (written at ingest), so no COUNT(*) on big tables here.
        tables: [...info.tables].map(([name, cols]) => ({ name, rows: rowCount(info, name), columns: cols.length })),
      });
      return;
    }

    if (parts[0] === "api" && parts[1] === "sources" && parts[2] && parts[3] === "tables" && parts[4]) {
      json(res, 200, tablePage(parts[2], parts[4], url));
      return;
    }

    if (parts[0] === "api" && parts[1] === "sources" && parts[2] && parts[3] === "foods" && !parts[4]) {
      const source = getSource(parts[2]);
      if (!source) throw httpError(404, "unknown source");
      json(res, 200, listFoods(source, url));
      return;
    }

    if (parts[0] === "api" && parts[1] === "sources" && parts[2] && parts[3] === "foods" && parts[4]) {
      const source = getSource(parts[2]);
      if (!source) throw httpError(404, "unknown source");
      json(res, 200, foodDetail(source, parts[4]));
      return;
    }

    if (parts[0] === "api" && parts[1] === "sources" && parts[2] && parts[3] === "relations" && !parts[4]) {
      json(res, 200, relationsFor(parts[2], url.searchParams.get("refresh") === "1"));
      return;
    }

    if (parts[0] === "api" && parts[1] === "sources" && parts[2] && parts[3] === "composite" && parts[4] === "meta") {
      json(res, 200, compositeMeta(parts[2], url));
      return;
    }

    if (parts[0] === "api" && parts[1] === "sources" && parts[2] && parts[3] === "composite" && !parts[4]) {
      json(res, 200, compositePage(parts[2], url));
      return;
    }

    if (parts[0] === "api" && parts[1] === "sources" && parts[2] && parts[3] === "composite.csv" && !parts[4]) {
      compositeCsv(parts[2], url, req, res).catch((err) => {
        if (!res.headersSent) {
          json(res, (err as { status?: number }).status ?? 500, { error: err instanceof Error ? err.message : "error" });
        } else {
          console.error("csv export failed:", err);
          res.destroy(err instanceof Error ? err : undefined);
        }
      });
      return;
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    json(res, status, { error: err instanceof Error ? err.message : "error" });
  }
}

createServer(handle).listen(PORT, () => {
  console.log(`api http://127.0.0.1:${PORT}`);
});
