/**
 * Per-source definitions for the composite view (see composite.ts for the engine).
 *
 * Common rules (documented in the README and returned in `docs` by /composite/meta):
 *  - Identity columns come first: Major Category | Sub-Category | Base Ingredient | Variant / Preparation |
 *    Notes / Serving Ideas | Food ID | Full name | source-specific extras. Categories are only ever taken
 *    from the source itself; a source without categories shows "-".
 *  - Base / variant split rule (every source): the text before the first comma of the food name is the
 *    base, everything after it is the variant ("Apples, raw, with skin" -> "Apples" + "raw, with skin");
 *    a name without a comma is all base. The full original name is always kept in "Full name".
 *  - Then one column per nutrient/component, "Name (unit)", sorted alphabetically. Values are exactly as
 *    stored (no unit conversion); unit symbols are only prettified (UG/mcg -> µg, MG -> mg, ...).
 *  - Then related 1:N rows summarised in one cell (portions, attributes, counts, references).
 */
import type { DatabaseSync } from "node:sqlite";
import type { SourceDef } from "@fsv/shared";
import { qi, type DbInfo } from "./db.ts";

export type Agg = "avg" | "min" | "max" | "n";
export type Filters = { q: string; cat: string; sub: string; type: string; mode: string; agg: Agg; full: boolean };
export type Value = string | number | null;
export type Row = Record<string, Value>;
export type Column = {
  key: string;
  label: string;
  kind: "identity" | "nutrient" | "related";
  unit?: string | null;
  /** Hidden unless the user picks "all columns" (rarely useful extras). */
  optional?: boolean;
  /** Sticky on the left while scrolling horizontally. */
  pin?: boolean;
  /** Tooltip: source column / id, coverage. */
  title?: string;
  /** Cell links to the existing food page. */
  link?: boolean;
};
export type Option = { value: string; label: string; count?: number | null; parent?: string | null };
export type Docs = { mainFood: string; identity: [string, string][]; values: string; split: string; related: string[]; notes: string[] };

export type Ctx = {
  sourceId: string;
  source: SourceDef;
  info: DbInfo;
  db: DatabaseSync;
  f: Filters;
  has: (table: string) => boolean;
  cols: (table: string) => string[];
  memo: <T>(key: string, fn: () => T) => T;
};

export type Where = { clauses: string[]; params: (string | number)[] };

export type Spec = {
  /** Table paged over (alias `f`). */
  table: string;
  /** ORDER BY (alias `f`). */
  orderBy: string;
  /** One composite row per group (long-format sources). */
  groupBy?: string;
  /** Searches are time-budgeted (and may be partial). */
  large?: boolean;
  types?: (c: Ctx) => { options: Option[]; value: string; label: string };
  modes?: Option[];
  aggs?: Option[];
  categories: (c: Ctx) => { cats: Option[]; subs: Option[]; note?: string };
  where: (c: Ctx) => Where;
  columns: (c: Ctx) => Column[];
  /** Composite rows for these rowids, same order. */
  rows: (c: Ctx, rowids: number[]) => Row[];
  unfilteredTotal?: (c: Ctx) => number;
  docs: (c: Ctx) => Docs;
};

/* ------------------------------------------------------------------ helpers */

export const ph = (n: number) => Array(n).fill("?").join(", ");

export function q<T = Record<string, unknown>>(ctx: Ctx, sql: string, ...params: (string | number | null)[]): T[] {
  return ctx.db.prepare(sql).all(...params) as T[];
}

/** Runs `sql` (containing `IN (__IDS__)`) for `ids` in chunks of 900 bound values. */
export function qIn<T = Record<string, unknown>>(ctx: Ctx, sql: string, ids: (string | number)[], ...extra: (string | number)[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 900) {
    const chunk = ids.slice(i, i + 900);
    out.push(...(ctx.db.prepare(sql.replace("__IDS__", ph(chunk.length))).all(...chunk, ...extra) as T[]));
  }
  return out;
}

