/**
 * The NUTRI maps (data/nutrients/, used as they are, never edited) and the ticket matching rule of the store
 * loader (docs/store-schema.md):
 *  - `nutrient` = nutrient.csv, `nutrient_code` = the by-source maps.
 *  - An amount is matched within its own dataset's family only (Foundation -> usda), on code (+ unit where one
 *    code has several map rows). Expression, nutrient_id and status come from the map row.
 *  - status ignore = not loaded; a code without a map row is skipped and logged. Nothing is invented.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { parse } from "csv-parse/sync";
import { dataRoot } from "../paths.ts";

export const nutrientsDir = join(dataRoot, "nutrients");

/** Maps copied into nutrient_code (only the family of a loaded dataset is used for matching). */
export const MAP_FILES = [
  "usda-foundation-nutrient-codes.csv",
  "wafct-nutrient-codes.csv",
  "frida-nutrient-codes.csv",
  "eurofir-from-frida-nutrient-codes.csv",
];

export type MapRow = {
  family: string;
  code: string;
  code_alt: string | null;
  source_name: string | null;
  source_unit: string | null;
  expression: string;
  nutrient_id: string | null;
  compound_id: string | null;
  status: "nutrient" | "compound" | "ignore";
  notes: string | null;
  source_version: string;
  map_file: string;
};

export type NutrientRow = Record<string, string>;

function readCsv(path: string): Record<string, string>[] {
  return parse(readFileSync(path), { columns: true, bom: true, skip_empty_lines: true }) as Record<string, string>[];
}

const blank = (v: string | undefined | null) => (v === undefined || v === null || v.trim() === "" ? null : v);

/**
 * compound_id when the map says status compound. The maps have no compound catalog id yet, so the id is the
 * ticket itself, namespaced by family (`usda:2052`): no new code, and stable until a Compound catalog exists.
 */
export const compoundIdOf = (family: string, code: string) => `${family}:${code}`;

export function readNutrients(): NutrientRow[] {
  return readCsv(join(nutrientsDir, "nutrient.csv"));
}

export function readMaps(): MapRow[] {
  const out: MapRow[] = [];
  for (const file of MAP_FILES) {
    for (const r of readCsv(join(nutrientsDir, "by-source", file))) {
      const status = r.status as MapRow["status"];
      if (status !== "nutrient" && status !== "compound" && status !== "ignore") {
        throw new Error(`${file}: ${r.family} ${r.code} has status "${r.status}"`);
      }
      out.push({
        family: r.family,
        code: r.code,
        code_alt: blank(r.alt_code),
        source_name: blank(r.source_name),
        source_unit: blank(r.source_unit),
        expression: r.expression ?? "",
        // The CSVs write IGNORE into nutrient_id on ignore rows; the schema keeps the slug only for status nutrient.
        nutrient_id: status === "nutrient" ? blank(r.nutrient_id) : null,
        compound_id: status === "compound" ? compoundIdOf(r.family, r.code) : null,
        status,
        notes: blank(r.notes),
        source_version: r.source_version,
        map_file: file,
      });
    }
  }
  return out;
}

