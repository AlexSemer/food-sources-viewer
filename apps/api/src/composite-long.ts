/** Composite definitions for sources with a long (food × component) value table: FooDB and Frida. */
import { eqParams, rowCount } from "./db.ts";
import {
  BASIS_100G,
  byRowids,
  collator,
  finishNutrients,
  ident,
  identityColumns,
  joinCompact,
  like,
  LIKE,
  q,
  qIn,
  round,
  SPLIT_DOC,
  val,
  withUnit,
  type Column,
  type Ctx,
  type Option,
  type Row,
  type Spec,
} from "./composite-specs.ts";

/* ------------------------------------------------------------------ FooDB */

export const FOODB_TOP_COMPOUNDS = 200;
const KJ_PER_KCAL = 4.184;

/**
 * Real unit of a FooDB Content row (orig_unit + orig_unit_expression) and the exact factor from its standard_content
 * to that unit. Mass per mass of the food is converted to mg/100 g ("mg"); dry-weight, per-litre, molar and
 * activity / equivalent units (µM, IU, RE, NE, α-TE, ppb ...) keep their own unit, so they are never averaged with mg.
 */
export function foodbUnit(u: unknown, expr: unknown): { unit: string; factor: number } {
  const raw = [u, expr].map((x) => (x === null || x === undefined ? "" : String(x).trim())).filter(Boolean).join(" ");
  const s = raw.toLowerCase().replace(/\s+/g, " ").replace(/µ/g, "u");
  const dry = /dry (weight|matter)/.test(s);
  const rest = s.replace(/(of )?dry (weight|matter)|fresh ?(weight|sample)/g, "").trim();
  const toMg: Record<string, number> = { g: 1000, mg: 1, ug: 0.001 };
  let m = rest.match(/^(g|mg|ug) ?\/ ?(100 ?g|kg|g)\b ?(.*)$/);
  if (m) {
    const per = m[2] === "kg" ? 10 : m[2] === "g" ? 0.01 : 1; // in units of 100 g
    const basis = [dry ? "dry weight" : "", m[3]].filter(Boolean).join(" ");
    return { unit: basis ? `mg/100 g ${basis}` : "mg", factor: toMg[m[1]] / per };
  }
  m = rest.match(/^(mg|ug) ?\/ ?l$/);
  if (m) return { unit: "mg/L", factor: toMg[m[1]] };
  if (/^umol ?\/ ?g$/.test(rest)) return { unit: dry ? "µmol/g dry weight" : "µmol/g", factor: 1 };
  if (rest === "um") return { unit: "µM", factor: 1 };
  if (/^(iu|kcal)( ?\/ ?100 ?g)?$/.test(rest)) return { unit: rest.startsWith("iu") ? "IU" : "kcal", factor: 1 };
  return { unit: raw || "?", factor: 1 };
}

