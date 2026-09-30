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
  const nutrientCols = (): Column[] => {
    const cols =
      mode === "nutrients"
        ? q<{ id: number; name: string }>(ctx, `SELECT id, name FROM Nutrient`).map((n) => {
            const unit = /energy/i.test(n.name) ? "kcal" : "mg";
            return { key: `n:${n.id}`, name: n.name, unit, title: `Nutrient.id ${n.id}; Content.standard_content (${unit}/100 g)` };
          })
        : compoundRank().map((c) => ({ key: `n:${c.id}`, name: c.name ?? `Compound ${c.id}`, unit: "mg", title: `Compound.id ${c.id}; quantified in ${c.foods} foods` }));
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
      const srcType = mode === "nutrients" ? "Nutrient" : "Compound";
      const only = mode === "compounds" ? `AND source_id IN (${compoundRank().map((c) => Number(c.id)).join(",") || "NULL"})` : "";
      for (const r of qIn<{ k: number; n: number; v: unknown }>(
        ctx,
        `SELECT food_id AS k, source_id AS n, ${aggFn}(standard_content) AS v FROM Content
         WHERE food_id IN (__IDS__) AND source_type = ? AND standard_content IS NOT NULL ${only} GROUP BY food_id, source_id`,
        ids,
        srcType,
      )) {
        const row = out.get(Number(r.k));
        if (row) row[`n:${r.n}`] = round(r.v);
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
          ? `Content.standard_content (mg/100 g; energy kcal/100 g) for source_type = 'Nutrient', joined to Nutrient on Content.source_id. FooDB often has several rows per food × nutrient (from DUKE, DTU, USDA ...); the cell shows their ${countMode ? "count" : ctx.f.agg === "avg" ? "average" : ctx.f.agg + "imum"}.`
          : `Content.standard_content (mg/100 g) for source_type = 'Compound', limited to the ${TOP} compounds quantified in the most foods (${
              ctx.has("_compound_rank") ? "precomputed in _compound_rank by `npm run ingest -- prep foodb`" : "computed on first use; `npm run ingest -- prep foodb` precomputes it"
            }). Most of the 5M compound rows are presence-only (no standard_content); they are counted in 'Content rows'. Several rows per food × compound are aggregated (${ctx.f.agg}).`,
      split: SPLIT_DOC,
      related: related.map((r) => `${r.label}: ${r.title ?? ""}`),
      notes: ["Values stay as FooDB reports them; FooDB's own sources are not reconciled, only aggregated per cell as chosen."],
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
