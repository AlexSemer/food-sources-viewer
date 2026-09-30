/**
 * Composite definitions for sources that are already wide (one row per food, one column per component):
 * the FAO/INFOODS and WAFCT spreadsheets, and Open Food Facts; plus the long-format FAO supplement sheet.
 */
import { eqParams, qi, rowCount } from "./db.ts";
import {
  BASIS_100G,
  byRowids,
  cap1,
  collator,
  finishNutrients,
  fmtNum,
  ident,
  identityColumns,
  joinCompact,
  like,
  LIKE,
  q,
  qIn,
  SPLIT_DOC,
  unitSymbol,
  val,
  withUnit,
  type Column,
  type Ctx,
  type Option,
  type Row,
  type Spec,
} from "./composite-specs.ts";

/* ------------------------------------------------------------------ sheet helpers */

/** Last "bibliography / revision" column of a sheet; the component columns follow it. */
const BOUNDARY = /^(latest (revision|version)|latest version of revision|compiler( id)?$|biblioid$|refid$|source\/biblioid|biblioid\/source|comments on why some data)/i;
/** INFOODS-style header: TAG(unit) rest, e.g. "CA(mg)", "ENERC(kJ) (original)", "FIBTS(g) Southgate". */
const TAG = /^([A-Za-z][A-Za-z0-9_\-]*)\s*(?:\(([^)]*)\))?\s*(.*)$/;

export function splitSheetColumns(cols: string[]): { identity: string[]; nutrients: string[] } {
  let b = -1;
  cols.forEach((c, i) => {
    if (BOUNDARY.test(c.trim())) b = i;
  });
  if (b < 0) return { identity: cols.filter((c) => c !== "_row"), nutrients: [] };
  return {
    identity: cols.slice(0, b + 1).filter((c) => c !== "_row"),
    nutrients: cols.slice(b + 1).filter((c) => c !== "_row" && !/^col_[A-Z]+$/.test(c)),
  };
}

type Component = { name: string; unit: string | null; denominator: string | null };

/** INFOODS tag -> component name / unit from the source's Components sheet. */
function componentsMap(ctx: Ctx): Map<string, Component> {
  return ctx.memo("components", () => {
    const m = new Map<string, Component>();
    const t = [...ctx.info.tables.keys()].find((n) => /^(\d+_)?components(_|$)/i.test(n) && !/refdataset/i.test(n));
    if (!t) return m;
    const cols = ctx.cols(t);
    const tagCol = cols.find((c) => /tagname|component id/i.test(c));
    const nameCol = cols.find((c) => /^component name$/i.test(c)) ?? cols.find((c) => /^component( in english)?$/i.test(c));
    const unitCol = cols.find((c) => /^unit$/i.test(c));
    const denCol = cols.find((c) => /^denominator$/i.test(c));
    if (!tagCol || !nameCol) return m;
    for (const r of q(ctx, `SELECT * FROM ${qi(t)}`)) {
      const tag = r[tagCol] ? String(r[tagCol]).trim().toUpperCase() : "";
      if (!tag || !r[nameCol] || m.has(tag)) continue;
      m.set(tag, {
        name: String(r[nameCol]).trim(),
        unit: unitCol && r[unitCol] ? String(r[unitCol]).trim() : null,
        denominator: denCol && r[denCol] ? String(r[denCol]).trim() : null,
      });
    }
    return m;
  });
}

