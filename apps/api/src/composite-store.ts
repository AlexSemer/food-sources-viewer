/**
 * NUTRI store (docs/store-schema.md): composite view and food-page rows for one preset (= one food/amount table
 * pair, ?preset=). The grid is a view over the long amount table, pivoted per page at request time; nothing wide is
 * stored. One column per ticket (nutrient_id × expression, plus the code where one nutrient has several tickets with
 * the same expression), the unit in the header, one cell per amount row: never averaged, empty stays empty.
 */
import { presetOf, type SourcePreset } from "@fsv/shared";
import { all, httpError, qi, rowCount, type DbInfo } from "./db.ts";
import {
  byRowids,
  collator,
  ident,
  identityColumns,
  like,
  LIKE,
  q,
  qIn,
  round,
  SPLIT_DOC,
  unitSymbol,
  val,
  withUnit,
  type Column,
  type Ctx,
  type Spec,
} from "./composite-specs.ts";

type Ticket = {
  code: string;
  expression: string;
  nutrient_id: string | null;
  compound_id: string | null;
  units: string | null;
  rows: number;
  vals: number;
  nutrient_name: string | null;
  nutrient_order: number | null;
  source_name: string | null;
};

const ticketKey = (code: unknown, expression: unknown) => `t:${code}|${expression ?? ""}`;

export function storePreset(ctx: Ctx): SourcePreset {
  const p = presetOf(ctx.source, ctx.f.preset);
  if (!p) throw httpError(400, `unknown preset: ${ctx.f.preset}`);
  if (!ctx.has(p.foodTable) || !ctx.has(p.amountTable)) throw httpError(404, `${p.foodTable} / ${p.amountTable} are not in ${ctx.source.dbFile} yet`);
  return p;
}