export function foodbSpec(ctx: Ctx): Spec {
  const mode = ctx.f.mode === "compounds" ? "compounds" : "nutrients";
  const TOP = FOODB_TOP_COMPOUNDS;
  const aggFn = { avg: "AVG", min: "MIN", max: "MAX", n: "COUNT" }[ctx.f.agg];
  const compoundRank = () =>
    ctx.memo("compoundRank", () => {
      if (ctx.has("_compound_rank"))
        return q<{ id: number; name: string | null; foods: number }>(
          ctx,
          `SELECT r.compound_id AS id, c.name AS name, r.foods AS foods FROM _compound_rank r LEFT JOIN Compound c ON c.id = r.compound_id WHERE r.rank <= ? ORDER BY r.rank`,
          TOP,
        );
      // Fallback without prep: one scan over Content (a few seconds, cached per API process).
      return q<{ id: number; name: string | null; foods: number }>(
        ctx,
        `SELECT x.id, c.name, x.foods FROM (SELECT source_id AS id, COUNT(DISTINCT food_id) AS foods FROM Content
           WHERE source_type = 'Compound' AND standard_content IS NOT NULL GROUP BY source_id ORDER BY foods DESC, source_id LIMIT ?) x
         LEFT JOIN Compound c ON c.id = x.id ORDER BY x.foods DESC, x.id`,
        TOP,
      );
    });
  const countMode = ctx.f.agg === "n";
  const energyIds = () =>
    ctx.memo("energyIds", () => q<{ id: number; name: string }>(ctx, `SELECT id, name FROM Nutrient`).filter((n) => /energy/i.test(n.name)).map((n) => Number(n.id)));
  const compoundKey = (id: unknown, unit: string) => (unit === "mg" ? `n:${id}` : `n:${id}|${unit}`);
  /** One column per top compound × real unit (Content.orig_unit); one scan, cached per API process. */
  const compoundUnits = () =>
    ctx.memo("compoundUnits", () => {
      const out = new Map<string, { id: number; unit: string; rows: number; orig: Set<string> }>();
      for (const r of q<{ id: number; u: string | null; e: string | null; n: number }>(
        ctx,
        `SELECT source_id AS id, orig_unit AS u, orig_unit_expression AS e, COUNT(*) AS n FROM Content
         WHERE source_type = 'Compound' AND standard_content IS NOT NULL AND source_id IN (${compoundRank().map((c) => Number(c.id)).join(",") || "NULL"}) GROUP BY 1, 2, 3`,
      )) {
        const { unit } = foodbUnit(r.u, r.e);
        const key = compoundKey(r.id, unit);
        const c = out.get(key) ?? { id: Number(r.id), unit, rows: 0, orig: new Set<string>() };
        c.rows += r.n;
        c.orig.add([r.u ?? "-", r.e].filter(Boolean).join(" "));
        out.set(key, c);
      }
      return out;
    });
  const nutrientCols = (): Column[] => {
    let cols: { key: string; name: string; unit: string; title: string }[];
    if (mode === "nutrients") {
      cols = q<{ id: number; name: string }>(ctx, `SELECT id, name FROM Nutrient`).map((n) => {
        const energy = energyIds().includes(Number(n.id));
        const unit = energy ? "kcal" : "mg";
        const title = energy
          ? `Nutrient.id ${n.id}; kcal/100 g: Content.standard_content, rows that FooDB stores in kJ (standard_content = 4.184 × orig_content, or orig_unit 'mg/100 g') divided by 4.184`
          : `Nutrient.id ${n.id}; Content.standard_content (${unit}/100 g)`;
        return { key: `n:${n.id}`, name: n.name, unit, title };
      });
    } else {
      const rank = new Map(compoundRank().map((c) => [Number(c.id), c]));
      cols = [...compoundUnits()].map(([key, u]) => {
        const c = rank.get(u.id);
        return {
          key,
          name: c?.name ?? `Compound ${u.id}`,
          unit: u.unit,
          title: `Compound.id ${u.id}; quantified in ${c?.foods ?? "?"} foods; ${u.rows} rows in ${u.unit === "mg" ? "mg/100 g" : u.unit} (Content.orig_unit: ${[...u.orig].join(", ")})`,
        };
      });
    }
    return finishNutrients(
      cols.map((c) => ({
        key: c.key,
        label: withUnit(c.name, countMode ? "n" : c.unit),
        kind: "nutrient" as const,
        unit: countMode ? "n" : c.unit,
        title: c.title,
      })),
    );
  };
  const I = (key: string, label: string, optional = false): Column => ({ key, label, kind: "identity", optional });
  const extras: Column[] = [
    I("x:name_scientific", "Scientific name"),
    I("x:public_id", "FooDB public id"),
    I("x:food_type", "Food type", true),
    I("x:category", "FooDB category", true),
    I("x:ncbi_taxonomy_id", "NCBI taxonomy id", true),
    I("x:itis_id", "ITIS id", true),
    I("x:wikipedia_id", "Wikipedia", true),
  ];
  const related: Column[] = [
    { key: "r:content", label: "Content rows", kind: "related", title: "Content rows per source_type (quantified = with standard_content)" },
    { key: "r:citations", label: "Nutrient value sources", kind: "related", title: "Content.citation of the food's Nutrient rows" },
    { key: "r:taxonomy", label: "Taxonomy", kind: "related", title: "FoodTaxonomy.classification_name by classification_order" },
  ];
  return {
    table: "Food",
    orderBy: "f.name COLLATE NOCASE, f.id",
    modes: [
      { value: "nutrients", label: "Nutrients (Content.source_type = 'Nutrient')" },
      { value: "compounds", label: `Compounds (top ${TOP} by foods with a quantified value)` },
    ],
    aggs: [
      { value: "avg", label: "average of the source rows" },
      { value: "min", label: "minimum" },
      { value: "max", label: "maximum" },
      { value: "n", label: "number of quantified rows" },
    ],
    categories: () =>
      ctx.memo("cats", () => {
        const g = q<{ v: string; n: number }>(ctx, `SELECT food_group AS v, COUNT(*) AS n FROM Food WHERE food_group IS NOT NULL GROUP BY 1 ORDER BY 1`);
        const s = q<{ p: string; v: string; n: number }>(
          ctx,
          `SELECT food_group AS p, food_subgroup AS v, COUNT(*) AS n FROM Food WHERE food_subgroup IS NOT NULL GROUP BY 1, 2 ORDER BY 2`,
        );
        return {
          cats: g.map((r) => ({ value: r.v, label: r.v, count: r.n })),
          subs: s.map((r) => ({ value: r.v, label: r.v, count: r.n, parent: r.p })),
        };
      }),
    where: () => {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (ctx.f.cat) {
        clauses.push("f.food_group = ?");
        params.push(ctx.f.cat);
      }
      if (ctx.f.sub) {
        clauses.push("f.food_subgroup = ?");
        params.push(ctx.f.sub);
      }
      if (ctx.f.q) {
        const l = like(ctx.f.q);
        clauses.push(
          `(${[LIKE("f.name"), LIKE("f.name_scientific"), LIKE("f.food_group"), LIKE("f.food_subgroup"), "f.public_id = ?", "CAST(f.id AS TEXT) = ?"].join(" OR ")})`,
        );
        params.push(l, l, l, l, ctx.f.q, ctx.f.q);
      }
      return { clauses, params };
    },
    unfilteredTotal: () => rowCount(ctx.info, "Food"),
    columns: () => [...identityColumns(extras), ...nutrientCols(), ...related],
    rows: (_c, rowids) => {
      const foods = byRowids(ctx, "Food", rowids);
      const out = new Map<number, Row>();
      const rows = foods.map((f) => {
        const r = ident({}, { id: f.id, name: f.name, cat: f.food_group, sub: f.food_subgroup, notes: f.description });
        // Literal "NULL" text cells are treated as missing.
        for (const e of extras) r[e.key] = f[e.key.slice(2)] === "NULL" ? null : val(f[e.key.slice(2)]);
        out.set(Number(f.id), r);
        return r;
      });
      const ids = [...out.keys()];
      if (!ids.length) return rows;
      if (mode === "nutrients") {
        // FooDB keeps part of its energy rows in kJ under a kcal label (standard_content = 4.184 × orig_content, USDA and DTU)
        // plus DTU copies labelled 'mg/100 g'; those are turned back into kcal before aggregating.
        const energy = energyIds();
        const v = energy.length
          ? `CASE WHEN source_id IN (${energy.join(",")}) AND (orig_unit NOT LIKE 'kcal%' OR ABS(standard_content - ${KJ_PER_KCAL} * orig_content) <= 0.01 * ABS(standard_content))
               THEN standard_content / ${KJ_PER_KCAL} ELSE standard_content END`
          : "standard_content";
        for (const r of qIn<{ k: number; n: number; v: unknown }>(
          ctx,
          `SELECT food_id AS k, source_id AS n, ${aggFn}(${v}) AS v FROM Content
           WHERE food_id IN (__IDS__) AND source_type = 'Nutrient' AND standard_content IS NOT NULL GROUP BY food_id, source_id`,
          ids,
        )) {
          const row = out.get(Number(r.k));
          if (row) row[`n:${r.n}`] = round(r.v);
        }
      } else {
        // Aggregated per food × compound × raw unit in SQL, then merged per real unit (after the exact factor).
        const acc = new Map<number, Map<string, { n: number; s: number; lo: number; hi: number }>>();
        for (const r of qIn<{ k: number; id: number; u: string | null; e: string | null; n: number; s: number; lo: number; hi: number }>(
          ctx,
          `SELECT food_id AS k, source_id AS id, orig_unit AS u, orig_unit_expression AS e, COUNT(*) AS n, SUM(standard_content) AS s,
             MIN(standard_content) AS lo, MAX(standard_content) AS hi FROM Content
           WHERE food_id IN (__IDS__) AND source_type = 'Compound' AND standard_content IS NOT NULL
             AND source_id IN (${compoundRank().map((c) => Number(c.id)).join(",") || "NULL"}) GROUP BY 1, 2, 3, 4`,
          ids,
        )) {
          const { unit, factor } = foodbUnit(r.u, r.e);
          const key = compoundKey(r.id, unit);
          if (!acc.has(r.k)) acc.set(r.k, new Map());
          const a = acc.get(r.k)!.get(key);
          if (a) {
            a.n += r.n;
            a.s += r.s * factor;
            a.lo = Math.min(a.lo, r.lo * factor);
            a.hi = Math.max(a.hi, r.hi * factor);
          } else acc.get(r.k)!.set(key, { n: r.n, s: r.s * factor, lo: r.lo * factor, hi: r.hi * factor });
        }
        for (const [k, cells] of acc) {
          const row = out.get(Number(k));
          if (!row) continue;
          for (const [key, a] of cells) row[key] = round(countMode ? a.n : ctx.f.agg === "min" ? a.lo : ctx.f.agg === "max" ? a.hi : a.s / a.n);
        }
      }
      const push = (m: Map<number, string[]>, k: number, s: string) => {
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(s);
      };
      const counts = new Map<number, string[]>();
      for (const r of qIn<{ k: number; t: string; n: number; qn: number }>(
        ctx,
        `SELECT food_id AS k, source_type AS t, COUNT(*) AS n, COUNT(standard_content) AS qn FROM Content WHERE food_id IN (__IDS__) GROUP BY food_id, source_type`,
        ids,
      ))
        push(counts, Number(r.k), `${r.t} ${r.n} (${r.qn} quantified)`);
      for (const [id, items] of counts) out.get(id)!["r:content"] = items.join("; ");
      const cites = new Map<number, string[]>();
      for (const r of qIn<{ k: number; c: string | null; n: number }>(
        ctx,
        `SELECT food_id AS k, citation AS c, COUNT(*) AS n FROM Content WHERE food_id IN (__IDS__) AND source_type = 'Nutrient' GROUP BY food_id, citation ORDER BY food_id, n DESC`,
        ids,
      ))
        push(cites, Number(r.k), `${r.c ?? "(no citation)"} (${r.n})`);
      for (const [id, items] of cites) out.get(id)!["r:citations"] = joinCompact(items, ctx.f.full, 4);
      if (ctx.has("FoodTaxonomy")) {
        const tax = new Map<number, string[]>();
        for (const r of qIn<{ k: number; c: string }>(
          ctx,
          `SELECT food_id AS k, classification_name AS c FROM FoodTaxonomy WHERE food_id IN (__IDS__) ORDER BY food_id, classification_order`,
          ids,
        ))
          push(tax, Number(r.k), r.c);
        for (const [id, items] of tax) out.get(id)!["r:taxonomy"] = items.join(" > ");
      }
      return rows;
    },
    docs: () => ({
      mainFood: `Food rows (${rowCount(ctx.info, "Food")}).`,
      identity: [
        ["Major Category", "Food.food_group"],
        ["Sub-Category", "Food.food_subgroup"],
        ["Base / Variant", "split of Food.name (first comma; most FooDB names have none)"],
        ["Notes / Serving Ideas", "Food.description"],
        ["Food ID", "Food.id"],
        ["Extras", "name_scientific, public_id (+ food_type, category, NCBI / ITIS ids, Wikipedia as optional columns)"],
      ],
      values:
        mode === "nutrients"
          ? `Content.standard_content (mg/100 g; energy kcal/100 g) for source_type = 'Nutrient', joined to Nutrient on Content.source_id. FooDB often has several rows per food × nutrient (from DUKE, DTU, USDA ...); the cell shows their ${countMode ? "count" : ctx.f.agg === "avg" ? "average" : ctx.f.agg + "imum"}. Energy: FooDB stores part of its energy rows in kJ under a kcal or 'mg/100 g' label (standard_content = 4.184 × orig_content, and the DTU rows labelled 'mg/100 g'); these are divided by 4.184 before aggregating, so energy is always kcal/100 g.`
          : `Content.standard_content for source_type = 'Compound', one column per compound × real unit (Content.orig_unit): mass per mass is converted exactly to mg/100 g (mg/kg ÷ 10, µg/g ÷ 10, g/kg × 100, µg/100 g ÷ 1000); per dry weight, per litre, molar (µM, µmol/g) and other units (IU, RE, NE, α-TE, ppb, kcal ...) keep their own column and are never averaged with mg. Limited to the ${TOP} compounds quantified in the most foods (${
              ctx.has("_compound_rank") ? "precomputed in _compound_rank by `npm run ingest -- prep foodb`" : "computed on first use; `npm run ingest -- prep foodb` precomputes it"
            }). Most of the 5M compound rows are presence-only (no standard_content); they are counted in 'Content rows'. Several rows per food × compound are aggregated (${ctx.f.agg}).`,
      split: SPLIT_DOC,
      related: related.map((r) => `${r.label}: ${r.title ?? ""}`),
      notes: ["Values stay as FooDB reports them (apart from the unit handling above); FooDB's own sources are not reconciled, only aggregated per cell as chosen."],
    }),
  };
}

