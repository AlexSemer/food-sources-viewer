import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SourceDef } from "@fsv/shared";
import { discoverRelations, type RelationsDoc } from "@fsv/shared/relations";
import { dataRoot } from "./paths.ts";

/**
 * Computes the relationship map of a source db (packages/shared/src/relations.ts) and caches it as
 * data/_relations/<id>.json, the same file the API serves (and recomputes when the db's loaded_at changes).
 */
export function writeRelations(source: SourceDef): RelationsDoc {
  const db = new DatabaseSync(join(dataRoot, source.dbFile), { readOnly: true });
  try {
    const meta = Object.fromEntries(
      (db.prepare("SELECT key, value FROM _meta").all() as { key: string; value: string }[]).map((r) => [r.key, r.value]),
    );
    let counts: Record<string, number> = {};
    try {
      counts = JSON.parse(meta.counts ?? "{}");
    } catch {
      counts = {};
    }
    const doc = discoverRelations(db, {
      sourceId: source.id,
      mainTable: source.foodTable,
      mainId: source.foodIdField,
      foodIndexColumn: source.foodTable === "_food_index" ? source.foodRelated?.[0]?.field : undefined,
      loadedAt: meta.loaded_at ?? null,
      counts,
    });
    const dir = join(dataRoot, "_relations");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${source.id}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify(doc, null, 1));
    renameSync(`${file}.tmp`, file);
    return doc;
  } finally {
    db.close();
  }
}