/** "CA(mg)" -> "Calcium [CA] (mg)" via the Components sheet; descriptive headers ("Calcium (mg)") stay as they are. */
function sheetNutrientLabel(ctx: Ctx, col: string): { label: string; unit: string | null; title: string } {
  const m = col.match(TAG);
  const comps = componentsMap(ctx);
  if (m && comps.size && m[1] === m[1].toUpperCase()) {
    const tag = m[1].toUpperCase();
    const comp = comps.get(tag) ?? comps.get(tag.replace(/-$/, ""));
    if (comp) {
      const unit = unitSymbol(m[2] ?? comp.unit);
      const rest = m[3] ? ` ${m[3].replace(/^\/\s*/, "– ")}` : "";
      return {
        label: `${cap1(comp.name)} [${m[1]}]${unit ? ` (${unit})` : ""}${rest}`,
        unit,
        title: `${col}${comp.denominator ? ` · per ${comp.denominator.replace(/^\//, "")}` : ""}`,
      };
    }
  }
  const um = col.match(/\(([^)]*)\)\s*$/);
  return { label: col.replace(/\bmcg\b/g, "µg"), unit: um ? unitSymbol(um[1]) : null, title: col };
}

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const NOTES_COL = /^comments on data processing\/methods$|^comments?$|^notes?$/i;

/* ------------------------------------------------------------------ FAO sheets behind _food_index */

/** AnFooD, BioFoodComp, PhyFoodComp: several per-food-group sheets indexed by `_food_index`. */
export function faoIndexSpec(ctx: Ctx): Spec {
  const sheets = ctx.memo("sheets", () =>
    q<{ sheet: string; t: string; n: number }>(ctx, `SELECT sheet, table_name AS t, COUNT(*) AS n FROM _food_index GROUP BY sheet, table_name ORDER BY MIN(rowid)`),
  );
  const tables = [...new Set(sheets.map((s) => s.t))];
  const layout = ctx.memo("layout", () => {
    const perTable = new Map<string, { identity: string[]; nutrients: string[] }>();
    for (const t of tables) perTable.set(t, splitSheetColumns(ctx.cols(t)));
    const fa = new Map<string, { table: string; idCol: string; nutrients: string[] }>();
    for (const t of tables) {
      const c = [...ctx.info.tables.keys()].find((n) => n.toLowerCase() === `${t.toLowerCase()}_fatty_acids`);
      if (!c) continue;
      const idCol = ctx.cols(c).find((x) => /^food item id$/i.test(x));
      if (idCol) fa.set(t, { table: c, idCol, nutrients: splitSheetColumns(ctx.cols(c)).nutrients });
    }
    return { perTable, fa };
  });
  const SKIP = /^(food item id|food ?name in english|subgroup|food group)$/i;
  const extras = ctx.memo("extras", () => {
    const m = new Map<string, Column>();
    for (const l of layout.perTable.values())
      for (const c of l.identity) {
        if (SKIP.test(c) || NOTES_COL.test(c)) continue;
        const k = `x:${normKey(c)}`;
        const prev = m.get(k);
        if (prev) {
          if (!prev.title!.split(" | ").includes(c)) prev.title += ` | ${c}`;
          continue;
        }
        m.set(k, {
          key: k,
          label: c,
          kind: "identity",
          title: c,
          optional: /^(compiler|latest|old code|missing facet|exact match|matching comments|comments on why)/i.test(c),
        });
      }
    return [...m.values()];
  });
  // PhyFoodComp: the Food_groups sheet maps group / subgroup codes to names.
  const groupNames = ctx.memo("groupNames", () => {
    const s = new Map<string, string>();
    if (!ctx.has("Food_groups") || !ctx.cols("Food_groups").includes("Code of food subgroup")) return s;
    let cur = "";
    for (const r of q(ctx, `SELECT * FROM "Food_groups" ORDER BY _row`)) {
      if (r["Code of food group"]) cur = String(r["Code of food group"]).trim();
      if (r["Code of food subgroup"]) s.set(`${cur}|${String(r["Code of food subgroup"]).trim()}`, String(r["Name of food groups and subgroups (2)"] ?? "").trim());
    }
    return s;
  });
  const sheetLabel = (sheet: string) => sheet.replace(/^\d+\s*/, "").trim() || sheet;
  const subLabel = (fg: unknown, sg: unknown) => {
    if (sg === null || sg === undefined || sg === "") return null;
    if (fg !== undefined && fg !== null) return groupNames.get(`${String(fg).trim()}|${String(sg).trim()}`) ?? String(sg);
    return String(sg);
  };
  const nutrientCols = () =>
    ctx.memo("ncols", () => {
      const cols = new Map<string, Column>();
      for (const l of layout.perTable.values())
        for (const c of l.nutrients) {
          const k = `c:${c}`;
          if (cols.has(k)) continue;
          const lab = sheetNutrientLabel(ctx, c);
          cols.set(k, { key: k, label: lab.label, kind: "nutrient", unit: lab.unit, title: lab.title });
        }
      for (const fa of layout.fa.values())
        for (const c of fa.nutrients) {
          const k = `fa:${c}`;
          if (cols.has(k)) continue;
          const lab = sheetNutrientLabel(ctx, c);
          cols.set(k, { key: k, label: `${lab.label} · FA sheet`, kind: "nutrient", unit: lab.unit, title: `${fa.table}: ${lab.title}` });
        }
      return finishNutrients([...cols.values()]);
    });
  const subList = () =>
    ctx.memo("subs", () => {
      const out: Option[] = [];
      for (const s of sheets) {
        const cols = ctx.cols(s.t);
        if (!cols.includes("Subgroup")) continue;
        const hasFg = cols.includes("Food Group");
        for (const r of q(ctx, `SELECT ${hasFg ? `"Food Group"` : "NULL"} AS fg, Subgroup AS sg, COUNT(*) AS n FROM ${qi(s.t)} WHERE Subgroup IS NOT NULL GROUP BY 1, 2`))
          out.push({ value: `${s.t}|${r.sg}`, label: subLabel(hasFg ? r.fg : null, r.sg) ?? String(r.sg), count: Number(r.n), parent: s.sheet });
      }
      return out;
    });
  return {
    table: "_food_index",
    orderBy: "f.food_name COLLATE NOCASE, f.food_id",
    categories: () => ({ cats: sheets.map((s) => ({ value: s.sheet, label: sheetLabel(s.sheet), count: s.n })), subs: subList() }),
    where: () => {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (ctx.f.cat) {
        clauses.push("f.sheet = ?");
        params.push(ctx.f.cat);
      }
      if (ctx.f.sub) {
        const i = ctx.f.sub.indexOf("|");
        const t = ctx.f.sub.slice(0, i);
        if (i > 0 && tables.includes(t) && ctx.cols(t).includes("Subgroup")) {
          clauses.push(`f.table_name = ? AND f._row IN (SELECT _row FROM ${qi(t)} WHERE Subgroup IN (?, ?))`);
          params.push(t, ...eqParams(ctx.f.sub.slice(i + 1)));
        } else clauses.push("0");
      }
      if (ctx.f.q) {
        const l = like(ctx.f.q);
        clauses.push(`(${[LIKE("f.food_name"), LIKE("f.sheet"), "f.food_id = ?"].join(" OR ")})`);
        params.push(l, l, ctx.f.q);
      }
      return { clauses, params };
    },
    unfilteredTotal: () => rowCount(ctx.info, "_food_index"),
    columns: () => [...identityColumns(extras), ...nutrientCols()],
    rows: (_c, rowids) => {
      const idx = byRowids(ctx, "_food_index", rowids);
      const rows: Row[] = idx.map((i) => ident({}, { id: i.food_id, name: i.food_name, cat: sheetLabel(String(i.sheet)) }));
      const byTable = new Map<string, { row: Row; r: number; id: unknown }[]>();
      idx.forEach((i, n) => {
        const t = String(i.table_name);
        if (!byTable.has(t)) byTable.set(t, []);
        byTable.get(t)!.push({ row: rows[n], r: Number(i._row), id: i.food_id });
      });
      for (const [t, items] of byTable) {
        const l = layout.perTable.get(t);
        if (!l) continue;
        const recs = new Map(qIn(ctx, `SELECT * FROM ${qi(t)} WHERE _row IN (__IDS__)`, items.map((x) => x.r)).map((r) => [Number(r._row), r]));
        const notesCol = l.identity.find((c) => NOTES_COL.test(c));
        for (const it of items) {
          const rec = recs.get(it.r);
          if (!rec) continue;
          it.row.sub = subLabel(rec["Food Group"], rec.Subgroup);
          if (notesCol) it.row.notes = val(rec[notesCol]);
          for (const c of l.identity) {
            const k = `x:${normKey(c)}`;
            if (it.row[k] === undefined || it.row[k] === null) it.row[k] = val(rec[c]);
          }
          for (const c of l.nutrients) it.row[`c:${c}`] = val(rec[c]);
        }
        const fa = layout.fa.get(t);
        if (fa) {
          const got = qIn(ctx, `SELECT * FROM ${qi(fa.table)} WHERE ${qi(fa.idCol)} IN (__IDS__)`, items.map((x) => String(x.id)));
          const byId = new Map(got.map((r) => [String(r[fa.idCol]), r]));
          for (const it of items) {
            const rec = byId.get(String(it.id));
            if (rec) for (const c of fa.nutrients) it.row[`fa:${c}`] = val(rec[c]);
          }
        }
      }
      return rows;
    },
    docs: () => ({
      mainFood: `_food_index rows (${rowCount(ctx.info, "_food_index")}): every food row of every per-food-group sheet (derived at ingest: food id, name, sheet, row).`,
      identity: [
        ["Major Category", "the sheet (food group) the food is listed in"],
        [
          "Sub-Category",
          groupNames.size ? "the sheet's 'Subgroup' code → subgroup name from the Food_groups sheet" : "the sheet's 'Subgroup' column where it has one (fish, meat, roots), else '-'",
        ],
        ["Base / Variant", "split of the English food name (first comma); the sheet's 'Processing' column is kept as its own column"],
        ["Notes / Serving Ideas", "'Comments on data processing/methods'"],
        ["Food ID", "Food Item ID (via _food_index.food_id)"],
        ["Extras", "the sheet's other descriptive columns (country, processing, scientific name, season, n, publication year, BiblioID ...), matched across sheets by name"],
      ],
      values: `The component columns of the food's sheet (INFOODS tag + unit in the header, e.g. 'CA(mg)'), labelled via the Components sheet as 'Name [TAG] (unit)'. Columns of a fatty-acid companion sheet (joined on Food Item ID) are marked '· FA sheet'. Values are as stored (text such as 'tr' or '[0.2]' kept). ${BASIS_100G}`,
      split: SPLIT_DOC,
      related: [],
      notes: ["The column set is the union over all sheets; a sheet without a component leaves it '-'."],
    }),
  };
}

/* ------------------------------------------------------------------ single wide sheet */

type LookupCats = {
  catCol: string;
  subCol: string;
  catLabel: (v: string) => string;
  subLabel: (v: string) => string;
};

type WideCfg = {
  table: string;
  idCol: string;
  nameCol: string;
  /** SQL (alias f) selecting the food rows. */
  foodWhere: string;
  /** Row-range categories: food-group header rows inside the same sheet. */
  groups?: { headerWhere: string; labelCol: string; initialFromHeader?: string };
  /** Sub-category straight from a column. */
  subCol?: string;
  /** Category / sub-category via code lookups (uFiSh). */
  lookup?: (ctx: Ctx) => LookupCats;
  /** Explicit component columns (default: the columns after the bibliography column). */
  nutrientCols?: string[];
  related?: { key: string; label: string; table: string; on: string; mode: "count" | "list"; cols?: string[] }[];
  mainFood: string;
  identityDocs: [string, string][];
  valuesDoc?: string;
  notes?: string[];
};

function wideSpec(ctx: Ctx, cfg: WideCfg): Spec {
  const allCols = ctx.cols(cfg.table);
  const split = splitSheetColumns(allCols);
  const nutrients = cfg.nutrientCols ?? split.nutrients;
  const identity = cfg.nutrientCols ? allCols.filter((c) => c !== "_row" && !nutrients.includes(c)) : split.identity;
  const look = cfg.lookup?.(ctx);
  const skip = new Set([cfg.idCol, cfg.nameCol, ...(cfg.subCol ? [cfg.subCol] : [])]);
  const extraCols: Column[] = identity
    .filter((c) => !skip.has(c))
    .map((c) => ({ key: `x:${normKey(c)}`, label: c, kind: "identity" as const, optional: /^(update version|page nr)/i.test(c), title: c }));
  const nutrientColumns = () =>
    ctx.memo("ncols", () =>
      finishNutrients(
        nutrients.map((c) => {
          const lab = sheetNutrientLabel(ctx, c);
          return { key: `c:${c}`, label: lab.label, kind: "nutrient" as const, unit: lab.unit, title: lab.title };
        }),
      ),
    );
  const headers = () =>
    ctx.memo("headers", () => {
      if (!cfg.groups) return [] as { r: number; label: string }[];
      const hs = q<{ r: number; label: string }>(
        ctx,
        `SELECT _row AS r, ${qi(cfg.groups.labelCol)} AS label FROM ${qi(cfg.table)} f WHERE ${cfg.groups.headerWhere} ORDER BY _row`,
      ).map((h) => ({ r: Number(h.r), label: String(h.label).trim() }));
      if (cfg.groups.initialFromHeader && ctx.has("_columns")) {
        const hv = ctx.db.prepare(`SELECT header_values AS h FROM _columns WHERE table_name = ? AND column_name = ?`).get(cfg.table, cfg.groups.initialFromHeader) as
          | { h?: string }
          | undefined;
        try {
          const vals = (JSON.parse(hv?.h ?? "[]") as string[]).filter((v) => v && v.trim());
          const last = vals[vals.length - 1];
          if (last && last !== cfg.groups.initialFromHeader) hs.unshift({ r: 0, label: last.trim() });
        } catch {
          /* no header values */
        }
      }
      return hs;
    });
  const groupOf = (r: number) => {
    let cur: { r: number; label: string } | null = null;
    for (const h of headers()) {
      if (h.r < r) cur = h;
      else break;
    }
    return cur;
  };
  const related = (cfg.related ?? []).filter((r) => ctx.has(r.table) && ctx.cols(r.table).includes(r.on));
  const relatedCols: Column[] = related.map((r) => ({ key: `r:${r.key}`, label: r.label, kind: "related", title: `${r.table}.${r.on}` }));
  return {
    table: cfg.table,
    orderBy: `f.${qi(cfg.nameCol)} COLLATE NOCASE, f._row`,
    categories: () =>
      ctx.memo("cats", () => {
        if (cfg.groups) {
          const n = new Map<number, number>();
          for (const c of q<{ r: number }>(ctx, `SELECT _row AS r FROM ${qi(cfg.table)} f WHERE ${cfg.foodWhere}`)) {
            const g = groupOf(Number(c.r));
            if (g) n.set(g.r, (n.get(g.r) ?? 0) + 1);
          }
          return { cats: headers().filter((h) => n.get(h.r)).map((h) => ({ value: String(h.r), label: h.label, count: n.get(h.r) ?? 0 })), subs: [] as Option[] };
        }
        if (look) {
          const cats = q<{ v: unknown; n: number }>(
            ctx,
            `SELECT f.${qi(look.catCol)} AS v, COUNT(*) AS n FROM ${qi(cfg.table)} f WHERE ${cfg.foodWhere} AND f.${qi(look.catCol)} IS NOT NULL GROUP BY 1`,
          );
          const subs = q<{ p: unknown; v: unknown; n: number }>(
            ctx,
            `SELECT f.${qi(look.catCol)} AS p, f.${qi(look.subCol)} AS v, COUNT(*) AS n FROM ${qi(cfg.table)} f WHERE ${cfg.foodWhere} AND f.${qi(look.subCol)} IS NOT NULL GROUP BY 1, 2`,
          );
          return {
            cats: cats.map((c) => ({ value: String(c.v), label: look.catLabel(String(c.v)), count: c.n })).sort((a, b) => collator.compare(a.label, b.label)),
            subs: subs
              .map((s) => ({ value: String(s.v), label: look.subLabel(String(s.v)), count: s.n, parent: String(s.p) }))
              .sort((a, b) => collator.compare(a.label, b.label)),
          };
        }
        if (cfg.subCol) {
          const subs = q<{ v: unknown; n: number }>(
            ctx,
            `SELECT f.${qi(cfg.subCol)} AS v, COUNT(*) AS n FROM ${qi(cfg.table)} f WHERE ${cfg.foodWhere} AND f.${qi(cfg.subCol)} IS NOT NULL GROUP BY 1 ORDER BY 1`,
          );
          return { cats: [] as Option[], subs: subs.map((s) => ({ value: String(s.v), label: String(s.v), count: s.n })) };
        }
        return { cats: [] as Option[], subs: [] as Option[], note: "This source has no food categories." };
      }),
    where: () => {
      const clauses = [cfg.foodWhere];
      const params: (string | number)[] = [];
      if (ctx.f.cat) {
        if (cfg.groups) {
          const hs = headers();
          const i = hs.findIndex((h) => String(h.r) === ctx.f.cat);
          if (i < 0) clauses.push("0");
          else {
            clauses.push("f._row > ? AND f._row < ?");
            params.push(hs[i].r, hs[i + 1]?.r ?? Number.MAX_SAFE_INTEGER);
          }
        } else if (look) {
          clauses.push(`f.${qi(look.catCol)} IN (?, ?)`);
          params.push(...eqParams(ctx.f.cat));
        }
      }
      if (ctx.f.sub) {
        const col = look?.subCol ?? cfg.subCol;
        if (col) {
          clauses.push(`f.${qi(col)} IN (?, ?)`);
          params.push(...eqParams(ctx.f.sub));
        }
      }
      if (ctx.f.q) {
        const l = like(ctx.f.q);
        const ors = [LIKE(`f.${qi(cfg.nameCol)}`), `CAST(f.${qi(cfg.idCol)} AS TEXT) = ?`];
        params.push(l, ctx.f.q);
        const sci = identity.find((c) => /scientific name|species/i.test(c));
        if (sci) {
          ors.push(LIKE(`f.${qi(sci)}`));
          params.push(l);
        }
        if (cfg.groups) {
          const hs = headers();
          hs.forEach((h, i) => {
            if (!h.label.toLowerCase().includes(ctx.f.q.toLowerCase())) return;
            ors.push("(f._row > ? AND f._row < ?)");
            params.push(h.r, hs[i + 1]?.r ?? Number.MAX_SAFE_INTEGER);
          });
        }
        clauses.push(`(${ors.join(" OR ")})`);
      }
      return { clauses, params };
    },
    columns: () => [...identityColumns(extraCols), ...nutrientColumns(), ...relatedCols],
    rows: (_c, rowids) => {
      const recs = byRowids(ctx, cfg.table, rowids);
      const rows = recs.map((rec) => {
        const cat = cfg.groups ? (groupOf(Number(rec._row))?.label ?? null) : look && rec[look.catCol] !== null && rec[look.catCol] !== undefined ? look.catLabel(String(rec[look.catCol])) : null;
        const sub = look ? (rec[look.subCol] ? look.subLabel(String(rec[look.subCol])) : null) : cfg.subCol ? rec[cfg.subCol] : null;
        const r = ident({}, { id: rec[cfg.idCol], name: rec[cfg.nameCol], cat, sub });
        for (const c of identity) if (!skip.has(c)) r[`x:${normKey(c)}`] = val(rec[c]);
        for (const c of nutrients) r[`c:${c}`] = val(rec[c]);
        return r;
      });
      for (const rel of related) {
        const keys = [...new Set(recs.map((r) => r[cfg.idCol]).filter((v) => v !== null && v !== undefined).map(String))];
        if (!keys.length) continue;
        const got = qIn(ctx, `SELECT * FROM ${qi(rel.table)} WHERE CAST(${qi(rel.on)} AS TEXT) IN (__IDS__) ORDER BY _row`, keys);
        const by = new Map<string, Record<string, unknown>[]>();
        for (const g of got) {
          const k = String(g[rel.on]);
          if (!by.has(k)) by.set(k, []);
          by.get(k)!.push(g);
        }
        recs.forEach((rec, i) => {
          const list = by.get(String(rec[cfg.idCol])) ?? [];
          if (!list.length) return;
          if (rel.mode === "count") rows[i][`r:${rel.key}`] = list.length;
          else
            rows[i][`r:${rel.key}`] = joinCompact(
              list
                .map((x) =>
                  (rel.cols ?? [])
                    .map((c) => (x[c] === null || x[c] === undefined || x[c] === "" ? "" : typeof x[c] === "number" ? fmtNum(x[c]) : String(x[c])))
                    .filter(Boolean)
                    .join(" · "),
                )
                .filter(Boolean),
              ctx.f.full,
              4,
            );
        });
      }
      return rows;
    },
    docs: () => ({
      mainFood: cfg.mainFood,
      identity: cfg.identityDocs,
      values:
        cfg.valuesDoc ??
        `The sheet's own component columns (${nutrients.length}), labelled from the header (INFOODS tags resolved via the Components sheet where the header is a tag). Values are as stored (text such as 'tr' or '[0.2]' kept). ${BASIS_100G}`,
      split: SPLIT_DOC,
      related: relatedCols.map((r) => `${r.label}: ${r.title ?? ""}`),
      notes: cfg.notes ?? [],
    }),
  };
}

export function wideSpecFor(ctx: Ctx): Spec {
  const s = ctx.source;
  const common = { table: s.foodTable, idCol: s.foodIdField, nameCol: s.foodNameField };
  switch (ctx.sourceId) {
    case "wafct":
      return wideSpec(ctx, {
        ...common,
        foodWhere: `f."Food name in English" IS NOT NULL`,
        groups: { headerWhere: `f."Food name in English" IS NULL AND f.Code IS NOT NULL AND f.Code NOT GLOB '[0-9][0-9]_*'`, labelCol: "Code" },
        related: [
          { key: "stat", label: "Statistics rows (06_NV_stat_57)", table: "06_NV_stat_57_per_100g_EP", on: "Code", mode: "count" },
          { key: "yield", label: "Yield factor (07)", table: "07_Yield_factors_sing_ing", on: "Code", mode: "list", cols: ["Yield factor / Factor de rendement", "Source"] },
          { key: "recipe", label: "Recipe rows (09_Mixed_dishes)", table: "09_Mixed_dishes", on: "Code", mode: "count" },
          { key: "foodex2", label: "FoodEx2 (10)", table: "10_FoodEx2_codes", on: "Code", mode: "list", cols: ["FoodEx2 Code", "FoodEx2 Description"] },
          { key: "names2012", label: "2012 code / name (11)", table: "11_2012_vs_2019_names_and_codes", on: "2019 Code", mode: "list", cols: ["2012 Code", "2012 Food name in English"] },
        ],
        mainFood: "Food rows of 05_NV_sum_57_per_100g_EP (rows with an English name; the food-group header rows in between become the category).",
        identityDocs: [
          ["Major Category", "the food-group header row above the food in the sheet (e.g. 'Cereals and their products/Céréales et produits dérivés')"],
          ["Sub-Category", "- (none in the source)"],
          ["Base / Variant", "split of 'Food name in English' (first comma)"],
          ["Notes / Serving Ideas", "- (none in the source)"],
          ["Food ID", "Code"],
          ["Extras", "French name, scientific name, BiblioID/Source"],
        ],
        valuesDoc: `The component columns of 05_NV_sum_57 (headers are 'Name (unit)'). Values are text as published: [brackets] = estimated / imputed, 'tr' = trace. ${BASIS_100G}`,
      });
    case "wafct-2012":
      return wideSpec(ctx, {
        ...common,
        foodWhere: `f.Code GLOB '[0-9][0-9]_[0-9]*'`,
        groups: {
          headerWhere: `f."Food name in English" IS NULL AND f.Code IS NOT NULL AND f.Code NOT IN ('n', 'SD or min-max') AND f.Code NOT GLOB '[0-9][0-9]_[0-9]*'`,
          labelCol: "Code",
          initialFromHeader: "Code",
        },
        related: [
          { key: "index", label: "Book page (INDEX_English)", table: "INDEX_English", on: "Code", mode: "list", cols: ["Page Nr"] },
          { key: "yield", label: "Yield factor", table: "Yield_factors", on: "Code", mode: "list", cols: ["Yield factor/", "Source"] },
        ],
        mainFood: "USERDATABASE rows whose Code looks like 'NN_NNN' (the 'n' and 'SD or min-max' rows under each food are its statistics, not foods).",
        identityDocs: [
          ["Major Category", "the food-group header row above the food (the first group, '01 Cereals and their products', sits in the sheet header)"],
          ["Sub-Category", "- (none in the source)"],
          ["Base / Variant", "split of 'Food name in English' (first comma)"],
          ["Notes / Serving Ideas", "- (none in the source)"],
          ["Food ID", "Code"],
          ["Extras", "French name, scientific name, Source/BiblioID"],
        ],
        notes: ["The per-food 'n' and 'SD or min-max' statistic rows are not merged into the composite; they are in the table view."],
      });
    case "fao-pulsesdm":
    case "fao-upulses": {
      const dm = ctx.sourceId === "fao-pulsesdm";
      return wideSpec(ctx, {
        ...common,
        foodWhere: `f.${qi(s.foodIdField)} IS NOT NULL`,
        subCol: "Species/Subspecies",
        related: [
          { key: "stat", label: "Statistics rows (05)", table: "05_NV_stat_per_100_g_EP_on_FW", on: "FoodID", mode: "count" },
          { key: "doc", label: "Documentation rows (05)", table: "05_NV_doc_per_100_g_EPDM", on: "FoodID", mode: "count" },
          { key: "aa", label: "Amino-acid rows (06, per g N)", table: "06_AA_per_g_N", on: "FoodID", mode: "count" },
        ],
        mainFood: `Rows of ${s.foodTable} (the per-100 g summary sheet). FoodID is not unique in every release; duplicates are separate rows.`,
        identityDocs: [
          ["Major Category", "- (all foods are pulses; the source has no groups)"],
          ["Sub-Category", "Species/Subspecies (the only grouping column in the sheet)"],
          ["Base / Variant", "split of 'Food name in English' (first comma)"],
          ["Notes / Serving Ideas", "- (none in the summary sheet)"],
          ["Food ID", "FoodID"],
          ["Extras", "country, processing code, cultivar, BiblioID"],
        ],
        valuesDoc: `Component columns (INFOODS tag + unit), labelled via the Components sheet. Values per 100 g edible portion on a ${dm ? "DRY-MATTER" : "fresh-weight"} basis, as stored.`,
      });
    }
    case "fao-ufish":
      return wideSpec(ctx, {
        ...common,
        foodWhere: `f."Food Item ID" IS NOT NULL`,
        lookup: (c) => {
          const m = c.memo("isscaap", () => {
            const groups = new Map<string, string>();
            const species = new Map<string, string>();
            for (const r of q(c, `SELECT * FROM "02_Overview_Species" ORDER BY _row`)) {
              const g = r.ISCCAAP ? String(r.ISCCAAP).match(/^(\d+)\s+(.+)$/) : null;
              if (g) groups.set(String(Number(g[1])), `${g[1]} ${g[2].trim()}`);
              if (r["3-ALPHA"] && r["ENGLISH NAME"]) species.set(String(r["3-ALPHA"]).trim(), String(r["ENGLISH NAME"]).trim());
            }
            return { groups, species };
          });
          return {
            catCol: "ISSCAAP",
            subCol: "3-Alpha",
            catLabel: (v) => m.groups.get(String(Number(v))) ?? v,
            subLabel: (v) => (m.species.get(v.trim()) ? `${m.species.get(v.trim())} (${v.trim()})` : v),
          };
        },
        related: [
          { key: "stat", label: "Statistics rows (05)", table: "05_NV_stat_per_100_g_EP", on: "Food Item ID", mode: "count" },
          { key: "yield", label: "Yield factors (09)", table: "09_Yield_Factors", on: "Food Item ID", mode: "list", cols: ["Yield factor (YF)", "Cooking method"] },
        ],
        mainFood: "Rows of 04_NV_sum_per_100_g_EP.",
        identityDocs: [
          ["Major Category", "ISSCAAP code → group name from 02_Overview_Species (e.g. '12 Tilapias and other cichlids')"],
          ["Sub-Category", "species: 3-Alpha code → ENGLISH NAME in 02_Overview_Species"],
          ["Base / Variant", "split of 'Food name in English' (first comma)"],
          ["Notes / Serving Ideas", "- (none in the summary sheet)"],
          ["Food ID", "Food Item ID"],
          ["Extras", "habitat (W/F), state of food (r/c/p), RefID"],
        ],
        notes: ["06_AA_per_g_N and 07_FA_per_100g_FA use their own ids (little overlap with Food Item ID) and are not merged."],
      });
    case "fao-density":
      return wideSpec(ctx, {
        ...common,
        nutrientCols: ["Density in g/ml (including mass and bulk density)", "Specific gravity"],
        foodWhere: `NOT (f."Density in g/ml (including mass and bulk density)" IS NULL AND f."Specific gravity" IS NULL AND f.BiblioID IS NULL)`,
        groups: {
          headerWhere: `f."Density in g/ml (including mass and bulk density)" IS NULL AND f."Specific gravity" IS NULL AND f.BiblioID IS NULL AND f."Food name and description" IS NOT NULL`,
          labelCol: "Food name and description",
        },
        mainFood: "Density_DB rows with a density, specific gravity or BiblioID (the rows without any are food-group headings).",
        identityDocs: [
          ["Major Category", "the heading row above the food (e.g. 'Beverages, non alcoholic (including soft drinks and juices)')"],
          ["Sub-Category", "- (none in the source)"],
          ["Base / Variant", "split of 'Food name and description' (first comma)"],
          ["Notes / Serving Ideas", "- (none in the source)"],
          ["Food ID", "sheet row number (_row; the source has no food id)"],
          ["Extras", "BiblioID, 'Update Version 2.0' flag"],
        ],
        valuesDoc: "Density (g/ml) and specific gravity (unitless) as stored.",
      });
  }
  throw new Error(`no composite definition for ${ctx.sourceId}`);
}

/* ------------------------------------------------------------------ FAO/INFOODS supplement (long format) */

export function supplementSpec(ctx: Ctx): Spec {
  const comps = () =>
    ctx.memo("comps", () =>
      q<{ id: unknown; name: unknown; u: unknown; n: number }>(
        ctx,
        `SELECT "Component ID" AS id, MIN("Component Name in English") AS name, "Unit Name Short" AS u, COUNT(DISTINCT "Product ID") AS n FROM "Main_extract"
         WHERE "Component Name in English" IS NOT NULL OR "Component ID" IS NOT NULL GROUP BY 1, 3`,
      ),
    );
  const keyOf = (id: unknown, name: unknown, u: unknown) => `n:${id ?? name}|${u ?? ""}`;
  const productCols: [string, string, boolean][] = [
    ["Country name", "Country", false],
    ["Brand Name", "Brand", false],
    ["Manufacturer", "Manufacturer", false],
    ["Barcode", "Barcode", false],
    ["Package Size", "Package size", false],
    ["Capsules/doses per package", "Doses per package", false],
    ["Serving/dosage size", "Serving / dosage size", false],
    ["Supplement group code", "Supplement group code", true],
    ["Claims (health) front of pack", "Claims (front of pack)", true],
    ["Claims (health) back of pack", "Claims (back of pack)", true],
    ["Text on pack (other than claims)", "Text on pack", true],
    ["Website", "Website", true],
    ["Date collected", "Date collected", true],
  ];
  const extras: Column[] = [
    { key: "x:valuesper", label: "Values per", kind: "identity", title: "Values per XXX" },
    ...productCols.map(([c, label, optional]) => ({ key: `x:${normKey(c)}`, label, kind: "identity" as const, optional, title: c })),
  ];
  return {
    table: "Main_extract",
    orderBy: `MIN(f."Full product name") COLLATE NOCASE, f."Product ID"`,
    groupBy: `f."Product ID"`,
    categories: () =>
      ctx.memo("cats", () => ({
        cats: q<{ v: string; n: number }>(
          ctx,
          `SELECT "Supplement group name" AS v, COUNT(DISTINCT "Product ID") AS n FROM "Main_extract" WHERE "Supplement group name" IS NOT NULL GROUP BY 1 ORDER BY 1`,
        ).map((r) => ({ value: r.v, label: r.v, count: r.n })),
        subs: [] as Option[],
      })),
    where: () => {
      const clauses = [`f."Product ID" IS NOT NULL`];
      const params: (string | number)[] = [];
      if (ctx.f.cat) {
        clauses.push(`f."Supplement group name" = ?`);
        params.push(ctx.f.cat);
      }
      if (ctx.f.q) {
        const l = like(ctx.f.q);
        clauses.push(`(${[LIKE(`f."Full product name"`), LIKE(`f."Brand Name"`), `CAST(f."Product ID" AS TEXT) = ?`, `CAST(f."Barcode" AS TEXT) = ?`].join(" OR ")})`);
        params.push(l, l, ctx.f.q, ctx.f.q);
      }
      return { clauses, params };
    },
    columns: () => [
      ...identityColumns(extras),
      ...finishNutrients(
        comps().map((c) => {
          const unit = unitSymbol(c.u);
          return {
            key: keyOf(c.id, c.name, c.u),
            label: withUnit(String(c.name ?? c.id), unit),
            kind: "nutrient" as const,
            unit,
            title: `Component ID ${c.id ?? "-"} · ${c.n} products`,
          };
        }),
      ),
      { key: "r:components", label: "Components listed", kind: "related", title: "Main_extract rows of the product" },
    ],
    rows: (_c, rowids) => {
      const heads = byRowids(ctx, "Main_extract", rowids, `"Product ID" AS pid`);
      const pids = heads.map((h) => h.pid as string | number);
      const by = new Map<string, Record<string, unknown>[]>();
      for (const r of qIn(ctx, `SELECT * FROM "Main_extract" WHERE "Product ID" IN (__IDS__) ORDER BY _row`, pids)) {
        const k = String(r["Product ID"]);
        if (!by.has(k)) by.set(k, []);
        by.get(k)!.push(r);
      }
      return pids.map((pid) => {
        const list = by.get(String(pid)) ?? [];
        const first = list[0] ?? {};
        const distinct = (c: string) => [...new Set(list.map((r) => r[c]).filter((v) => v !== null && v !== undefined && v !== "").map(String))];
        const row = ident({}, {
          id: pid,
          name: first["Full product name"],
          cat: distinct("Supplement group name").join("; ") || null,
          notes: [...distinct("Dosage information"), ...distinct("Notes")].join("; ") || null,
        });
        row["x:valuesper"] = distinct("Values per XXX").join("; ") || null;
        for (const [c] of productCols) row[`x:${normKey(c)}`] = distinct(c).join("; ") || null;
        for (const r of list) {
          if ((r["Component Name in English"] === null || r["Component Name in English"] === undefined) && (r["Component ID"] === null || r["Component ID"] === undefined)) continue;
          const k = keyOf(r["Component ID"], r["Component Name in English"], r["Unit Name Short"]);
          const v = val(r.Amount);
          if (v === null) continue;
          row[k] = row[k] === undefined || row[k] === null || row[k] === v ? v : `${row[k]} / ${v}`;
        }
        row["r:components"] = list.length;
        return row;
      });
    },
    docs: () => ({
      mainFood: "Products: Main_extract grouped by Product ID (the sheet is long-format: one row per product × component).",
      identity: [
        ["Major Category", "Supplement group name (all distinct values of the product's rows)"],
        ["Sub-Category", "- (none in the source)"],
        ["Base / Variant", "split of 'Full product name' (first comma)"],
        ["Notes / Serving Ideas", "Dosage information; Notes"],
        ["Food ID", "Product ID"],
        ["Extras", "'Values per' (Tablet / Capsule / 100 ml ...), country, brand, manufacturer, barcode, package and serving size"],
      ],
      values:
        "Amount pivoted by Component ID × Unit Name Short, labelled 'Component Name in English (unit)'. The basis is the product's 'Values per' (per tablet, capsule, 100 ml ...), not per 100 g. Two different amounts for the same component are shown as 'a / b'.",
      split: SPLIT_DOC,
      related: ["Components listed: number of Main_extract rows of the product"],
      notes: ["Sports_products is a separate product list (its own per-100 g columns; its barcodes do not overlap Main_extract) and is not merged; it stays in the table view."],
    }),
  };
}

/* ------------------------------------------------------------------ Open Food Facts */

/** OFF export conventions for *_100g columns (the CSV header carries no units). Default: g. */
const OFF_UNITS: Record<string, string | null> = {
  "energy-kj": "kJ",
  energy: "kJ",
  "energy-from-fat": "kJ",
  "energy-kcal": "kcal",
  alcohol: "% vol",
  "fruits-vegetables-legumes": "%",
  "fruits-vegetables-nuts": "%",
  "fruits-vegetables-nuts-estimate": "%",
  "collagen-meat-protein-ratio": "%",
  cocoa: "%",
  ph: null,
  "glycemic-index": null,
  "water-hardness": null,
  "nutrition-score-fr": null,
  "nutrition-score-uk": null,
  "carbon-footprint": "g",
};

function offLabel(col: string): { label: string; unit: string | null } {
  const base = col.replace(/_100g$/, "");
  const unit = base in OFF_UNITS ? OFF_UNITS[base] : "g";
  const words = base.split("-");
  const pretty = words.map((w, i) => (i > 0 && /^vitamin$/i.test(words[i - 1]) ? w.toUpperCase() : w)).join(" ");
  return { label: withUnit(base === "ph" ? "pH" : cap1(pretty), unit), unit };
}

export function offSpec(ctx: Ctx): Spec {
  const cols = ctx.cols("product");
  const nutrients = cols.filter((c) => c.endsWith("_100g"));
  const core = ["brands", "quantity", "generic_name", "main_category_en", "categories_en", "food_groups_en", "countries_en", "nutriscore_grade", "nova_group", "ingredients_text", "allergens_en", "labels_en"];
  const skip = new Set(["code", "product_name", "pnns_groups_1", "pnns_groups_2", "serving_size", ...nutrients]);
  const rank = (c: string) => (core.includes(c) ? core.indexOf(c) : 999);
  const extras: Column[] = cols
    .filter((c) => !skip.has(c))
    .sort((a, b) => rank(a) - rank(b))
    .map((c) => ({ key: `x:${c}`, label: c, kind: "identity" as const, optional: !core.includes(c), title: c }));
  const ix1 = ctx.info.indexNames.has("ix_product_pnns_groups_1_product_name_code");
  const ix2 = ctx.info.indexNames.has("ix_product_pnns_groups_2_product_name_code");
  return {
    table: "product",
    orderBy: "f.product_name, f.code",
    large: true,
    categories: () => {
      if (!ix1 || !ix2) return { cats: [], subs: [], note: "The category filter needs the PNNS indexes: run `npm run ingest -- prep off` once." };
      return ctx.memo("cats", () => {
        const cats = q<{ v: string; n: number }>(
          ctx,
          `SELECT pnns_groups_1 AS v, COUNT(*) AS n FROM product INDEXED BY ix_product_pnns_groups_1_product_name_code WHERE pnns_groups_1 > '' AND product_name > '' GROUP BY 1`,
        );
        const subs = q<{ v: string; n: number }>(
          ctx,
          `SELECT pnns_groups_2 AS v, COUNT(*) AS n FROM product INDEXED BY ix_product_pnns_groups_2_product_name_code WHERE pnns_groups_2 > '' AND product_name > '' GROUP BY 1`,
        );
        const parent = ctx.db.prepare(
          `SELECT pnns_groups_1 AS p FROM product INDEXED BY ix_product_pnns_groups_2_product_name_code WHERE pnns_groups_2 = ? AND pnns_groups_1 > '' LIMIT 1`,
        );
        return {
          cats: cats.map((c) => ({ value: c.v, label: c.v, count: c.n })),
          subs: subs.map((s) => ({ value: s.v, label: s.v, count: s.n, parent: (parent.get(s.v) as { p?: string } | undefined)?.p ?? null })),
        };
      });
    },
    where: () => {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (ctx.f.cat) {
        clauses.push("f.pnns_groups_1 = ?");
        params.push(ctx.f.cat);
      }
      if (ctx.f.sub) {
        clauses.push("f.pnns_groups_2 = ?");
        params.push(ctx.f.sub);
      }
      if (ctx.f.q) {
        clauses.push(`(${LIKE("f.product_name")} OR f.code = ?)`);
        params.push(like(ctx.f.q), ctx.f.q);
      } else clauses.push("f.product_name > ''");
      return { clauses, params };
    },
    unfilteredTotal: () => ctx.memo("named", () => (ctx.db.prepare(`SELECT COUNT(*) AS n FROM product WHERE product_name > ''`).get() as { n: number }).n),
    columns: () => [
      ...identityColumns(extras),
      ...finishNutrients(
        nutrients.map((c) => {
          const l = offLabel(c);
          return { key: `c:${c}`, label: l.label, kind: "nutrient" as const, unit: l.unit, title: c };
        }),
      ),
    ],
    rows: (_c, rowids) =>
      byRowids(ctx, "product", rowids).map((rec) => {
        const r = ident({}, {
          id: rec.code,
          name: rec.product_name,
          cat: rec.pnns_groups_1,
          sub: rec.pnns_groups_2,
          notes: rec.serving_size ? `Serving size: ${rec.serving_size}` : null,
        });
        for (const e of extras) r[e.key] = val(rec[e.key.slice(2)]);
        for (const c of nutrients) r[`c:${c}`] = val(rec[c]);
        return r;
      }),
    docs: () => ({
      mainFood: "product rows with a product_name (products without a name are skipped).",
      identity: [
        ["Major Category", "pnns_groups_1 (OFF's PNNS group; often 'unknown')"],
        ["Sub-Category", "pnns_groups_2"],
        ["Base / Variant", "split of product_name (first comma)"],
        ["Notes / Serving Ideas", "serving_size"],
        ["Food ID", "code (barcode)"],
        ["Extras", "brands, quantity, categories, food groups, countries, Nutri-Score, NOVA, ingredients, allergens, labels (+ every other product column as optional columns)"],
      ],
      values:
        "The product's *_100g columns. The OFF export has no units in its header; following OFF's documented conventions the values are g per 100 g (or 100 ml), energy in kJ (energy-kcal in kcal), alcohol in % vol, fruit/vegetable, cocoa and collagen ratio in %, and pH / glycemic index / water hardness unitless. Labels are the column names without '_100g'.",
      split: SPLIT_DOC,
      related: [],
      notes: [
        "OFF is a single wide table; there is nothing to join.",
        "Searches scan product_name and stop after 2 s on this 4.5M-row table (partial results are flagged).",
      ],
    }),
  };
}
