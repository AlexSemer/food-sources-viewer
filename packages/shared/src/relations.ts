/**
 * Relationship discovery inside ONE source database (never across sources).
 *
 * Candidate joins come from column names:
 *   - same name   : the same key-like column (normalised: lower case, letters/digits only) in two tables,
 *                   e.g. food.fdc_id ~ food_nutrient.fdc_id, joined to the table where it is unique ("hub");
 *   - name pattern: `<x>_id` / `<X>ID` / `<X>` pointing at a table named <x> (food_nutrient.nutrient_id -> nutrient.id,
 *                   Data_Normalised.Source -> Source.SourceID, FoodGroup.ParantFoodGroupID -> FoodGroup.FoodGroupID);
 *   - polymorphic : `source_id` + `source_type` (FooDB): one conditional join per source_type value naming a table;
 *   - declared    : a few joins the names cannot reveal (DECLARED below), e.g. input_food.fdc_of_input_food -> food.fdc_id.
 * Every candidate is then checked on data: a random sample of distinct values of the referencing column is looked
 * up in the referenced column (match rate), a sample of the referenced values is looked up the other way
 * (coverage), and uniqueness of both sides gives the cardinality. Candidates below MIN_MATCH are dropped unless
 * declared. Nothing is written to the source db; callers cache the returned document as JSON.
 */
import type { DatabaseSync } from "node:sqlite";

export const RELATIONS_VERSION = 4;

export type RelationSide = { table: string; column: string; unique: boolean | null; rows: number };

export type RelationEdge = {
  /** Referenced side (the "1" side when one side is unique). */
  a: RelationSide;
  /** Referencing side. */
  b: RelationSide;
  /** a:b, "1" where that side's column is unique. */
  cardinality: "1:1" | "1:N" | "N:1" | "N:M";
  how: "same name" | "name pattern" | "polymorphic" | "declared" | "food index";
  /** SQL condition that applies to b (polymorphic keys, _food_index sheets). */
  condition?: string;
  /** Distinct b values sampled / found in a. */
  sampled: number;
  matched: number;
  matchRate: number;
  /** Share of sampled a values that have at least one b row (null: could not be checked cheaply). */
  coverage: number | null;
  /** Estimated b rows per a value that has any. */
  perParent: number | null;
  multiValued?: boolean;
  note?: string;
};

export type RelationsDoc = {
  version: number;
  sourceId: string;
  mainTable: string;
  mainId: string;
  generatedAt: string;
  loadedAt: string | null;
  ms: number;
  tables: { name: string; rows: number; columns: number }[];
  edges: RelationEdge[];
  notes: string[];
};

export type RelationsOptions = {
  sourceId: string;
  mainTable: string;
  mainId: string;
  /** Column of the sheets that `_food_index.food_id` points at (FAO multi-sheet sources). */
  foodIndexColumn?: string;
  loadedAt?: string | null;
  counts?: Record<string, number>;
};

type Declared = { from: [string, string]; to: [string, string]; note?: string };

/** Joins the column names alone do not reveal. Skipped silently when a table/column is absent. */
const USDA_DECLARED: Declared[] = [
  { from: ["food", "food_category_id"], to: ["food_category", "id"], note: "in the Full download, branded rows hold the branded category text here instead" },
  { from: ["input_food", "fdc_of_input_food"], to: ["food", "fdc_id"], note: "input (sample / SR) food of a food" },
  { from: ["acquisition_samples", "fdc_id_of_sample_food"], to: ["food", "fdc_id"] },
  { from: ["acquisition_samples", "fdc_id_of_acquisition_food"], to: ["food", "fdc_id"] },
  { from: ["sub_sample_food", "fdc_id_of_sample_food"], to: ["food", "fdc_id"] },
  { from: ["food_update_log_entry", "id"], to: ["food", "fdc_id"], note: "log entry id = fdc_id" },
  { from: ["microbe", "foodId"], to: ["food", "fdc_id"] },
  { from: ["food", "food_category_id"], to: ["wweia_food_category", "wweia_food_category"], note: "FNDDS: food_category_id is a WWEIA category" },
  { from: ["survey_fndds_food", "wweia_category_code"], to: ["wweia_food_category", "wweia_food_category"] },
  { from: ["food_nutrient", "nutrient_id"], to: ["nutrient", "nutrient_nbr"], note: "legacy nutrient numbers (FNDDS)" },
  { from: ["fndds_ingredient_nutrient_value", "FDC ID"], to: ["food", "fdc_id"] },
  { from: ["fndds_ingredient_nutrient_value", "Nutrient code"], to: ["nutrient", "nutrient_nbr"] },
  { from: ["food_component", "fdc_id"], to: ["food", "fdc_id"] },
];

