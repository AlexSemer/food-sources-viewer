import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { getSource } from "@fsv/shared";
import { dataRoot, ensureDataDir, sourceRawDir } from "./paths.ts";
import { loadCsvTable } from "./loadCsv.ts";

const TABLES = [
  "food",
  "foundation_food",
  "nutrient",
  "food_nutrient",
  "food_category",
  "food_portion",
] as const;

function findCsvDir(root: string): string {
  if (existsSync(join(root, "food.csv"))) return root;
  const queue = [root];
  while (queue.length) {
    const dir = queue.shift()!;
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    if (existsSync(join(dir, "food.csv"))) return dir;
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      queue.push(join(dir, name));
    }
  }
  throw new Error(
    `No food.csv under ${root}. Copy or symlink the Foundation CSV folder into datasources/.`,
  );
}

export async function ingestUsdaFoundation(): Promise<void> {
  const source = getSource("usda-foundation")!;
  const rawRoot = sourceRawDir(source.datasourcesDir);
  const csvDir = findCsvDir(rawRoot);

  ensureDataDir();
  const dbPath = join(dataRoot, source.dbFile);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    const file = join(csvDir, `${table}.csv`);
    if (!existsSync(file)) {
      console.warn(`skip missing ${table}.csv`);
      continue;
    }
    console.log(`loading ${table}.csv`);
    counts[table] = await loadCsvTable(db, table, file);
    console.log(`  ${counts[table]} rows`);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS food_fdc_id ON food (fdc_id);
    CREATE INDEX IF NOT EXISTS food_data_type ON food (data_type);
    CREATE INDEX IF NOT EXISTS food_description ON food (description);
    CREATE INDEX IF NOT EXISTS food_nutrient_fdc_id ON food_nutrient (fdc_id);
    CREATE INDEX IF NOT EXISTS food_nutrient_nutrient_id ON food_nutrient (nutrient_id);
    CREATE INDEX IF NOT EXISTS nutrient_id ON nutrient (id);
  `);

  db.exec(`DROP TABLE IF EXISTS _meta`);
  db.exec(`
    CREATE TABLE _meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  const put = db.prepare("INSERT INTO _meta (key, value) VALUES (?, ?)");
  put.run("source_id", source.id);
  put.run("label", source.label);
  put.run("version", source.version);
  put.run("csv_dir", csvDir);
  put.run("loaded_at", new Date().toISOString());
  put.run("counts", JSON.stringify(counts));

  db.close();
  console.log(`wrote ${dbPath}`);
}