/** Rows of `table` for these rowids, in rowid-list order. */
export function byRowids(ctx: Ctx, table: string, rowids: number[], cols = "*"): Record<string, unknown>[] {
  const got = qIn(ctx, `SELECT rowid AS "__r", ${cols} FROM ${qi(table)} WHERE rowid IN (__IDS__)`, rowids);
  const m = new Map(got.map((r) => [Number(r.__r), r]));
  return rowids.map((r) => m.get(r)).filter((r): r is Record<string, unknown> => !!r);
}

export function splitName(name: unknown): { base: string | null; variant: string | null } {
  if (name === null || name === undefined) return { base: null, variant: null };
  const s = String(name).trim();
  const i = s.indexOf(",");
  if (i < 0) return { base: s || null, variant: null };
  return { base: s.slice(0, i).trim() || null, variant: s.slice(i + 1).trim() || null };
}

export const val = (v: unknown): Value => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  const s = String(v);
  return s.trim() === "" ? null : s;
};

export const round = (v: unknown): Value => (typeof v === "number" && !Number.isInteger(v) ? Number(v.toPrecision(6)) : val(v));

export function identityColumns(extras: Column[] = [], link = true): Column[] {
  return [
    { key: "cat", label: "Major Category", kind: "identity", pin: true },
    { key: "sub", label: "Sub-Category", kind: "identity", pin: true },
    { key: "base", label: "Base Ingredient", kind: "identity", pin: true },
    { key: "variant", label: "Variant / Preparation", kind: "identity", pin: true },
    { key: "notes", label: "Notes / Serving Ideas", kind: "identity" },
    { key: "id", label: "Food ID", kind: "identity", link },
    { key: "name", label: "Full name", kind: "identity" },
    ...extras,
  ];
}

export function ident(row: Row, v: { id: unknown; name: unknown; cat?: unknown; sub?: unknown; notes?: unknown }): Row {
  const { base, variant } = splitName(v.name);
  row.id = val(v.id);
  row.name = val(v.name);
  row.base = base;
  row.variant = variant;
  row.cat = val(v.cat);
  row.sub = val(v.sub);
  row.notes = val(v.notes);
  return row;
}

export const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Sort nutrient columns by label and make labels unique. */
export function finishNutrients(cols: Column[]): Column[] {
  cols.sort((a, b) => collator.compare(a.label, b.label) || collator.compare(a.key, b.key));
  const seen = new Map<string, number>();
  for (const c of cols) seen.set(c.label, (seen.get(c.label) ?? 0) + 1);
  for (const c of cols) if ((seen.get(c.label) ?? 0) > 1) c.label = `${c.label} [${c.key.replace(/^[a-z]+:/, "")}]`;
  return cols;
}

const UNIT_SYMBOLS: Record<string, string> = {
  G: "g",
  MG: "mg",
  UG: "µg",
  MCG: "µg",
  KCAL: "kcal",
  KJ: "kJ",
  IU: "IU",
  MG_ATE: "mg ATE",
  MG_GAE: "mg GAE",
  SP_GR: "sp gr",
  PH: "pH",
  UMOL_TE: "µmol TE",
};

/** Unit symbol only (never converts values): UG/mcg -> µg, MG -> mg, ... */
export function unitSymbol(u: unknown): string | null {
  if (u === null || u === undefined) return null;
  const s = String(u).trim();
  if (!s) return null;
  return UNIT_SYMBOLS[s.toUpperCase()] ?? s.replace(/\bmcg\b/g, "µg");
}

export const withUnit = (name: string, unit: string | null) => (unit ? `${name} (${unit})` : name);

export function like(q: string): string {
  return `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
}
export const LIKE = (expr: string) => `${expr} LIKE ? ESCAPE '\\'`;

export const cap1 = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function joinCompact(items: string[], full: boolean, max = 6): string | null {
  if (!items.length) return null;
  if (full || items.length <= max) return items.join("; ");
  return `${items.slice(0, max).join("; ")}; … (+${items.length - max})`;
}

export const fmtNum = (v: unknown) => {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(Number(n.toPrecision(6))) : String(v);
};

export const BASIS_100G = "Values per 100 g (edible portion) as stored in the source; missing = '-'.";
export const SPLIT_DOC =
  "Base Ingredient = text before the first comma of the food name; Variant / Preparation = everything after it (no comma: variant '-'). The unsplit name is kept in 'Full name'.";
