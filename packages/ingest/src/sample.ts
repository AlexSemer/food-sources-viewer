/**
 * Sample databases for the online demo (Vercel):
 *
 *   npm run sample [source-id...]      (default: every id in SAMPLE_SOURCE_IDS)
 *
 * Writes a cut-down copy of each sampled source to data-sample/<dbFile> (committed; data/ is never written):
 *  - the first SAMPLE_FOODS_PER_SOURCE main foods of the source (rowid order of its main food table), and only
 *    the rows of the other tables that belong to those foods, following the same joins the viewer uses
 *    (docs in each PLANS entry below);
 *  - lookup / dictionary tables in full (they are small), or only the referenced rows where they are not;
 *  - the source's own schema and indexes, `_meta` with corrected `counts` plus sample_* keys;
 *  - the composite helpers (`npm run ingest -- prep`) recomputed on the sample, and the relationship map
 *    precomputed into data-sample/_relations/<id>.json, because the deployed API cannot write.
 * The source db is attached read-only (`mode=ro`).
 */
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { getSource, SAMPLE_FOODS_PER_SOURCE, SAMPLE_SOURCE_IDS, type SourceDef } from "@fsv/shared";
import { discoverRelations } from "@fsv/shared/relations";
import { dataRoot, repoRoot } from "./paths.ts";
import { prepareComposite } from "./compositePrep.ts";
import { qi } from "./db.ts";

export const sampleRoot = join(repoRoot, "data-sample");

const N = SAMPLE_FOODS_PER_SOURCE;

/** FooDB: quantified Content rows kept per food × compound (FooDB repeats a compound up to ~400 times per food). */
const FOODB_MAX_ROWS_PER_COMPOUND = 5;

/** GitHub warns at 50 MB per file; stay well below. */
const MAX_FILE_MB = 45;

/**
 * Per table: a WHERE clause on the source table (unqualified columns are the source table's), or null to leave
 * the table out. Tables not listed are copied in full. Temp key tables (k_main = the sampled main foods) are
 * created by `keys` first.
 */
type Plan = {
  keys: (db: DatabaseSync) => void;
  tables: Record<string, string | null>;
  note: string;
};

const IN = (col: string, keyTable: string) => `${qi(col)} IN (SELECT id FROM ${keyTable})`;

/** Composite helpers and planner stats are rebuilt on the sample, never copied. */
const ALWAYS_SKIP = new Set(["sqlite_stat1", "sqlite_stat4", "_composite_nutrients", "_compound_rank"]);

/** First N Foundation foods (food rows with data_type foundation_food, rowid order); shared by usda-foundation and store. */
function usdaFoundationMainIds(): number[] {
  const db = new DatabaseSync(join(dataRoot, getSource("usda-foundation")!.dbFile), { readOnly: true });
  try {
    return (
      db.prepare(`SELECT fdc_id AS id FROM food WHERE data_type = 'foundation_food' ORDER BY rowid LIMIT ?`).all(N) as { id: number }[]
    ).map((r) => Number(r.id));
  } finally {
    db.close();
  }
}

function keyTableFromValues(db: DatabaseSync, name: string, ids: (string | number)[]): void {
  db.exec(`CREATE TEMP TABLE ${name} (id PRIMARY KEY)`);
  const ins = db.prepare(`INSERT OR IGNORE INTO ${name} (id) VALUES (?)`);
  for (const id of ids) ins.run(id);
}

