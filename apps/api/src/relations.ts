import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSource } from "@fsv/shared";
import { discoverRelations, RELATIONS_VERSION, type RelationsDoc } from "@fsv/shared/relations";
import { dataRoot, httpError, openDb, readOnlyMode } from "./db.ts";

/**
 * Relationship map of one source's tables, computed by `discoverRelations` (packages/shared/src/relations.ts).
 * Cached as data/_relations/<id>.json (also written by `npm run ingest -- relations <id>`); the cache is
 * reused while its version and the db's `loaded_at` match, otherwise recomputed on demand (a few seconds
 * for the largest dbs). Read-only deployments (the online sample) ship the cache prebuilt by `npm run sample` and
 * never write it; a recompute there is returned without being cached.
 */
export const relationsDir = resolve(dataRoot, "_relations");

export function relationsFor(sourceId: string, refresh: boolean): RelationsDoc & { cached: boolean } {
  const source = getSource(sourceId);
  if (!source) throw httpError(404, "unknown source");
  const info = openDb(sourceId);
  const loadedAt = info.meta.loaded_at ?? null;
  const file = resolve(relationsDir, `${sourceId}.json`);
  if (!refresh && existsSync(file)) {
    try {
      const doc = JSON.parse(readFileSync(file, "utf8")) as RelationsDoc;
      if (doc.version === RELATIONS_VERSION && doc.loadedAt === loadedAt) return { ...doc, cached: true };
    } catch {
      /* recompute */
    }
  }
  info.pins++;
  let doc: RelationsDoc;
  try {
    doc = discoverRelations(info.db, {
      sourceId,
      mainTable: source.foodTable,
      mainId: source.foodIdField,
      foodIndexColumn: source.foodTable === "_food_index" ? source.foodRelated?.[0]?.field : undefined,
      loadedAt,
      counts: info.counts,
    });
  } finally {
    info.pins--;
    info.lastUsed = Date.now();
  }
  if (readOnlyMode) return { ...doc, cached: false };
  mkdirSync(relationsDir, { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(doc, null, 1));
  renameSync(`${file}.tmp`, file);
  return { ...doc, cached: false };
}