const DECLARED: Record<string, Declared[]> = {
  "usda-foundation": USDA_DECLARED,
  "usda-sr-legacy": USDA_DECLARED,
  "usda-fndds": USDA_DECLARED,
  "usda-branded": USDA_DECLARED,
  "usda-full": USDA_DECLARED,
  frida: [{ from: ["Data_Table", "↓FoodID/→ParameterID"], to: ["Food", "FoodID"], note: "wide copy of Data_Normalised" }],
  wafct: [
    { from: ["05_NV_sum_57_per_100g_EP", "BiblioID/Source"], to: ["12_Data_sources_with_BiblioID", "BiblioID"] },
    { from: ["11_2012_vs_2019_names_and_codes", "2019 Code"], to: ["05_NV_sum_57_per_100g_EP", "Code"] },
  ],
  "fao-ufish": [
    { from: ["04_NV_sum_per_100_g_EP", "3-Alpha"], to: ["02_Overview_Species", "3-ALPHA"] },
    { from: ["04_NV_sum_per_100_g_EP", "RefID"], to: ["12_Bibliography", "RefID"] },
  ],
  "fao-supplement": [
    { from: ["Sports_products", "Barcode"], to: ["Main_extract", "Barcode"], note: "separate product list" },
    { from: ["Main_extract", "Component Code"], to: ["Component_reference_sheet", "COMPONENT ID"] },
    { from: ["Main_extract", "Component ID"], to: ["Component_reference_sheet", "Component code"] },
  ],
  "fao-density": [{ from: ["Density_DB", "BiblioID"], to: ["BiblioID_Bibliography", "BiblioID"] }],
};

/** Referencing values sampled per candidate. */
const SAMPLE = 1000;
/** Tables up to this size are read fully into a Set instead of probing an index. */
const SET_MAX_ROWS = 300_000;
const MIN_MATCH = 0.5;
/** Internal helper tables of this viewer that are not part of the source. */
const SKIP_TABLES = new Set(["_meta", "_columns", "_sheets", "_notes", "_compound_rank", "_composite_nutrients"]);

const qi = (name: string) => `"${name.replaceAll('"', '""')}"`;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
/** Audit columns (who edited a row) look like keys but join nothing interesting. */
const AUDIT = new Set(["creatorid", "updaterid", "compilerid"]);
const keyLike = (n: string) => /(id|code|nbr|number|barcode|gtin|upc|tagname)$/.test(n) && n !== "id" && !AUDIT.has(n);

type Val = string;
const valOf = (v: unknown): Val | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  const s = String(v).trim();
  return s === "" || s === "NULL" ? null : s;
};
const bindVariants = (v: Val): [string, string | number] => [v, /^-?\d+(\.\d+)?$/.test(v) && v.length < 16 && !/^0\d/.test(v) ? Number(v) : v];

class Probe {
  private sets = new Map<string, { set: Set<Val>; nonNull: number } | null>();
  private uniq = new Map<string, boolean | null>();
  private maxRowid = new Map<string, number>();
  private db: DatabaseSync;
  private rowsOf: (t: string) => number;
  private indexed: (t: string, c: string) => { indexed: boolean; unique: boolean };
  constructor(
    db: DatabaseSync,
    rowsOf: (t: string) => number,
    indexed: (t: string, c: string) => { indexed: boolean; unique: boolean },
  ) {
    this.db = db;
    this.rowsOf = rowsOf;
    this.indexed = indexed;
  }