const PLANS: Record<string, Plan> = {
  /*
   * USDA Foundation: the first 200 foundation_food rows, plus their analytical chain so links on the food pages
   * resolve: input_food (the sample foods averaged into each Foundation food), the sub-samples of those sample
   * foods (sub_sample_food) and their acquisitions (acquisition_samples). Every fdc_id-keyed table is cut to that
   * food set; conversion factors and sub_sample_result follow their parent rows. Lookups are copied in full.
   */
  "usda-foundation": {
    note: "200 foundation_food rows (rowid order) + their input sample foods, sub-samples and acquisitions",
    keys: (db) => {
      keyTableFromValues(db, "k_main", usdaFoundationMainIds());
      db.exec(`CREATE TEMP TABLE k_food (id INTEGER PRIMARY KEY)`);
      db.exec(`INSERT OR IGNORE INTO k_food SELECT id FROM k_main`);
      db.exec(`INSERT OR IGNORE INTO k_food SELECT fdc_of_input_food FROM src.input_food WHERE fdc_id IN (SELECT id FROM k_main) AND fdc_of_input_food IS NOT NULL`);
      db.exec(`INSERT OR IGNORE INTO k_food SELECT fdc_id FROM src.sub_sample_food WHERE fdc_id_of_sample_food IN (SELECT id FROM k_food)`);
      db.exec(`INSERT OR IGNORE INTO k_food SELECT fdc_id_of_acquisition_food FROM src.acquisition_samples WHERE fdc_id_of_sample_food IN (SELECT id FROM k_food)`);
      db.exec(`CREATE TEMP TABLE k_fn (id INTEGER PRIMARY KEY)`);
      db.exec(`INSERT OR IGNORE INTO k_fn SELECT id FROM src.food_nutrient WHERE fdc_id IN (SELECT id FROM k_food)`);
      db.exec(`CREATE TEMP TABLE k_cf (id INTEGER PRIMARY KEY)`);
      db.exec(`INSERT OR IGNORE INTO k_cf SELECT id FROM src.food_nutrient_conversion_factor WHERE fdc_id IN (SELECT id FROM k_food)`);
    },
    tables: {
      food: IN("fdc_id", "k_food"),
      food_attribute: IN("fdc_id", "k_food"),
      food_component: IN("fdc_id", "k_food"),
      food_nutrient: IN("fdc_id", "k_food"),
      food_nutrient_conversion_factor: IN("fdc_id", "k_food"),
      food_portion: IN("fdc_id", "k_food"),
      food_update_log_entry: IN("id", "k_food"),
      foundation_food: IN("fdc_id", "k_food"),
      input_food: IN("fdc_id", "k_food"),
      market_acquisition: IN("fdc_id", "k_food"),
      agricultural_samples: IN("fdc_id", "k_food"),
      sample_food: IN("fdc_id", "k_food"),
      sub_sample_food: IN("fdc_id", "k_food"),
      acquisition_samples: `${IN("fdc_id_of_sample_food", "k_food")} AND ${IN("fdc_id_of_acquisition_food", "k_food")}`,
      food_calorie_conversion_factor: IN("food_nutrient_conversion_factor_id", "k_cf"),
      food_protein_conversion_factor: IN("food_nutrient_conversion_factor_id", "k_cf"),
      sub_sample_result: IN("food_nutrient_id", "k_fn"),
    },
  },

  /*
   * WAFCT 2019: the first 200 foods of 05_NV_sum_57_per_100g_EP (rows with an English name, sheet order) and every
   * row above the last of them, so the food-group header rows that give the composite its categories stay. The
   * other per-food sheets in the same order (03, 04, 06) are cut at the same food; sheets keyed by Code (07, 09,
   * 10, 11) keep the sampled codes. Components, sources, retention factors and the workbook metadata are full.
   */
  wafct: {
    note: "first 200 foods of 05_NV_sum_57_per_100g_EP (sheet order) with the group header rows above them",
    keys: (db) => {
      db.exec(`CREATE TEMP TABLE k_main AS SELECT Code AS id FROM src."05_NV_sum_57_per_100g_EP" WHERE "Food name in English" IS NOT NULL ORDER BY _row LIMIT ${N}`);
    },
    tables: Object.fromEntries([
      ...["03_NV_sum_39_per_100g_EP", "04_NV_stat_39_per_100g_EP", "05_NV_sum_57_per_100g_EP", "06_NV_stat_57_per_100g_EP"].map((t) => [
        t,
        `_row <= (SELECT MAX(_row) FROM src.${qi(t)} WHERE ${IN("Code", "k_main")})`,
      ]),
      ["07_Yield_factors_sing_ing", IN("Code", "k_main")],
      ["09_Mixed_dishes", IN("Code", "k_main")],
      ["10_FoodEx2_codes", IN("Code", "k_main")],
      ["11_2012_vs_2019_names_and_codes", IN("2019 Code", "k_main")],
    ]),
  },

  /* Frida 5.5: the first 200 Food rows; Data_Normalised and the wide Data_Table follow FoodID. Groups, parameters, sources full. */
  frida: {
    note: "first 200 Food rows (sheet order)",
    keys: (db) => {
      db.exec(`CREATE TEMP TABLE k_main AS SELECT FoodID AS id FROM src.Food ORDER BY _row LIMIT ${N}`);
    },
    tables: {
      Food: IN("FoodID", "k_main"),
      Data_Normalised: IN("FoodID", "k_main"),
      Data_Table: IN("↓FoodID/→ParameterID", "k_main"),
    },
  },

  /*
   * FooDB: the first 200 Food rows. Content keeps every Nutrient row and, per food × compound, the first
   * FOODB_MAX_ROWS_PER_COMPOUND rows with a quantified value (standard_content, lowest Content.id first); the ~1.2M
   * presence-only compound rows and the rest of the repeated quantified rows are left out (file size). Compounds are cut
   * to the ones those rows reference, and every compound-keyed table (synonyms, ontology terms, enzymes, flavours,
   * health effects, references, ...) to those compounds. Small vocabularies (Nutrient, OntologyTerm, Flavor, ...) full.
   */
  foodb: {
    note: `first 200 Food rows (rowid order); Content: all Nutrient rows + up to ${FOODB_MAX_ROWS_PER_COMPOUND} quantified rows per food × compound (presence-only compound rows dropped)`,
    keys: (db) => {
      db.exec(`CREATE TEMP TABLE k_main AS SELECT id FROM src.Food ORDER BY rowid LIMIT ${N}`);
      db.exec(`CREATE TEMP TABLE k_content (id INTEGER PRIMARY KEY)`);
      db.exec(
        `INSERT OR IGNORE INTO k_content SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY food_id, source_id ORDER BY id) AS rn FROM src.Content
           WHERE food_id IN (SELECT id FROM k_main) AND source_type = 'Compound' AND standard_content IS NOT NULL
         ) WHERE rn <= ${FOODB_MAX_ROWS_PER_COMPOUND}`,
      );
      db.exec(`CREATE TEMP TABLE k_comp (id INTEGER PRIMARY KEY)`);
      db.exec(
        `INSERT OR IGNORE INTO k_comp SELECT source_id FROM src.Content WHERE food_id IN (SELECT id FROM k_main) AND source_type = 'Compound' AND standard_content IS NOT NULL AND source_id IS NOT NULL`,
      );
      db.exec(`CREATE TEMP TABLE k_enzyme (id INTEGER PRIMARY KEY)`);
      db.exec(`INSERT OR IGNORE INTO k_enzyme SELECT enzyme_id FROM src.CompoundsEnzyme WHERE compound_id IN (SELECT id FROM k_comp) AND enzyme_id IS NOT NULL`);
    },
    tables: {
      Food: IN("id", "k_main"),
      FoodTaxonomy: IN("food_id", "k_main"),
      Content: `(${IN("food_id", "k_main")} AND source_type = 'Nutrient') OR ${IN("id", "k_content")}`,
      Compound: IN("id", "k_comp"),
      AccessionNumber: IN("compound_id", "k_comp"),
      CompoundAlternateParent: IN("compound_id", "k_comp"),
      CompoundExternalDescriptor: IN("compound_id", "k_comp"),
      CompoundOntologyTerm: IN("compound_id", "k_comp"),
      CompoundSubstituent: IN("compound_id", "k_comp"),
      CompoundsEnzyme: IN("compound_id", "k_comp"),
      CompoundsFlavor: IN("compound_id", "k_comp"),
      CompoundsHealthEffect: IN("compound_id", "k_comp"),
      CompoundsPathway: IN("compound_id", "k_comp"),
      PdbIdentifier: IN("compound_id", "k_comp"),
      CompoundSynonym: `(source_type = 'Compound' AND ${IN("source_id", "k_comp")}) OR source_type <> 'Compound'`,
      Reference: `source_type = 'Compound' AND ${IN("source_id", "k_comp")}`,
      Enzyme: IN("id", "k_enzyme"),
    },
  },

  /* NUTRI store: the same 200 Foundation foods as the usda-foundation sample (so the raw-viewer links resolve); nutrient / nutrient_code full. */
  store: {
    note: "usda_foundation preset: the same 200 fdc_ids as the usda-foundation sample; nutrient and nutrient_code full",
    keys: (db) => {
      keyTableFromValues(db, "k_main", usdaFoundationMainIds());
    },
    tables: {
      usda_foundation_food: IN("fdc_id", "k_main"),
      usda_foundation_amount: IN("fdc_id", "k_main"),
    },
  },
};