/** Writes the shared tables `nutrient` and `nutrient_code`. */
export function writeSharedTables(db: DatabaseSync, nutrients: NutrientRow[], maps: MapRow[]): void {
  const ncols = Object.keys(nutrients[0] ?? { id: "" });
  if (ncols[0] !== "id") throw new Error(`nutrient.csv: first column is "${ncols[0]}", expected id`);
  db.exec(`CREATE TABLE nutrient (${ncols.map((c) => `"${c}" TEXT${c === "id" ? " PRIMARY KEY" : ""}`).join(", ")})`);
  const insN = db.prepare(`INSERT INTO nutrient VALUES (${ncols.map(() => "?").join(", ")})`);
  for (const n of nutrients) insN.run(...ncols.map((c) => blank(n[c])));

  db.exec(`CREATE TABLE nutrient_code (
    family TEXT NOT NULL, code TEXT NOT NULL, code_alt TEXT, source_unit TEXT, expression TEXT NOT NULL,
    nutrient_id TEXT, compound_id TEXT, status TEXT NOT NULL,
    source_name TEXT, notes TEXT, source_version TEXT NOT NULL, map_file TEXT NOT NULL)`);
  const ins = db.prepare(`INSERT INTO nutrient_code VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const m of maps) {
    ins.run(m.family, m.code, m.code_alt, m.source_unit, m.expression, m.nutrient_id, m.compound_id, m.status, m.source_name, m.notes, m.source_version, m.map_file);
  }
  // LOCKED §6: a ticket is unique on (family, code, unit, expression).
  db.exec(`CREATE UNIQUE INDEX ux_nutrient_code ON nutrient_code (family, code, source_unit, expression, source_version)`);
  db.exec(`CREATE INDEX ix_nutrient_code_family_code ON nutrient_code (family, code, expression)`);
}

/** Unit spelling only, for comparing a published unit with a map's source_unit (G = g, UG = mcg = µg ...). */
export function unitKey(u: string | null | undefined): string {
  if (!u) return "";
  return u
    .trim()
    .toLowerCase()
    .replace(/µ|μ/g, "u")
    .replace(/^mcg/, "ug")
    .replace(/\s*\/\s*100\s*g$/, "");
}

export type Resolved = { ok: true; row: MapRow } | { ok: false; reason: "unmapped" | "ambiguous" };

/** Map rows of one family, by code. */
export class CodeMap {
  private byCode = new Map<string, MapRow[]>();
  readonly family: string;
  readonly sourceVersion: string;
  constructor(maps: MapRow[], family: string, sourceVersion: string) {
    this.family = family;
    this.sourceVersion = sourceVersion;
    for (const m of maps) {
      if (m.family !== family || m.source_version !== sourceVersion) continue;
      const list = this.byCode.get(m.code) ?? [];
      list.push(m);
      this.byCode.set(m.code, list);
    }
    if (!this.byCode.size) throw new Error(`no map rows for family ${family} / ${sourceVersion}`);
  }

  /** The map row for a published code (and unit, when one code has several map rows). */
  resolve(code: string | null | undefined, unit?: string | null): Resolved {
    if (code === null || code === undefined || code === "") return { ok: false, reason: "unmapped" };
    const list = this.byCode.get(code);
    if (!list) return { ok: false, reason: "unmapped" };
    if (list.length === 1) return { ok: true, row: list[0] };
    const byUnit = list.filter((m) => unitKey(m.source_unit) === unitKey(unit));
    return byUnit.length === 1 ? { ok: true, row: byUnit[0] } : { ok: false, reason: "ambiguous" };
  }
}

const MASS: Record<string, number> = { g: 1, mg: 1e-3, ug: 1e-6 };

/**
 * amount_canonical / canonical_unit: into nutrient.unit, only g / mg / µg among themselves and kJ -> kcal
 * (÷ 4.184); kcal stays kcal. Every other unit (IU, RE, α-TE, µmol TE ...) gets no canonical value, and RE is
 * never turned into RAE.
 */
export function canonical(amount: number | null, unit: string | null, nutrientUnit: string | null | undefined): { value: number; unit: string } | null {
  if (amount === null || !unit || !nutrientUnit) return null;
  const from = unitKey(unit);
  const to = unitKey(nutrientUnit);
  if (from in MASS && to in MASS) return { value: Number(((amount * MASS[from]) / MASS[to]).toPrecision(12)), unit: nutrientUnit };
  if (to === "kcal" && from === "kcal") return { value: amount, unit: nutrientUnit };
  if (to === "kcal" && from === "kj") return { value: Number((amount / 4.184).toPrecision(12)), unit: nutrientUnit };
  return null;
}

/* ------------------------------------------------------------------ per-dataset tables */

/** One amount row (docs/store-schema.md "Amount table"); the food id column is named per dataset. */
export type AmountRow = {
  food: number | string;
  code: string;
  code_alt: string | null;
  nutrient_id: string | null;
  compound_id: string | null;
  expression: string;
  amount: number | null;
  amount_unit: string | null;
  basis: string;
  is_empty: 0 | 1;
  amount_canonical: number | null;
  canonical_unit: string | null;
  derivation: string | null;
  method_text: string | null;
  n: number | null;
  min: number | null;
  max: number | null;
  median: number | null;
  footnote: string | null;
  citation_id: string | null;
};

export type Skipped = { dataset: string; family: string; code: string | null; code_alt: string | null; name: string | null; unit: string | null; reason: string; rows: number };
export type Conflict = { dataset: string; key: string; row: AmountRow };

export function createDatasetTables(db: DatabaseSync, prefix: string, idCol: string, idType: "INTEGER" | "TEXT"): void {
  db.exec(`CREATE TABLE ${prefix}_food (
    ${idCol} ${idType} PRIMARY KEY, name TEXT, name_local TEXT, group_code TEXT,
    edible_1 REAL, edible_2 REAL, waste_pct REAL, n_factor REAL)`);
  db.exec(`CREATE TABLE ${prefix}_amount (
    ${idCol} ${idType} NOT NULL, code TEXT NOT NULL, code_alt TEXT, nutrient_id TEXT, compound_id TEXT,
    expression TEXT NOT NULL DEFAULT '', amount REAL, amount_unit TEXT, basis TEXT NOT NULL, is_empty INTEGER NOT NULL,
    amount_canonical REAL, canonical_unit TEXT, derivation TEXT, method_text TEXT,
    n INTEGER, min REAL, max REAL, median REAL, footnote TEXT, citation_id TEXT,
    CHECK ((nutrient_id IS NULL) <> (compound_id IS NULL)),
    CHECK (amount IS NULL OR amount_unit IS NOT NULL),
    CHECK (is_empty IN (0, 1)),
    CHECK ((amount_canonical IS NULL) = (canonical_unit IS NULL)))`);
}

/** Indexes after the bulk insert; the unique key is (food id, code, expression, basis). */
export function indexDatasetTables(db: DatabaseSync, prefix: string, idCol: string): void {
  db.exec(`CREATE UNIQUE INDEX ux_${prefix}_amount_key ON ${prefix}_amount (${idCol}, code, expression, basis)`);
  db.exec(`CREATE INDEX ix_${prefix}_amount_nutrient ON ${prefix}_amount (nutrient_id, expression)`);
  db.exec(`CREATE INDEX ix_${prefix}_amount_compound ON ${prefix}_amount (compound_id)`);
  db.exec(`CREATE INDEX ix_${prefix}_amount_code ON ${prefix}_amount (code, expression)`);
  db.exec(`CREATE INDEX ix_${prefix}_food_name ON ${prefix}_food (name, ${idCol})`);
  db.exec(`CREATE INDEX ix_${prefix}_food_group ON ${prefix}_food (group_code, name, ${idCol})`);
}

/**
 * Writes amount rows in input order. Rows sharing the unique key collapse to one only when amount and derivation
 * both match (an exact duplicate); otherwise every row of that key goes to the conflict log and none is loaded.
 */
export function writeAmounts(
  db: DatabaseSync,
  prefix: string,
  idCol: string,
  dataset: string,
  rows: AmountRow[],
): { inserted: number; collapsed: number; conflicts: Conflict[] } {
  const groups = new Map<string, AmountRow[]>();
  for (const r of rows) {
    const k = [r.food, r.code, r.expression, r.basis].join("\u0000");
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const ins = db.prepare(`INSERT INTO ${prefix}_amount (${idCol}, code, code_alt, nutrient_id, compound_id, expression, amount, amount_unit,
      basis, is_empty, amount_canonical, canonical_unit, derivation, method_text, n, min, max, median, footnote, citation_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let inserted = 0;
  let collapsed = 0;
  const conflicts: Conflict[] = [];
  for (const [k, g] of groups) {
    if (g.length > 1) {
      const same = g.every((r) => r.amount === g[0].amount && r.derivation === g[0].derivation);
      if (!same) {
        for (const row of g) conflicts.push({ dataset, key: k.replaceAll("\u0000", " | "), row });
        continue;
      }
      collapsed += g.length - 1;
    }
    const r = g[0];
    ins.run(
      r.food, r.code, r.code_alt, r.nutrient_id, r.compound_id, r.expression, r.amount, r.amount_unit,
      r.basis, r.is_empty, r.amount_canonical, r.canonical_unit, r.derivation, r.method_text, r.n, r.min, r.max, r.median, r.footnote, r.citation_id,
    );
    inserted++;
  }
  return { inserted, collapsed, conflicts };
}

/** Counts skipped source rows per (code, reason) for data/logs/store-skipped.csv. */
export class SkipLog {
  private m = new Map<string, Skipped>();
  add(s: Omit<Skipped, "rows">): void {
    const k = [s.dataset, s.code, s.code_alt, s.unit, s.reason].join("\u0000");
    const e = this.m.get(k);
    if (e) e.rows++;
    else this.m.set(k, { ...s, rows: 1 });
  }
  list(): Skipped[] {
    return [...this.m.values()].sort((a, b) => a.dataset.localeCompare(b.dataset) || a.reason.localeCompare(b.reason) || b.rows - a.rows || String(a.code_alt).localeCompare(String(b.code_alt)));
  }
}