export function storeSpec(ctx: Ctx): Spec {
  const p = storePreset(ctx);
  const F = qi(p.foodTable);
  const A = qi(p.amountTable);
  const ID = p.foodIdField;
  const mode = ctx.f.mode === "compounds" ? "compounds" : "nutrients";
  const tickets = () =>
    ctx.memo(`${p.id}:tickets`, () =>
      q<Ticket>(
        ctx,
        `SELECT a.code, a.expression, a.nutrient_id, a.compound_id, GROUP_CONCAT(DISTINCT a.amount_unit) AS units, COUNT(*) AS rows, COUNT(a.amount) AS vals,
           n.name AS nutrient_name, n.rowid AS nutrient_order,
           (SELECT c.source_name FROM nutrient_code c WHERE c.family = ? AND c.source_version = ? AND c.code = a.code AND c.expression = a.expression LIMIT 1) AS source_name
         FROM ${A} a LEFT JOIN nutrient n ON n.id = a.nutrient_id
         GROUP BY a.code, a.expression, a.nutrient_id, a.compound_id`,
        p.family,
        p.codeVersion,
      ),
    );
  const isHeadline = (t: Ticket) => {
    const h = t.nutrient_id ? p.headlines?.[t.nutrient_id] : undefined;
    return !!h && h.code === t.code && h.expression === t.expression;
  };
  const valueCols = (): Column[] => {
    const list = tickets().filter((t) => (mode === "nutrients" ? t.nutrient_id !== null : t.compound_id !== null));
    // Several tickets of one nutrient with the same expression (USDA 205 / 205.2, 208 kcal / 268 kJ) keep the code in the label.
    const same = new Map<string, number>();
    for (const t of list) same.set(`${t.nutrient_id ?? t.compound_id}|${t.expression}`, (same.get(`${t.nutrient_id ?? t.compound_id}|${t.expression}`) ?? 0) + 1);
    const cols = list.map((t) => {
      const unit = (t.units ?? "").split(",").filter(Boolean).map(unitSymbol).join(" / ") || null;
      const head = isHeadline(t);
      const base =
        mode === "nutrients"
          ? `${t.nutrient_name ?? t.nutrient_id}${t.expression ? ` · ${t.expression}` : ""}${(same.get(`${t.nutrient_id}|${t.expression}`) ?? 0) > 1 ? ` [${t.code}]` : ""}${head ? " ★" : ""}`
          : `${t.source_name ?? t.compound_id}${t.expression ? ` · ${t.expression}` : ""}`;
      const title = [
        `${p.family} ${t.code}${t.expression ? `, expression ${t.expression}` : ""}`,
        mode === "nutrients" ? `nutrient_id ${t.nutrient_id}` : `compound_id ${t.compound_id}`,
        t.source_name ? `map: ${t.source_name}` : "",
        head ? "headline ticket for this nutrient (HEADLINES.md)" : "",
        `${t.vals} values, ${t.rows - t.vals} rows without an amount`,
      ]
        .filter(Boolean)
        .join("; ");
      return { col: { key: ticketKey(t.code, t.expression), label: withUnit(base, unit), kind: "nutrient" as const, unit, title }, t, head };
    });
    cols.sort(
      (a, b) =>
        (mode === "nutrients" ? (a.t.nutrient_order ?? 1e9) - (b.t.nutrient_order ?? 1e9) : collator.compare(a.col.label, b.col.label)) ||
        Number(b.head) - Number(a.head) ||
        collator.compare(a.t.expression, b.t.expression) ||
        collator.compare(a.t.code, b.t.code),
    );
    return cols.map((c) => c.col);
  };
  const I = (col: string, label: string, optional = false): Column => ({ key: `x:${col}`, label, kind: "identity", optional, title: `${p.foodTable}.${col}` });
  const extras: Column[] = [
    I("group_code", "group_code"),
    I("name_local", "name_local", true),
    I("n_factor", "n_factor"),
    I("edible_1", "edible_1", true),
    I("edible_2", "edible_2", true),
    I("waste_pct", "waste_pct", true),
  ];
  const related: Column[] = [
    { key: "r:rows", label: "Amount rows", kind: "related", title: `${p.amountTable} rows of the food: nutrient / compound / empty (is_empty)` },
  ];
  return {
    table: p.foodTable,
    orderBy: `f.name COLLATE NOCASE, f.${qi(ID)}`,
    modes: [
      { value: "nutrients", label: "Nutrients (intake list, nutrient_id × expression)" },
      { value: "compounds", label: "Compounds (composition view, compound_id)" },
    ],
    categories: () =>
      ctx.memo(`${p.id}:cats`, () => ({
        cats: q<{ v: string; n: number }>(ctx, `SELECT group_code AS v, COUNT(*) AS n FROM ${F} WHERE group_code IS NOT NULL GROUP BY 1`)
          .map((r) => ({ value: String(r.v), label: String(r.v), count: r.n }))
          .sort((a, b) => collator.compare(a.label, b.label)),
        subs: [],
        note: `Category = ${p.foodTable}.group_code as published (codes only; no names in the store).`,
      })),
    where: () => {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (ctx.f.cat) {
        clauses.push("f.group_code = ?");
        params.push(ctx.f.cat);
      }
      if (ctx.f.q) {
        const l = like(ctx.f.q);
        clauses.push(`(${[LIKE("f.name"), LIKE("f.name_local"), `CAST(f.${qi(ID)} AS TEXT) = ?`].join(" OR ")})`);
        params.push(l, l, ctx.f.q);
      }
      return { clauses, params };
    },
    unfilteredTotal: () => rowCount(ctx.info, p.foodTable),
    columns: () => [...identityColumns(extras), ...valueCols(), ...related],
    rows: (_c, rowids) => {
      const foods = byRowids(ctx, p.foodTable, rowids);
      const out = new Map<string, Record<string, ReturnType<typeof val>>>();
      const rows = foods.map((f) => {
        const r = ident({}, { id: f[ID], name: f.name, cat: f.group_code });
        for (const e of extras) r[e.key] = val(f[e.key.slice(2)]);
        out.set(String(f[ID]), r);
        return r;
      });
      const ids = foods.map((f) => f[ID] as string | number);
      if (!ids.length) return rows;
      const which = mode === "nutrients" ? "nutrient_id" : "compound_id";
      for (const a of qIn<{ k: unknown; code: string; expression: string; amount: number | null; is_empty: number; footnote: string | null }>(
        ctx,
        `SELECT ${qi(ID)} AS k, code, expression, amount, is_empty, footnote FROM ${A} WHERE ${qi(ID)} IN (__IDS__) AND ${which} IS NOT NULL`,
        ids,
      )) {
        const row = out.get(String(a.k));
        if (!row) continue;
        // One amount row per cell (unique key). No amount: blank cells stay empty, a flag like 'tr' is shown as is.
        row[ticketKey(a.code, a.expression)] = a.amount !== null ? round(a.amount) : a.is_empty ? null : val(a.footnote);
      }
      for (const r of qIn<{ k: unknown; n: number; nn: number; nc: number; ne: number }>(
        ctx,
        `SELECT ${qi(ID)} AS k, COUNT(*) AS n, COUNT(nutrient_id) AS nn, COUNT(compound_id) AS nc, SUM(is_empty) AS ne FROM ${A} WHERE ${qi(ID)} IN (__IDS__) GROUP BY 1`,
        ids,
      )) {
        const row = out.get(String(r.k));
        if (row) row["r:rows"] = `${r.n} (${r.nn} nutrient, ${r.nc} compound${r.ne ? `, ${r.ne} empty` : ""})`;
      }
      return rows;
    },
    docs: () => ({
      mainFood: `${p.foodTable} rows (${rowCount(ctx.info, p.foodTable)}), preset ${p.id} (${p.label}). The dropdown only switches which food/amount table pair is read; datasets are never mixed.`,
      identity: [
        ["Major Category", `${p.foodTable}.group_code`],
        ["Sub-Category", "-"],
        ["Base / Variant", `split of ${p.foodTable}.name (first comma)`],
        ["Food ID", `${p.foodTable}.${ID}`],
        ["Extras", "group_code, n_factor (+ name_local, edible_1/2, waste_pct as optional columns; empty where the schema has no source)"],
      ],
      values:
        mode === "nutrients"
          ? `${p.amountTable}.amount for rows with a nutrient_id, pivoted at request time. One column per ${p.family} ticket = nutrient × expression (the code is added when one nutrient has two tickets with the same expression, e.g. 205 / 205.2), unit as published in the header. One cell = one amount row; expressions are never averaged or converted (RE is not RAE). ★ marks the headline ticket per HEADLINES.md (energy, vit_a, vit_b9, vit_e); carbohydrate has none. A headline missing for a food is '-', not 0.`
          : `${p.amountTable}.amount for rows with a compound_id (map status compound), one column per ticket, unit as published. One cell = one amount row.`,
      split: SPLIT_DOC,
      related: related.map((r) => `${r.label}: ${r.title ?? ""}`),
      notes: ["Cells without an amount: a blank source cell (is_empty = 1) is '-'; a flagged cell without a number shows its flag (footnote, e.g. 'tr')."],
    }),
  };
}