  /** All values of a small table's column. */
  valueSet(table: string, col: string): { set: Set<Val>; nonNull: number } | null {
    const k = `${table}\u0000${col}`;
    if (this.sets.has(k)) return this.sets.get(k)!;
    let out: { set: Set<Val>; nonNull: number } | null = null;
    if (this.rowsOf(table) <= SET_MAX_ROWS) {
      const set = new Set<Val>();
      let nonNull = 0;
      const st = this.db.prepare(`SELECT ${qi(col)} AS v FROM ${qi(table)}`);
      for (const r of st.iterate() as Iterable<{ v: unknown }>) {
        const v = valOf(r.v);
        if (v === null) continue;
        nonNull++;
        set.add(v);
      }
      out = { set, nonNull };
    }
    this.sets.set(k, out);
    return out;
  }

  /** Does `table.col` contain value v? null = cannot tell cheaply. */
  has(table: string, col: string, v: Val): boolean | null {
    const s = this.valueSet(table, col);
    if (s) return s.set.has(v);
    if (!this.indexed(table, col).indexed) return null;
    const st = this.db.prepare(`SELECT 1 AS x FROM ${qi(table)} WHERE ${qi(col)} IN (?, ?) LIMIT 1`);
    return st.get(...bindVariants(v)) !== undefined;
  }