export type SampleResult = { id: string; path: string; bytes: number; mainFoods: number; counts: Record<string, number>; full: string[] };

export function sampleSource(source: SourceDef, sampledAt: string): SampleResult {
  const plan = PLANS[source.id];
  if (!plan) throw new Error(`No sample plan for ${source.id}`);
  const srcPath = join(dataRoot, source.dbFile);
  if (!existsSync(srcPath)) throw new Error(`No database yet: ${srcPath}`);
  mkdirSync(sampleRoot, { recursive: true });
  const out = join(sampleRoot, source.dbFile);
  const tmp = `${out}.tmp`;
  rmSync(tmp, { force: true });
  const db = new DatabaseSync(tmp);
  const counts: Record<string, number> = {};
  const full: string[] = [];
  let mainFoods = 0;
  try {
    db.exec("PRAGMA journal_mode = OFF");
    db.exec("PRAGMA synchronous = OFF");
    db.exec("PRAGMA temp_store = MEMORY");
    db.exec(`ATTACH ${sqlString(`${pathToFileURL(srcPath).href}?mode=ro`)} AS src`);
    plan.keys(db);
    mainFoods = Number((db.prepare(`SELECT COUNT(*) AS n FROM k_main`).get() as { n: number }).n);
    if (mainFoods === 0) throw new Error("no main foods selected");

    const objects = db.prepare(`SELECT type, name, tbl_name, sql FROM src.sqlite_master WHERE sql IS NOT NULL ORDER BY rowid`).all() as {
      type: string;
      name: string;
      tbl_name: string;
      sql: string;
    }[];
    const kept = new Set<string>();
    for (const t of objects.filter((o) => o.type === "table")) {
      if (t.name.startsWith("sqlite_") || ALWAYS_SKIP.has(t.name)) continue;
      const rule = plan.tables[t.name];
      if (rule === null) continue;
      db.exec(t.sql);
      db.exec(`INSERT INTO main.${qi(t.name)} SELECT * FROM src.${qi(t.name)}${rule ? ` WHERE ${rule}` : ""}`);
      counts[t.name] = Number((db.prepare(`SELECT COUNT(*) AS n FROM main.${qi(t.name)}`).get() as { n: number }).n);
      if (!rule && t.name !== "_meta") full.push(t.name);
      kept.add(t.name);
    }
    for (const name of Object.keys(plan.tables)) if (!kept.has(name) && plan.tables[name] !== null) throw new Error(`plan names a missing table: ${name}`);
    for (const ix of objects.filter((o) => o.type === "index" && kept.has(o.tbl_name))) db.exec(ix.sql);
    for (const o of objects.filter((o) => (o.type === "view" || o.type === "trigger") && kept.has(o.tbl_name))) db.exec(o.sql);
    db.exec("DETACH src");

    // Composite helpers on the sample (USDA _composite_nutrients, FooDB _compound_rank, indexes).
    prepareComposite(db, source);
    for (const t of ["_composite_nutrients", "_compound_rank"])
      if (db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t))
        counts[t] = Number((db.prepare(`SELECT COUNT(*) AS n FROM ${qi(t)}`).get() as { n: number }).n);

    // _meta: counts of the sample (the API reads row counts from here) + what this file is.
    const metaCounts = Object.fromEntries(Object.entries(counts).filter(([t]) => t !== "_meta"));
    const put = db.prepare(`INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)`);
    put.run("counts", JSON.stringify(metaCounts));
    put.run("sample", "1");
    put.run("sample_foods_per_source", String(N));
    put.run("sample_main_foods", String(mainFoods));
    put.run("sampled_at", sampledAt);
    put.run("sample_of", `data/${source.dbFile}`);
    put.run("sample_rule", plan.note);
    counts._meta = Number((db.prepare(`SELECT COUNT(*) AS n FROM _meta`).get() as { n: number }).n);

    db.exec("PRAGMA analysis_limit = 1000");
    db.exec("ANALYZE");
    db.exec("PRAGMA journal_mode = DELETE");
    db.exec("VACUUM");
  } finally {
    db.close();
  }
  renameSync(tmp, out);
  const bytes = statSync(out).size;
  if (bytes > MAX_FILE_MB * 1024 * 1024) throw new Error(`${out} is ${(bytes / 1048576).toFixed(1)} MB (limit ${MAX_FILE_MB} MB)`);
  writeSampleRelations(source, out);
  return { id: source.id, path: out, bytes, mainFoods, counts, full };
}