/** Food page: every amount row of one food in the preset's amount table, with the nutrient / map names. */
export function storeFoodAmounts(info: DbInfo, p: SourcePreset, foodId: unknown) {
  if (!info.tables.has(p.amountTable)) throw httpError(404, `${p.amountTable} is not in the store yet`);
  const amounts = all(
    info.db.prepare(
      `SELECT a.code, a.code_alt, a.nutrient_id, a.compound_id, n.name AS nutrient_name, c.source_name, a.expression, a.amount, a.amount_unit, a.basis,
         a.is_empty, a.amount_canonical, a.canonical_unit, a.derivation, a.footnote, a.n, a.min, a.max, a.median, a.citation_id, a.method_text
       FROM ${qi(p.amountTable)} a
       LEFT JOIN nutrient n ON n.id = a.nutrient_id
       LEFT JOIN nutrient_code c ON c.family = ? AND c.source_version = ? AND c.code = a.code AND c.expression = a.expression
       WHERE a.${qi(p.foodIdField)} = ?
       ORDER BY a.nutrient_id IS NULL, n.rowid, a.expression, a.code`,
    ),
    p.family,
    p.codeVersion,
    foodId as string | number,
  );
  for (const a of amounts) {
    const h = a.nutrient_id ? p.headlines?.[String(a.nutrient_id)] : undefined;
    a.headline = h ? (h.code === a.code && h.expression === a.expression ? 1 : 0) : null;
  }
  return { amounts, raw: p.rawSourceId ? { sourceId: p.rawSourceId, foodId: String(foodId) } : undefined };
}