/* ------------------------------------------------------------------ Frida (DTU) */

export function fridaUnit(u: unknown): string | null {
  if (u === null || u === undefined) return null;
  const s = String(u).trim();
  if (!s || /^no unit$/i.test(s)) return null;
  let m = s.match(/^(.*?)\s*\/\s*100\s*g$/i);
  if (m) return m[1];
  m = s.match(/^([^()]+?)\s*\(([^)]*?)\s*\/\s*100\s*g\)$/i);
  if (m) return `${m[2]} ${m[1]}`;
  if (/^alfa-TE$/i.test(s)) return "mg α-TE";
  if (s === "NE") return "mg NE";
  return s;
}

export function fridaSpec(ctx: Ctx): Spec {
  const groups = ctx.memo("groups", () => {
    const m = new Map<string, { name: string; parentId: string; parentName: string; level: number }>();
    for (const g of q(ctx, `SELECT * FROM FoodGroup`))
      m.set(String(g.FoodGroupID), {
        name: String(g.FoodGroupName ?? "").trim(),
        parentId: String(g.ParantFoodGroupID),
        parentName: String(g.ParantFoodGroupName ?? "").trim(),
        level: Number(g.Hieraky),
      });
    return m;
  });
  const majorOf = (gid: unknown): { id: string; name: string } | null => {
    const g = groups.get(String(gid));
    if (!g) return null;
    return g.level >= 3 ? { id: g.parentId, name: g.parentName } : { id: String(gid), name: g.name };
  };
  const subOf = (gid: unknown): string | null => {
    const g = groups.get(String(gid));
    return g && g.level >= 3 ? g.name : null;
  };
  const I = (col: string, label: string, optional = false): Column => ({ key: `x:${col}`, label, kind: "identity", optional, title: `Food.${col}` });
  const extras: Column[] = [
    I("FødevareNavn", "Danish name (FødevareNavn)"),
    I("TaxonomicName", "Taxonomic name", true),
    I("FoodEx2Code", "FoodEx2 code", true),
    I("FoodEx2Description", "FoodEx2 description", true),
    I("LangualCode", "LanguaL code", true),
    I("NCBI", "NCBI", true),
    I("FoodOntology", "Food ontology", true),
    I("Nøglehulsmærket", "Keyhole label (Nøglehulsmærket)", true),
    I("EurofirFoodGroup", "EuroFIR food group", true),
  ];
  const related: Column[] = [
    { key: "r:sources", label: "Sources", kind: "related", title: "distinct Data_Normalised.Source (→ Source.SourceID)" },
    { key: "r:ranges", label: "Values with min/max", kind: "related", optional: true, title: "Data_Normalised rows of the food with Min or Max" },
  ];
  const nutrientCols = () =>
    ctx.memo("ncols", () => {
      const used = new Set(q<{ p: unknown }>(ctx, `SELECT DISTINCT ParameterID AS p FROM Data_Normalised`).map((r) => String(r.p)));
      const seen = new Set<string>();
      const cols: Column[] = [];
      for (const p of q(ctx, `SELECT ParameterID, ParameterName, Unit FROM Parameter ORDER BY SortKey`)) {
        const id = String(p.ParameterID);
        if (seen.has(id) || !used.has(id)) continue;
        seen.add(id);
        const unit = fridaUnit(p.Unit);
        cols.push({ key: `n:${id}`, label: withUnit(String(p.ParameterName), unit), kind: "nutrient", unit, title: `ParameterID ${id}; unit in the source: ${p.Unit ?? "-"}` });
      }
      return finishNutrients(cols);
    });
  return {
    table: "Food",
    orderBy: "f.FoodName COLLATE NOCASE, f.FoodID",
    categories: () =>
      ctx.memo("cats", () => {
        const counts = q<{ g: unknown; n: number }>(ctx, `SELECT FoodGroupID AS g, COUNT(*) AS n FROM Food GROUP BY 1`);
        const majors = new Map<string, Option>();
        const subs: Option[] = [];
        for (const c of counts) {
          const m = majorOf(c.g);
          if (!m) continue;
          const o = majors.get(m.id) ?? { value: m.id, label: m.name, count: 0 };
          o.count = (o.count ?? 0) + c.n;
          majors.set(m.id, o);
          const s = subOf(c.g);
          if (s) subs.push({ value: String(c.g), label: s, count: c.n, parent: m.id });
        }
        return {
          cats: [...majors.values()].sort((a, b) => collator.compare(a.label, b.label)),
          subs: subs.sort((a, b) => collator.compare(a.label, b.label)),
        };
      }),
    where: () => {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (ctx.f.cat) {
        const ids = [...groups.keys()].filter((g) => majorOf(g)?.id === ctx.f.cat).map(Number);
        clauses.push(`f.FoodGroupID IN (${ids.length ? ids.join(",") : "NULL"})`);
      }
      if (ctx.f.sub) {
        clauses.push("f.FoodGroupID IN (?, ?)");
        params.push(...eqParams(ctx.f.sub));
      }
      if (ctx.f.q) {
        const l = like(ctx.f.q);
        clauses.push(`(${[LIKE("f.FoodName"), LIKE('f."FødevareNavn"'), LIKE("f.FoodGroup"), LIKE("f.TaxonomicName"), "CAST(f.FoodID AS TEXT) = ?"].join(" OR ")})`);
        params.push(l, l, l, l, ctx.f.q);
      }
      return { clauses, params };
    },
    unfilteredTotal: () => rowCount(ctx.info, "Food"),
    columns: () => [...identityColumns(extras), ...nutrientCols(), ...related],
    rows: (_c, rowids) => {
      const foods = byRowids(ctx, "Food", rowids);
      const out = new Map<string, Row>();
      const rows = foods.map((f) => {
        const r = ident({}, { id: f.FoodID, name: f.FoodName, cat: majorOf(f.FoodGroupID)?.name ?? f.FoodGroup, sub: subOf(f.FoodGroupID) });
        // The Frida workbook writes empty cells as the literal text "NULL".
        for (const e of extras) r[e.key] = f[e.key.slice(2)] === "NULL" ? null : val(f[e.key.slice(2)]);
        out.set(String(f.FoodID), r);
        return r;
      });
      const ids = foods.map((f) => f.FoodID as number);
      if (!ids.length) return rows;
      const srcs = new Map<string, Set<string>>();
      const ranges = new Map<string, number>();
      for (const r of qIn(ctx, `SELECT FoodID, ParameterID, ResVal, Min, Max, Source FROM Data_Normalised WHERE FoodID IN (__IDS__)`, ids)) {
        const id = String(r.FoodID);
        const row = out.get(id);
        if (!row) continue;
        const k = `n:${r.ParameterID}`;
        if (row[k] === undefined || row[k] === null) row[k] = val(r.ResVal);
        if (r.Source !== null && r.Source !== undefined && r.Source !== "") {
          if (!srcs.has(id)) srcs.set(id, new Set());
          srcs.get(id)!.add(String(r.Source));
        }
        if ((r.Min !== null && r.Min !== undefined) || (r.Max !== null && r.Max !== undefined)) ranges.set(id, (ranges.get(id) ?? 0) + 1);
      }
      for (const [id, s] of srcs) out.get(id)!["r:sources"] = `${s.size}: ${joinCompact([...s], ctx.f.full, 8)}`;
      for (const [id, n] of ranges) out.get(id)!["r:ranges"] = n;
      return rows;
    },
    docs: () => ({
      mainFood: `Food rows (${rowCount(ctx.info, "Food")}). Data_Table holds the same foods in wide form (1:1) and is not repeated.`,
      identity: [
        ["Major Category", "the parent of the food's group: Food.FoodGroupID → FoodGroup (level 3) → ParantFoodGroupName (level 2)"],
        ["Sub-Category", "FoodGroup.FoodGroupName of Food.FoodGroupID (level 3)"],
        ["Base / Variant", "split of Food.FoodName (first comma)"],
        ["Notes / Serving Ideas", "- (Frida has no notes field)"],
        ["Food ID", "Food.FoodID"],
        ["Extras", "Danish name (+ optional taxonomic name, FoodEx2 code / description, LanguaL, NCBI, ontology, keyhole label, EuroFIR group); the workbook's literal \"NULL\" is shown as -"],
      ],
      values: `Data_Normalised.ResVal pivoted by ParameterID, labelled with Parameter.ParameterName and Parameter.Unit without '/100g' ('RE (µg/100g)' → 'µg RE', 'alfa-TE' → 'mg α-TE', 'NE' → 'mg NE'). ${BASIS_100G}`,
      split: SPLIT_DOC,
      related: related.map((r) => `${r.label}: ${r.title ?? ""}`),
      notes: ["ParameterID 344 (Isomalt) is listed twice in Parameter; it gets one column."],
    }),
  };
}