  countOf(table: string, col: string, v: Val): number | null {
    if (!this.indexed(table, col).indexed && this.rowsOf(table) > SET_MAX_ROWS) return null;
    const st = this.db.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${qi(table)} WHERE ${qi(col)} IN (?, ?) LIMIT 1000)`);
    return Number((st.get(...bindVariants(v)) as { n: number }).n);
  }

  /** Near-unique key columns: number of duplicated values. */
  dups = new Map<string, number>();

  dupsOf(table: string, col: string): number {
    this.unique(table, col);
    return this.dups.get(`${table}\u0000${col}`) ?? 0;
  }

  unique(table: string, col: string): boolean | null {
    const k = `${table}\u0000${col}`;
    if (this.uniq.has(k)) return this.uniq.get(k)!;
    let u: boolean | null = null;
    const s = this.valueSet(table, col);
    if (s) {
      // A key column with a handful of duplicated values (e.g. one parameter listed twice) is still the
      // referenced "1" side; the duplicates are reported in the edge note.
      const dups = s.nonNull - s.set.size;
      u = s.nonNull > 0 && dups <= Math.max(2, Math.floor(s.nonNull * 0.005));
      if (u && dups > 0) this.dups.set(k, dups);
    } else {
      const ix = this.indexed(table, col);
      if (ix.unique) u = true;
      else if (ix.indexed) {
        u = true;
        for (const v of this.sample(table, col, 200).values) {
          if ((this.countOf(table, col, v) ?? 0) > 1) {
            u = false;
            break;
          }
        }
      }
    }
    this.uniq.set(k, u);
    return u;
  }

  /** Random sample of distinct non-null values (whole column when the table is small). */
  sample(table: string, col: string, n: number, condition?: { sql: string; params: string[] }): { values: Val[]; multi: boolean } {
    const rows = this.rowsOf(table);
    const cond = condition ? ` AND (${condition.sql})` : "";
    const params = condition?.params ?? [];
    const raw: unknown[] = [];
    if (rows <= 20_000 || condition) {
      const limit = rows <= 20_000 ? -1 : n * 5;
      const st = this.db.prepare(`SELECT DISTINCT ${qi(col)} AS v FROM ${qi(table)} WHERE ${qi(col)} IS NOT NULL${cond} LIMIT ${limit}`);
      for (const r of st.all(...params) as { v: unknown }[]) raw.push(r.v);
    } else {
      let max = this.maxRowid.get(table);
      if (max === undefined) {
        max = Number((this.db.prepare(`SELECT MAX(rowid) AS m FROM ${qi(table)}`).get() as { m: number }).m ?? 0);
        this.maxRowid.set(table, max);
      }
      const picks = new Set<number>();
      while (picks.size < Math.min(n * 2, rows)) picks.add(1 + Math.floor(Math.random() * max));
      const ids = [...picks];
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const st = this.db.prepare(`SELECT ${qi(col)} AS v FROM ${qi(table)} WHERE rowid IN (${chunk.map(() => "?").join(",")})`);
        for (const r of st.all(...chunk) as { v: unknown }[]) raw.push(r.v);
      }
    }
    let vals = raw.map(valOf).filter((v): v is Val => v !== null);
    const withSep = vals.filter((v) => /[,;]\s*\S/.test(v)).length;
    const multi = vals.length > 0 && withSep / vals.length > 0.3;
    if (multi) vals = vals.flatMap((v) => v.split(/[,;]/).map((s) => s.trim()).filter(Boolean));
    const distinct = [...new Set(vals)];
    // Shuffle, then cap.
    for (let i = distinct.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [distinct[i], distinct[j]] = [distinct[j], distinct[i]];
    }
    return { values: distinct.slice(0, n), multi };
  }
}

type Candidate = {
  a: [string, string];
  b: [string, string];
  how: RelationEdge["how"];
  condition?: { sql: string; params: string[]; text: string };
  note?: string;
};

export function discoverRelations(db: DatabaseSync, opts: RelationsOptions): RelationsDoc {
  const t0 = Date.now();
  const notes: string[] = [];
  const names = (
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[]
  )
    .map((r) => r.name)
    .filter((t) => !SKIP_TABLES.has(t));
  const cols = new Map<string, string[]>();
  const idx = new Map<string, Map<string, boolean>>(); // table -> leading column -> unique
  for (const t of names) {
    cols.set(t, (db.prepare(`PRAGMA table_info(${qi(t)})`).all() as { name: string }[]).map((c) => c.name));
    const m = new Map<string, boolean>();
    for (const ix of db.prepare(`PRAGMA index_list(${qi(t)})`).all() as { name: string; unique: number }[]) {
      const info = db.prepare(`PRAGMA index_info(${qi(ix.name)})`).all() as { seqno: number; name: string }[];
      const first = info.find((c) => c.seqno === 0);
      if (first?.name) m.set(first.name, (m.get(first.name) ?? false) || (ix.unique === 1 && info.length === 1));
    }
    idx.set(t, m);
  }
  const counts = { ...(opts.counts ?? {}) };
  const rowsOf = (t: string) => {
    if (counts[t] === undefined) counts[t] = Number((db.prepare(`SELECT COUNT(*) AS n FROM ${qi(t)}`).get() as { n: number }).n);
    return counts[t];
  };
  const probe = new Probe(db, rowsOf, (t, c) => ({ indexed: idx.get(t)?.has(c) ?? false, unique: idx.get(t)?.get(c) ?? false }));
  const colOf = (t: string, c: string) => cols.get(t)?.find((x) => x === c) ?? cols.get(t)?.find((x) => x.toLowerCase() === c.toLowerCase());

  const cands: Candidate[] = [];
  const seen = new Set<string>();
  const declaredFrom = new Set<string>();
  const add = (c: Candidate) => {
    if (c.how !== "declared" && declaredFrom.has(c.b.join("."))) return;
    const k = [c.a.join("."), c.b.join("."), c.condition?.text ?? ""].join("|");
    const k2 = [c.b.join("."), c.a.join("."), c.condition?.text ?? ""].join("|");
    if (seen.has(k) || seen.has(k2)) return;
    if (c.a[0] === c.b[0] && c.a[1] === c.b[1]) return;
    seen.add(k);
    cands.push(c);
  };

  // Declared joins first (their notes win over the automatic ones).
  for (const d of DECLARED[opts.sourceId] ?? []) {
    const fc = colOf(d.from[0], d.from[1]);
    const tc = colOf(d.to[0], d.to[1]);
    if (!fc || !tc) continue;
    add({ a: [d.to[0], tc], b: [d.from[0], fc], how: "declared", note: d.note });
    // FNDDS-style legacy numbers are declared as an alternative, so keep the automatic nutrient.id join too.
    if (!(d.to[0] === "nutrient" && d.to[1] === "nutrient_nbr")) declaredFrom.add(`${d.from[0]}.${fc}`);
  }

  // FAO multi-sheet: _food_index rows point at one sheet each (table_name + _row).
  if (opts.foodIndexColumn && cols.has("_food_index")) {
    const sheets = (db.prepare(`SELECT DISTINCT table_name AS t FROM _food_index`).all() as { t: string }[]).map((r) => r.t);
    for (const s of sheets) {
      const c = colOf(s, opts.foodIndexColumn);
      if (!c) continue;
      add({
        a: [s, c],
        b: ["_food_index", "food_id"],
        how: "food index",
        condition: { sql: "table_name = ?", params: [s], text: `table_name = '${s}'` },
      });
    }
  }

  // Polymorphic source_id + source_type (FooDB).
  for (const t of names) {
    const sid = colOf(t, "source_id");
    const stype = colOf(t, "source_type");
    if (!sid || !stype) continue;
    const types = (db.prepare(`SELECT DISTINCT ${qi(stype)} AS v FROM ${qi(t)} WHERE ${qi(stype)} IS NOT NULL LIMIT 20`).all() as { v: string }[]).map((r) => String(r.v));
    for (const ty of types) {
      const target = names.find((n) => n.toLowerCase() === ty.toLowerCase());
      const tid = target && colOf(target, "id");
      if (!target || !tid) {
        notes.push(`${t}.source_id with source_type = '${ty}' has no table named ${ty}`);
        continue;
      }
      add({
        a: [target, tid],
        b: [t, sid],
        how: "polymorphic",
        condition: { sql: `${qi(stype)} = ?`, params: [ty], text: `${stype} = '${ty}'` },
      });
    }
  }

  // Name pattern: <x>_id -> table <x>.
  for (const t of names) {
    for (const c of cols.get(t)!) {
      const n = norm(c);
      if (n === "id" || AUDIT.has(n) || (t === opts.mainTable && c === opts.mainId)) continue;
      if (n === "parentid") {
        // Tree tables (OntologyTerm.parent_id): the parent is a row of the same table.
        const own = colOf(t, "id");
        if (own) add({ a: [t, own], b: [t, c], how: "name pattern", note: "self reference (tree)" });
        continue;
      }
      if (colOf(t, "source_type") && n === "sourceid") continue; // handled as polymorphic
      const stem = n.endsWith("id") && n.length > 2 ? n.slice(0, -2) : n;
      for (const u of names) {
        const tn = norm(u);
        const match =
          (n.endsWith("id") && (tn === stem || tn === `${stem}s` || tn.replace(/s$/, "") === stem || (stem.length >= 5 && tn.endsWith(stem)) || (tn.length >= 4 && stem.endsWith(tn)))) ||
          (!n.endsWith("id") && n === tn);
        if (!match) continue;
        const uc = cols.get(u)!;
        // Only the referenced table's own key: its `id`, or `<table>ID` (FoodGroup.FoodGroupID, Source.SourceID).
        const target = (u !== t ? uc.find((x) => x === "id") : undefined) ?? uc.find((x) => norm(x) === `${tn}id` && (u !== t || x !== c));
        if (!target || (u === t && target === c)) continue;
        add({ a: [u, target], b: [t, c], how: "name pattern" });
      }
    }
  }

  // Same key-like column name in several tables: join each to the table where it is unique.
  const groups = new Map<string, [string, string][]>();
  for (const t of names) {
    for (const c of cols.get(t)!) {
      const n = norm(c);
      if (!keyLike(n)) continue;
      if (!groups.has(n)) groups.set(n, []);
      groups.get(n)!.push([t, c]);
    }
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const main = members.find(([t]) => t === opts.mainTable);
    const hub = main;
    if (hub) {
      for (const m of members) if (m !== hub) add({ a: hub, b: m, how: "same name" });
      continue;
    }
    // No main-table hub: try every table where the column is unique (sheets of one workbook share ids only
    // partly, e.g. a fish sheet and its fatty-acid companion); verification drops the pairs that do not match.
    // A 1-row sheet is trivially "unique"; it is not a meaningful hub.
    const uniques = members.filter(([t, c]) => rowsOf(t) >= 5 && probe.unique(t, c) === true);
    const small = members.every(([t]) => rowsOf(t) <= SET_MAX_ROWS);
    const targets = small ? uniques : uniques.sort((x, y) => rowsOf(y[0]) - rowsOf(x[0])).slice(0, 1);
    if (targets.length === 0 && main) targets.push(main);
    for (const m of members) for (const h of targets) if (m !== h) add({ a: h, b: m, how: "same name" });
  }

  // Verify on data.
  const edges: RelationEdge[] = [];
  for (const c of cands) {
    try {
      const e = verify(probe, rowsOf, c);
      if (!e) {
        if (c.how === "declared") notes.push(`${c.b.join(".")}: declared join to ${c.a.join(".")} but the column is empty`);
        continue;
      }
      if (e.sampled < 3 && c.how === "same name") continue;
      if (c.how === "declared" && e.matchRate < 0.05) {
        notes.push(`declared ${e.b.table}.${e.b.column} -> ${e.a.table}.${e.a.column}: ${(e.matchRate * 100).toFixed(0)}% of sampled values match${c.note ? ` (${c.note})` : ""}`);
        continue;
      }
      if (e.matchRate < MIN_MATCH && c.how !== "declared" && c.how !== "food index") {
        if (e.matchRate >= 0.05)
          notes.push(`weak: ${e.b.table}.${e.b.column} -> ${e.a.table}.${e.a.column} only ${(e.matchRate * 100).toFixed(0)}% of sampled values match (dropped)`);
        continue;
      }
      edges.push(e);
    } catch (err) {
      notes.push(`${c.b.join(".")} -> ${c.a.join(".")}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Same (a, b) pair found twice in opposite directions: keep the better one.
  edges.sort((x, y) => y.matchRate - x.matchRate);
  const kept: RelationEdge[] = [];
  const pairKey = (e: RelationEdge) =>
    [`${e.a.table}.${e.a.column}`, `${e.b.table}.${e.b.column}`].sort().join("|") + (e.condition ?? "");
  const keys = new Set<string>();
  const strongB = new Set(edges.filter((e) => e.matchRate >= MIN_MATCH).map((e) => `${e.b.table}.${e.b.column}`));
  for (const e of edges) {
    const k = pairKey(e);
    if (keys.has(k)) continue;
    // A declared alternative that does not match, while another join for the same column does: drop it.
    if (e.matchRate === 0 && strongB.has(`${e.b.table}.${e.b.column}`)) continue;
    keys.add(k);
    kept.push(e);
  }
  // Two referencing columns that share a name and both point at the same lookup (Food.FoodGroupID and
  // Data_Table.FoodGroupID -> FoodGroup.FoodGroupID) are siblings, not a join of their own.
  const parentsOf = new Map<string, Set<string>>();
  for (const e of kept)
    if (e.a.unique) {
      const k = `${e.b.table}.${e.b.column}`;
      if (!parentsOf.has(k)) parentsOf.set(k, new Set());
      parentsOf.get(k)!.add(`${e.a.table}.${e.a.column}`);
    }
  const siblings = (e: RelationEdge) => {
    if (e.cardinality !== "N:M" || e.how !== "same name") return false;
    const pa = parentsOf.get(`${e.a.table}.${e.a.column}`);
    const pb = parentsOf.get(`${e.b.table}.${e.b.column}`);
    return !!pa && !!pb && [...pa].some((x) => pb.has(x));
  };
  for (let i = kept.length - 1; i >= 0; i--) if (siblings(kept[i])) kept.splice(i, 1);
  const linked = new Set(kept.flatMap((e) => [e.a.table, e.b.table]));
  for (const t of names) if (!linked.has(t) && names.length > 1) notes.push(`${t}: no join found`);
  return {
    version: RELATIONS_VERSION,
    sourceId: opts.sourceId,
    mainTable: opts.mainTable,
    mainId: opts.mainId,
    generatedAt: new Date().toISOString(),
    loadedAt: opts.loadedAt ?? null,
    ms: Date.now() - t0,
    tables: names.map((n) => ({ name: n, rows: rowsOf(n), columns: cols.get(n)!.length })),
    edges: kept.sort((x, y) => x.a.table.localeCompare(y.a.table) || x.b.table.localeCompare(y.b.table)),
    notes,
  };
}