/** Relationship map of the sample, cached where the API reads it in sample mode (data-sample/_relations/<id>.json). */
function writeSampleRelations(source: SourceDef, path: string): void {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const meta = Object.fromEntries((db.prepare("SELECT key, value FROM _meta").all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    const doc = discoverRelations(db, {
      sourceId: source.id,
      mainTable: source.foodTable,
      mainId: source.foodIdField,
      foodIndexColumn: source.foodTable === "_food_index" ? source.foodRelated?.[0]?.field : undefined,
      loadedAt: meta.loaded_at ?? null,
      counts: JSON.parse(meta.counts ?? "{}"),
    });
    const dir = join(sampleRoot, "_relations");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${source.id}.json`), JSON.stringify(doc, null, 1));
  } finally {
    db.close();
  }
}

function sqlString(s: string): string {
  return `'${s.replaceAll("'", "''")}'`;
}

export function runSample(ids: string[]): SampleResult[] {
  const wanted = ids.length ? ids : [...SAMPLE_SOURCE_IDS];
  for (const id of wanted) {
    if (!(SAMPLE_SOURCE_IDS as readonly string[]).includes(id)) throw new Error(`${id} is not a sampled source (${SAMPLE_SOURCE_IDS.join(", ")})`);
  }
  const sampledAt = new Date().toISOString();
  const results: SampleResult[] = [];
  for (const id of wanted) {
    const t0 = Date.now();
    const r = sampleSource(getSource(id)!, sampledAt);
    results.push(r);
    console.log(`\n=== sample ${id}: ${r.mainFoods} main foods, ${(r.bytes / 1048576).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    for (const [t, n] of Object.entries(r.counts)) console.log(`  ${t.padEnd(34)} ${String(n).padStart(8)}${r.full.includes(t) ? "  (full)" : ""}`);
  }
  return results;
}
