import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { getSource, sources } from "@fsv/shared";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const dataRoot = resolve(repoRoot, "data");
const PORT = Number(process.env.PORT ?? 3001);

const openDbs = new Map<string, Database.Database>();

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

function openDb(sourceId: string): Database.Database {
  const source = getSource(sourceId);
  if (!source) throw Object.assign(new Error("unknown source"), { status: 404 });
  const path = resolve(dataRoot, source.dbFile);
  if (!existsSync(path)) {
    throw Object.assign(
      new Error(`No database yet. Run: npm run ingest -- ${source.id}`),
      { status: 404 },
    );
  }
  let db = openDbs.get(sourceId);
  if (!db) {
    db = new Database(path, { readonly: true, fileMustExist: true });
    openDbs.set(sourceId, db);
  }
  return db;
}

function metaOf(db: Database.Database): Record<string, string> {
  try {
    const rows = db.prepare("SELECT key, value FROM _meta").all() as {
      key: string;
      value: string;
    }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch {
    return {};
  }
}

function parseUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET" });
    res.end();
    return;
  }

  const url = parseUrl(req);
  const parts = url.pathname.split("/").filter(Boolean);

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/sources") {
      json(
        res,
        200,
        sources.map((s) => {
          const path = resolve(dataRoot, s.dbFile);
          const loaded = existsSync(path);
          let meta = {};
          if (loaded) {
            try {
              meta = metaOf(openDb(s.id));
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
      const db = openDb(parts[2]);
      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
        )
        .all() as { name: string }[];
      const withCounts = tables.map((t) => {
        const row = db.prepare(`SELECT COUNT(*) AS n FROM "${t.name.replaceAll('"', '""')}"`).get() as {
          n: number;
        };
        return { name: t.name, rows: row.n };
      });
      json(res, 200, { source: getSource(parts[2]), meta: metaOf(db), tables: withCounts });
      return;
    }

    if (parts[0] === "api" && parts[1] === "sources" && parts[2] && parts[3] === "tables" && parts[4]) {
      const db = openDb(parts[2]);
      const table = parts[4];
      const allowed = (
        db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) as
          | { name: string }
          | undefined
      );
      if (!allowed) throw Object.assign(new Error("unknown table"), { status: 404 });
      const q = url.searchParams.get("q")?.trim() ?? "";
      const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
      const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") ?? 50)));
      const ident = `"${table.replaceAll('"', '""')}"`;
      const cols = (
        db.prepare(`PRAGMA table_info(${ident})`).all() as { name: string }[]
      ).map((c) => c.name);
      let where = "";
      const params: string[] = [];
      if (q) {
        const likes = cols.map((c) => `"${c.replaceAll('"', '""')}" LIKE ?`);
        where = `WHERE ${likes.join(" OR ")}`;
        for (const _ of cols) params.push(`%${q}%`);
      }
      const total = (
        db.prepare(`SELECT COUNT(*) AS n FROM ${ident} ${where}`).get(...params) as { n: number }
      ).n;
      const rows = db
        .prepare(`SELECT * FROM ${ident} ${where} LIMIT ? OFFSET ?`)
        .all(...params, pageSize, (page - 1) * pageSize);
      json(res, 200, { columns: cols, rows, total, page, pageSize });
      return;
    }

    if (parts[0] === "api" && parts[1] === "sources" && parts[2] && parts[3] === "foods" && !parts[4]) {
      const source = getSource(parts[2]);
      if (!source) throw Object.assign(new Error("unknown source"), { status: 404 });
      const db = openDb(parts[2]);
      const q = url.searchParams.get("q")?.trim() ?? "";
      const dataType = url.searchParams.get("dataType") ?? "foundation_food";
      const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
      const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? 40)));
      const clauses: string[] = [];
      const params: string[] = [];
      if (dataType && dataType !== "all") {
        clauses.push("f.data_type = ?");
        params.push(dataType);
      }
      if (q) {
        clauses.push("(f.description LIKE ? OR CAST(f.fdc_id AS TEXT) LIKE ?)");
        params.push(`%${q}%`, `%${q}%`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const total = (
        db.prepare(`SELECT COUNT(*) AS n FROM food f ${where}`).get(...params) as { n: number }
      ).n;
      const rows = db
        .prepare(
          `SELECT f.fdc_id, f.data_type, f.description, f.food_category_id, f.publication_date,
                  c.description AS category
           FROM food f
           LEFT JOIN food_category c ON c.id = f.food_category_id
           ${where}
           ORDER BY f.description
           LIMIT ? OFFSET ?`,
        )
        .all(...params, pageSize, (page - 1) * pageSize);
      json(res, 200, { source, rows, total, page, pageSize });
      return;
    }

    if (parts[0] === "api" && parts[1] === "sources" && parts[2] && parts[3] === "foods" && parts[4]) {
      const source = getSource(parts[2]);
      if (!source) throw Object.assign(new Error("unknown source"), { status: 404 });
      const db = openDb(parts[2]);
      const fdcId = Number(parts[4]);
      const food = db
        .prepare(
          `SELECT f.*, c.description AS category
           FROM food f
           LEFT JOIN food_category c ON c.id = f.food_category_id
           WHERE f.fdc_id = ?`,
        )
        .get(fdcId);
      if (!food) throw Object.assign(new Error("food not found"), { status: 404 });
      const nutrients = db
        .prepare(
          `SELECT fn.id, fn.nutrient_id, n.name, n.unit_name, n.nutrient_nbr,
                  fn.amount, fn.data_points, fn.derivation_id, fn.min, fn.max, fn.median, fn.footnote
           FROM food_nutrient fn
           JOIN nutrient n ON n.id = fn.nutrient_id
           WHERE fn.fdc_id = ?
           ORDER BY n.rank IS NULL, n.rank, n.name`,
        )
        .all(fdcId);
      json(res, 200, { source, food, nutrients });
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