function verify(probe: Probe, rowsOf: (t: string) => number, c: Candidate): RelationEdge | null {
  let [aT, aC] = c.a;
  let [bT, bC] = c.b;
  let cond = c.condition;
  const bs = probe.sample(bT, bC, SAMPLE, cond);
  if (bs.values.length === 0) return null;
  let matched = 0;
  let checked = 0;
  for (const v of bs.values) {
    const h = probe.has(aT, aC, v);
    if (h === null) break;
    checked++;
    if (h) matched++;
  }
  if (checked === 0) {
    return {
      a: { table: aT, column: aC, unique: probe.unique(aT, aC), rows: rowsOf(aT) },
      b: { table: bT, column: bC, unique: null, rows: rowsOf(bT) },
      cardinality: "N:M",
      how: c.how,
      condition: cond?.text,
      sampled: bs.values.length,
      matched: 0,
      matchRate: 0,
      coverage: null,
      perParent: null,
      note: `${aT}.${aC} is large and not indexed: not verified`,
    };
  }
  const aUnique = probe.unique(aT, aC);
  // _food_index has exactly one row per sheet row by construction.
  const bUnique = c.how === "food index" ? true : cond || bs.multi ? false : probe.unique(bT, bC);

  // Coverage: how many a values have any b row.
  let coverage: number | null = null;
  let covHit = 0;
  let covN = 0;
  if (!cond && !bs.multi) {
    const as = probe.sample(aT, aC, 300);
    for (const v of as.values) {
      const h = probe.has(bT, bC, v);
      if (h === null) break;
      covN++;
      if (h) covHit++;
    }
    coverage = covN ? covHit / covN : null;
  }
  let perParent: number | null = null;
  if (coverage !== null && coverage > 0 && aUnique) perParent = rowsOf(bT) / Math.max(1, rowsOf(aT) * coverage);

  let note = c.note;
  for (const [t, col] of [
    [aT, aC],
    [bT, bC],
  ]) {
    const d = probe.dupsOf(t, col);
    if (d) note = [note, `${t}.${col} is unique except ${d} duplicated value${d > 1 ? "s" : ""}`].filter(Boolean).join("; ");
  }
  if (bs.multi) note = [note, "multi-valued (comma/semicolon separated); tokens matched"].filter(Boolean).join("; ");
  // Put the unique side first.
  let aSide: RelationSide = { table: aT, column: aC, unique: aUnique, rows: rowsOf(aT) };
  let bSide: RelationSide = { table: bT, column: bC, unique: bUnique, rows: rowsOf(bT) };
  let rate = matched / checked;
  let sampled = checked;
  if (aUnique === false && bUnique === true && !cond && covN > 0) {
    [aSide, bSide] = [bSide, aSide];
    [aT, aC, bT, bC] = [bT, bC, aT, aC];
    // match rate now reads "a values found in b"; coverage is the other direction
    const cov = coverage;
    coverage = rate;
    rate = cov ?? rate;
    [matched, sampled] = [covHit, covN];
    perParent = null;
    cond = undefined;
  }
  const card = (aSide.unique ? "1" : "N") + ":" + (bSide.unique ? "1" : aSide.unique ? "N" : "M");
  return {
    a: aSide,
    b: bSide,
    cardinality: card as RelationEdge["cardinality"],
    how: c.how,
    condition: cond?.text ?? c.condition?.text,
    sampled,
    matched,
    matchRate: rate,
    coverage,
    perParent: perParent !== null ? Math.round(perParent * 10) / 10 : null,
    multiValued: bs.multi || undefined,
    note,
  };
}
