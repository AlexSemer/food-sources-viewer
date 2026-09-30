/** Composite definition for the USDA FoodData Central downloads (Foundation, SR Legacy, FNDDS, Branded, Full). */
import { eqParams, rowCount } from "./db.ts";
import {
  BASIS_100G,
  byRowids,
  collator,
  fmtNum,
  ident,
  identityColumns,
  joinCompact,
  like,
  LIKE,
  ph,
  q,
  qIn,
  SPLIT_DOC,
  unitSymbol,
  val,
  withUnit,
  finishNutrients,
  type Column,
  type Ctx,
  type Row,
  type Spec,
  type Where,
} from "./composite-specs.ts";

/** Data types that are analytical inputs of other foods rather than foods in their own right. */
const NON_MAIN_TYPE = /sample|acqui|agricultural/;

const BRANDED_FIELDS = [
  "brand_owner",
  "brand_name",
  "subbrand_name",
  "gtin_upc",
  "ingredients",
  "not_a_significant_source_of",
  "package_weight",
  "market_country",
  "data_source",
  "preparation_state_code",
  "trade_channel",
  "short_description",
  "modified_date",
  "available_date",
  "discontinued_date",
];

function portionText(p: Record<string, unknown>, unitName: string | null): string {
  const parts = [
    p.amount !== null && p.amount !== undefined && p.amount !== "" ? fmtNum(p.amount) : "",
    unitName && !/^undetermined$/i.test(unitName) ? unitName : "",
    p.portion_description ? String(p.portion_description) : "",
    p.modifier !== null && p.modifier !== undefined && !/^\d+$/.test(String(p.modifier)) ? String(p.modifier) : "",
  ].filter(Boolean);
  const g = p.gram_weight !== null && p.gram_weight !== undefined && p.gram_weight !== "" ? `${fmtNum(p.gram_weight)} g` : "";
  return `${parts.join(" ") || "portion"}${g ? ` = ${g}` : ""}`;
}

export function usdaSpec(ctx: Ctx): Spec {
  const has = ctx.has;
  const large = rowCount(ctx.info, "food") > 300_000;
  const typeRows = ctx.memo("types", () =>
    q<{ t: string; n: number }>(ctx, `SELECT data_type AS t, COUNT(*) AS n FROM food GROUP BY data_type ORDER BY n DESC`),
  );
  const present = typeRows.map((r) => r.t);
  const multi = present.length > 1;
  const mains = present.filter((t) => !NON_MAIN_TYPE.test(t));
  const regDefault = ctx.source.foodTypeDefault;
  const typeDefault = regDefault && regDefault !== "all" && present.includes(regDefault) ? regDefault : multi ? "main" : (present[0] ?? "all");
  const wanted = ctx.f.type;
  const type = !multi ? "all" : wanted && (wanted === "main" || wanted === "all" || present.includes(wanted)) ? wanted : typeDefault;

  // Where the category lives: food.food_category_id (food_category / WWEIA ids, or the branded category text
  // in the full download) or, in the branded-only download, branded_food.branded_food_category.
  const brandedCats = ctx.memo(
    "brandedCats",
    () => has("branded_food") && !ctx.db.prepare(`SELECT 1 FROM food WHERE food_category_id IS NOT NULL LIMIT 1`).get(),
  );
  const catColText = ctx.memo("catColText", () =>
    /TEXT|CHAR|CLOB/i.test(
      (ctx.db.prepare(`SELECT type FROM pragma_table_info('food') WHERE name = 'food_category_id'`).get() as { type?: string } | undefined)?.type ?? "",
    ),
  );
  const catLabels = ctx.memo("catLabels", () => {
    const m = new Map<string, string>();
    if (has("wweia_food_category"))
      for (const r of q<{ k: unknown; d: string }>(ctx, `SELECT wweia_food_category AS k, wweia_food_category_description AS d FROM wweia_food_category`))
        m.set(String(Number(r.k)), r.d);
    if (has("food_category")) for (const r of q<{ k: unknown; d: string }>(ctx, `SELECT id AS k, description AS d FROM food_category`)) m.set(String(Number(r.k)), r.d);
    return m;
  });
  const catLabel = (v: unknown) => {
    if (v === null || v === undefined || v === "") return null;
    const s = String(v);
    return (/^\d+$/.test(s) ? catLabels.get(String(Number(s))) : undefined) ?? s;
  };

  const typeClause = (): Where => {
    if (!multi || type === "all") return { clauses: [], params: [] };
    if (type === "main") return { clauses: [`+f.data_type IN (${ph(mains.length)})`], params: mains };
    return { clauses: ["f.data_type = ?"], params: [type] };
  };

  const categories = () =>
    ctx.memo(`cats:${large ? "all" : type}`, () => {
      let rows: { v: unknown; n: number }[];
      if (brandedCats) {
        rows = q(ctx, `SELECT branded_food_category AS v, COUNT(*) AS n FROM branded_food WHERE branded_food_category IS NOT NULL GROUP BY 1`);
      } else {
        // Large dbs: counts over all data types (one index scan, cached); small dbs: within the selected type.
        const tw = large ? { clauses: [], params: [] } : typeClause();
        rows = q(
          ctx,
          `SELECT food_category_id AS v, COUNT(*) AS n FROM food f WHERE ${["f.food_category_id IS NOT NULL", ...tw.clauses].join(" AND ")} GROUP BY 1`,
          ...tw.params,
        );
      }
      return rows
        .map((r) => ({ value: String(r.v), label: catLabel(r.v) ?? String(r.v), count: r.n }))
        .sort((a, b) => collator.compare(a.label, b.label));
    });

  const nutrientCols = () =>
    ctx.memo("ncols", () => {
      if (!has("food_nutrient") || !has("nutrient")) return [] as Column[];
      const nut = q<{ id: number; name: string; unit_name: string; nutrient_nbr: unknown }>(ctx, `SELECT id, name, unit_name, nutrient_nbr FROM nutrient`);
      const byId = new Map(nut.map((n) => [String(n.id), n]));
      const byNbr = new Map(nut.filter((n) => n.nutrient_nbr !== null && n.nutrient_nbr !== "").map((n) => [String(Number(n.nutrient_nbr)), n]));
      let used: { id: unknown; n: number | null }[];
      if (has("_composite_nutrients")) used = q(ctx, `SELECT nutrient_id AS id, n_values AS n FROM _composite_nutrients`);
      else if (rowCount(ctx.info, "food_nutrient") <= 3_000_000)
        used = q(ctx, `SELECT nutrient_id AS id, COUNT(*) AS n FROM food_nutrient GROUP BY 1`);
      else used = nut.map((n) => ({ id: n.id, n: null }));
      return finishNutrients(
        used.map((u) => {
          const n = byId.get(String(u.id)) ?? byNbr.get(String(Number(u.id)));
          const unit = unitSymbol(n?.unit_name);
          return {
            key: `n:${u.id}`,
            label: n ? withUnit(n.name, unit) : `nutrient_id ${u.id}`,
            kind: "nutrient" as const,
            unit,
            title: `food_nutrient.nutrient_id = ${u.id}${n && String(n.id) !== String(u.id) ? ` (nutrient_nbr → nutrient.id ${n.id})` : ""}${u.n !== null && u.n !== undefined ? ` · ${u.n} values` : ""}`,
          };
        }),
      );
    });

  const hasBranded = has("branded_food");
  const I = (key: string, label: string, optional = false): Column => ({ key, label, kind: "identity", optional });
  const extras: Column[] = [
    // Only informative when several data types are shown at once.
    I("x:data_type", "Data type", !multi || !(type === "all" || type === "main")),
    ...(has("foundation_food") || has("sr_legacy_food") ? [I("x:ndb", "NDB number")] : []),
    ...(has("survey_fndds_food") ? [I("x:food_code", "FNDDS food code"), I("x:fndds_dates", "FNDDS start – end date", true)] : []),
    ...(hasBranded
      ? [
          I("x:brand_owner", "Brand owner"),
          I("x:brand_name", "Brand name"),
          I("x:subbrand_name", "Subbrand", true),
          I("x:gtin_upc", "GTIN / UPC"),
          I("x:ingredients", "Ingredients"),
          I("x:not_a_significant_source_of", "Not a significant source of", true),
          I("x:package_weight", "Package weight", true),
          I("x:market_country", "Market country", true),
          I("x:data_source", "Data source", true),
          I("x:preparation_state_code", "Preparation state", true),
          I("x:trade_channel", "Trade channel", true),
          I("x:short_description", "Short description", true),
          I("x:modified_date", "Modified date", true),
          I("x:available_date", "Available date", true),
          I("x:discontinued_date", "Discontinued date", true),
        ]
      : []),
    I("x:publication_date", "Publication date", true),
  ];
  const R = (key: string, label: string, title: string, optional = false): Column => ({ key, label, kind: "related", title, optional });
  const related: Column[] = [
    ...(has("food_portion") ? [R("r:portions", "Portions", "food_portion (+ measure_unit)")] : []),
    ...(has("food_attribute") ? [R("r:attributes", "Attributes", "food_attribute (+ food_attribute_type)")] : []),
    ...(has("input_food") ? [R("r:inputs", "Input foods / ingredients", "input_food (FNDDS: ingredients; Foundation: the sample foods averaged)")] : []),
    ...(has("food_nutrient_conversion_factor") ? [R("r:conv", "Conversion factors", "food_nutrient_conversion_factor + protein / calorie factors")] : []),
    ...(has("food_nutrient") ? [R("r:nutrient_rows", "Nutrient values (count)", "food_nutrient rows of the food", true)] : []),
  ];

  return {
    table: "food",
    orderBy: "f.description, f.fdc_id",
    large,
    types: multi
      ? () => ({
          label: "Data type",
          value: type,
          options: [
            { value: "main", label: `Main food types (${mains.join(", ")})`, count: typeRows.filter((r) => mains.includes(r.t)).reduce((a, r) => a + r.n, 0) },
            ...typeRows.map((r) => ({ value: r.t, label: r.t, count: r.n })),
            { value: "all", label: "All data types", count: typeRows.reduce((a, r) => a + r.n, 0) },
          ],
        })
      : undefined,
    categories: () => ({ cats: categories(), subs: [] }),
    where: () => {
      const w = typeClause();
      const clauses = [...w.clauses];
      const params = [...w.params];
      if (ctx.f.cat) {
        if (brandedCats) {
          clauses.push("f.fdc_id IN (SELECT fdc_id FROM branded_food WHERE branded_food_category = ?)");
          params.push(ctx.f.cat);
        } else if (catColText) {
          clauses.push("f.food_category_id = ?");
          params.push(ctx.f.cat);
        } else {
          clauses.push("f.food_category_id IN (?, ?)");
          params.push(...eqParams(ctx.f.cat));
        }
      }
      if (ctx.f.q) {
        const ors = [LIKE("f.description")];
        const ps: (string | number)[] = [like(ctx.f.q)];
        if (/^\d+$/.test(ctx.f.q)) {
          ors.push("f.fdc_id = ?");
          ps.push(Number(ctx.f.q));
        }
        if (!brandedCats && !large) {
          const ids = categories()
            .filter((c) => c.label.toLowerCase().includes(ctx.f.q.toLowerCase()))
            .map((c) => c.value)
            .slice(0, 200);
          if (ids.length) {
            ors.push(`f.food_category_id IN (${ph(ids.length * 2)})`);
            for (const id of ids) ps.push(...eqParams(id));
          }
        }
        clauses.push(`(${ors.join(" OR ")})`);
        params.push(...ps);
      } else {
        clauses.push("f.description > ''"); // lets SQLite walk the (description, fdc_id) index
      }
      return { clauses, params };
    },
    unfilteredTotal: () => {
      if (!multi || type === "all") return typeRows.reduce((a, r) => a + r.n, 0);
      if (type === "main") return typeRows.filter((r) => mains.includes(r.t)).reduce((a, r) => a + r.n, 0);
      return typeRows.find((r) => r.t === type)?.n ?? 0;
    },
    columns: () => [...identityColumns(extras), ...nutrientCols(), ...related],
    rows: (_c, rowids) => {
      const foods = byRowids(ctx, "food", rowids, "fdc_id, data_type, description, food_category_id, publication_date");
      const ids = foods.map((f) => Number(f.fdc_id));
      const out = new Map<number, Row>();
      const rows: Row[] = foods.map((f) => {
        const r = ident({}, { id: f.fdc_id, name: f.description, cat: brandedCats ? null : catLabel(f.food_category_id) });
        r["x:data_type"] = val(f.data_type);
        r["x:publication_date"] = val(f.publication_date);
        out.set(Number(f.fdc_id), r);
        return r;
      });
      if (!ids.length) return rows;
      const each = (sql: string, fn: (row: Row, rec: Record<string, unknown>) => void) => {
        for (const rec of qIn(ctx, sql, ids)) {
          const row = out.get(Number(rec.fdc_id));
          if (row) fn(row, rec);
        }
      };
      if (has("food_nutrient")) {
        const counts = new Map<number, number>();
        each(`SELECT fdc_id, nutrient_id, amount FROM food_nutrient WHERE fdc_id IN (__IDS__)`, (row, rec) => {
          const k = `n:${rec.nutrient_id}`;
          if (row[k] === undefined || row[k] === null) row[k] = val(rec.amount);
          counts.set(Number(rec.fdc_id), (counts.get(Number(rec.fdc_id)) ?? 0) + 1);
        });
        for (const [id, n] of counts) out.get(id)!["r:nutrient_rows"] = n;
      }
      if (has("foundation_food"))
        each(`SELECT fdc_id, NDB_number, footnote FROM foundation_food WHERE fdc_id IN (__IDS__)`, (row, rec) => {
          row["x:ndb"] = val(rec.NDB_number);
          row.notes = val(rec.footnote);
        });
      if (has("sr_legacy_food"))
        each(`SELECT fdc_id, NDB_number FROM sr_legacy_food WHERE fdc_id IN (__IDS__)`, (row, rec) => {
          row["x:ndb"] = row["x:ndb"] ?? val(rec.NDB_number);
        });
      if (has("survey_fndds_food"))
        each(`SELECT fdc_id, food_code, start_date, end_date FROM survey_fndds_food WHERE fdc_id IN (__IDS__)`, (row, rec) => {
          row["x:food_code"] = val(rec.food_code);
          row["x:fndds_dates"] = rec.start_date || rec.end_date ? `${rec.start_date ?? "?"} – ${rec.end_date ?? "?"}` : null;
        });
      if (hasBranded)
        each(`SELECT * FROM branded_food WHERE fdc_id IN (__IDS__)`, (row, rec) => {
          for (const k of BRANDED_FIELDS) row[`x:${k}`] = val(rec[k]);
          if (brandedCats || row.cat === null) row.cat = val(rec.branded_food_category);
          const serving = rec.serving_size !== null && rec.serving_size !== undefined && rec.serving_size !== "" ? `${fmtNum(rec.serving_size)} ${rec.serving_size_unit ?? ""}`.trim() : "";
          const hh = rec.household_serving_fulltext ? String(rec.household_serving_fulltext) : "";
          if (serving || hh) row.notes = `Serving: ${serving}${serving && hh ? ` (${hh})` : hh}`;
        });
      if (has("food_portion")) {
        const units = ctx.memo("measureUnits", () =>
          has("measure_unit") ? new Map(q<{ id: number; name: string }>(ctx, `SELECT id, name FROM measure_unit`).map((u) => [String(u.id), u.name])) : new Map<string, string>(),
        );
        const acc = new Map<number, string[]>();
        each(`SELECT * FROM food_portion WHERE fdc_id IN (__IDS__) ORDER BY fdc_id, seq_num, id`, (_row, rec) => {
          const id = Number(rec.fdc_id);
          if (!acc.has(id)) acc.set(id, []);
          acc.get(id)!.push(portionText(rec, units.get(String(rec.measure_unit_id)) ?? null));
        });
        for (const [id, items] of acc) out.get(id)!["r:portions"] = joinCompact(items, ctx.f.full);
      }
      if (has("food_attribute")) {
        const types = ctx.memo("attrTypes", () =>
          has("food_attribute_type")
            ? new Map(q<{ id: number; name: string }>(ctx, `SELECT id, name FROM food_attribute_type`).map((t) => [String(t.id), t.name]))
            : new Map<string, string>(),
        );
        const acc = new Map<number, string[]>();
        each(`SELECT * FROM food_attribute WHERE fdc_id IN (__IDS__) ORDER BY fdc_id, seq_num, id`, (_row, rec) => {
          const id = Number(rec.fdc_id);
          const label = (rec.name ? String(rec.name) : "") || types.get(String(rec.food_attribute_type_id)) || "attribute";
          if (!acc.has(id)) acc.set(id, []);
          acc.get(id)!.push(rec.value !== null && rec.value !== undefined && rec.value !== "" ? `${label}: ${rec.value}` : label);
        });
        for (const [id, items] of acc) out.get(id)!["r:attributes"] = joinCompact(items, ctx.f.full);
      }
      if (has("input_food")) {
        const cols = ctx.cols("input_food");
        const desc = ["ingredient_description", "sr_description"].find((c) => cols.includes(c));
        const acc = new Map<number, { items: string[]; refs: number }>();
        each(`SELECT * FROM input_food WHERE fdc_id IN (__IDS__) ORDER BY fdc_id, seq_num, id`, (_row, rec) => {
          const id = Number(rec.fdc_id);
          if (!acc.has(id)) acc.set(id, { items: [], refs: 0 });
          const a = acc.get(id)!;
          const d = desc && rec[desc] ? String(rec[desc]) : "";
          if (d) a.items.push(rec.gram_weight !== null && rec.gram_weight !== undefined && rec.gram_weight !== "" ? `${d} (${fmtNum(rec.gram_weight)} g)` : d);
          else a.refs++;
        });
        for (const [id, a] of acc) {
          const parts: string[] = [];
          if (a.items.length) parts.push(`${a.items.length}: ${joinCompact(a.items, ctx.f.full, 5)}`);
          if (a.refs) parts.push(`${a.refs} input/sample food${a.refs > 1 ? "s" : ""}`);
          out.get(id)!["r:inputs"] = parts.join("; ");
        }
      }
      if (has("food_nutrient_conversion_factor")) {
        const facs = qIn<{ id: number; fdc_id: number }>(ctx, `SELECT id, fdc_id FROM food_nutrient_conversion_factor WHERE fdc_id IN (__IDS__)`, ids);
        if (facs.length) {
          const acc = new Map<number, string[]>();
          const fid = new Map(facs.map((f) => [Number(f.id), Number(f.fdc_id)]));
          const push = (facId: number, s: string) => {
            const food = fid.get(facId);
            if (food === undefined) return;
            if (!acc.has(food)) acc.set(food, []);
            acc.get(food)!.push(s);
          };
          const facIds = [...fid.keys()];
          if (has("food_protein_conversion_factor"))
            for (const r of qIn(ctx, `SELECT * FROM food_protein_conversion_factor WHERE food_nutrient_conversion_factor_id IN (__IDS__)`, facIds))
              push(Number(r.food_nutrient_conversion_factor_id), `protein N×${fmtNum(r.value)}`);
          if (has("food_calorie_conversion_factor"))
            for (const r of qIn(ctx, `SELECT * FROM food_calorie_conversion_factor WHERE food_nutrient_conversion_factor_id IN (__IDS__)`, facIds))
              push(
                Number(r.food_nutrient_conversion_factor_id),
                `kcal/g protein ${fmtNum(r.protein_value)}, fat ${fmtNum(r.fat_value)}, carbohydrate ${fmtNum(r.carbohydrate_value)}`,
              );
          for (const [id, items] of acc) out.get(id)!["r:conv"] = items.join("; ");
        }
      }
      return rows;
    },
    docs: () => ({
      mainFood: multi
        ? `food rows of the selected data_type (default: ${
            typeDefault === "main" ? `the main types ${mains.join(", ")}; sample / sub-sample / acquisition rows are excluded but selectable` : typeDefault
          }). The sample, sub-sample and acquisition rows are the analytical inputs of Foundation foods; each Foundation food's count of them is in 'Input foods / ingredients'.`
        : `food rows (data_type ${present[0] ?? "-"}).`,
      identity: [
        [
          "Major Category",
          brandedCats
            ? "branded_food.branded_food_category"
            : has("wweia_food_category") && !has("food_category")
              ? "food.food_category_id → wweia_food_category (WWEIA category)"
              : has("wweia_food_category")
                ? "food.food_category_id → food_category.description, → wweia_food_category for FNDDS rows, or the branded category text stored there for branded rows"
                : "food.food_category_id → food_category.description",
        ],
        ["Sub-Category", "- (FoodData Central has a single category level)"],
        ["Base / Variant", "split of food.description (first comma)"],
        [
          "Notes / Serving Ideas",
          [has("foundation_food") && "foundation_food.footnote", hasBranded && "branded_food serving_size + unit (household_serving_fulltext)"].filter(Boolean).join("; ") || "-",
        ],
        ["Food ID", "food.fdc_id"],
        ["Extras", "data type, NDB number (foundation_food / sr_legacy_food), FNDDS food code, branded brand / GTIN / ingredients"],
      ],
      values: `food_nutrient.amount pivoted by nutrient_id, labelled with nutrient.name (nutrient.unit_name). ${
        has("wweia_food_category") ? "FNDDS stores the legacy nutrient_nbr in food_nutrient.nutrient_id; it is resolved via nutrient.nutrient_nbr. " : ""
      }${BASIS_100G}`,
      split: SPLIT_DOC,
      related: related.map((r) => `${r.label}: ${r.title ?? ""}`),
      notes: [
        "Portions: amount + measure unit (unless 'undetermined') + portion description + modifier = gram weight.",
        ...(has("food_nutrient") && rowCount(ctx.info, "food_nutrient") > 3_000_000 && !has("_composite_nutrients")
          ? [`The nutrient column list is the whole nutrient table; run \`npm run ingest -- prep ${ctx.sourceId}\` to list only the nutrients in use.`]
          : []),
      ],
    }),
  };
}
