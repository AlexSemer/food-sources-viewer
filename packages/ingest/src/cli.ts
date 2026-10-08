import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getSource, sources, type SourceId } from "@fsv/shared";
import { dataRoot } from "./paths.ts";
import type { FinalizeResult } from "./db.ts";
import { ingestUsdaFoundation } from "./usdaFoundation.ts";
import { usdaLoader } from "./usdaFdc.ts";
import { ingestOff } from "./off.ts";
import { ingestFoodb } from "./foodb.ts";
import { xlsxLoader, xlsxSourceIds } from "./xlsxSources.ts";
import { prepareExisting } from "./compositePrep.ts";
import { writeRelations } from "./relationsCache.ts";
import { runStore } from "./store/run.ts";
import { runSample } from "./sample.ts";

const implemented: Partial<Record<SourceId, () => Promise<FinalizeResult>>> = {
  "usda-foundation": ingestUsdaFoundation,
  "usda-sr-legacy": usdaLoader("usda-sr-legacy"),
  "usda-fndds": usdaLoader("usda-fndds"),
  "usda-branded": usdaLoader("usda-branded"),
  "usda-full": usdaLoader("usda-full"),
  off: ingestOff,
  foodb: ingestFoodb,
  ...Object.fromEntries(xlsxSourceIds.map((id) => [id, xlsxLoader(id)])),
};

type Result = { id: string; ok: boolean; seconds: number; bytes?: number; tables?: number; error?: string };

function fmtBytes(n: number): string {
  return n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // NUTRI store (docs/store-schema.md): store [dataset...]  -> data/store.sqlite, built from the existing source dbs.
  if (args[0] === "store") {
    const t0 = Date.now();
    console.log(`\n=== store: ${getSource("store")!.label} ===`);
    let result: Result;
    try {
      const res = await runStore(args.slice(1));
      result = { id: "store", ok: true, seconds: (Date.now() - t0) / 1000, bytes: res.bytes, tables: Object.keys(res.counts).length };
      console.log(`wrote ${res.path} (${fmtBytes(res.bytes)}) in ${result.seconds.toFixed(1)}s`);
      for (const [t, n] of Object.entries(res.counts)) console.log(`  ${t.padEnd(26)} ${n}`);
      try {
        const doc = writeRelations(getSource("store")!);
        console.log(`relations: ${doc.edges.length} joins (${doc.ms} ms)`);
      } catch (err) {
        console.warn(`relations failed (the API computes them on demand): ${err instanceof Error ? err.message : err}`);
      }
    } catch (err) {
      result = { id: "store", ok: false, seconds: (Date.now() - t0) / 1000, error: err instanceof Error ? err.message : String(err) };
      console.error(`FAILED store: ${result.error}`);
    }
    mkdirSync(join(dataRoot, "logs"), { recursive: true });
    appendFileSync(join(dataRoot, "logs", "ingest-runs.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...result }) + "\n");
    if (!result.ok) process.exit(1);
    return;
  }
  // Online sample (Vercel): sample [ids...] -> data-sample/<dbFile>, cut from the existing data/ dbs (read-only).
  if (args[0] === "sample") {
    runSample(args.slice(1));
    return;
  }
  // Maintenance subcommands on existing dbs (no re-ingest):
  //   prep <ids|all>       composite-view indexes / helper tables (compositePrep.ts)
  //   relations <ids|all>  recompute the relationship map cache data/_relations/<id>.json
  if (args[0] === "prep" || args[0] === "relations") {
    const rest = args.slice(1);
    const ids = rest.includes("all") ? sources.map((s) => s.id) : rest;
    if (!ids.length) throw new Error(`Usage: npm run ingest -- ${args[0]} <source-id...|all>`);
    for (const id of ids) {
      const source = getSource(id);
      if (!source) throw new Error(`Unknown source: ${id}`);
      const t0 = Date.now();
      console.log(`\n=== ${args[0]} ${id} ===`);
      if (args[0] === "prep") {
        const done = prepareExisting(source);
        console.log(done.length ? `  done in ${((Date.now() - t0) / 1000).toFixed(1)}s` : "  nothing to prepare for this source");
      } else {
        const doc = writeRelations(source);
        console.log(`  ${doc.edges.length} joins, ${doc.notes.length} notes in ${doc.ms} ms`);
      }
    }
    return;
  }
  if (args.length === 0) {
    console.log("Usage: npm run ingest -- <source-id...|all>");
    console.log("       npm run ingest -- prep <source-id...|all>        (composite-view indexes on existing dbs)");
    console.log("       npm run ingest -- relations <source-id...|all>   (recompute the relationship maps)");
    console.log("       npm run ingest -- store [usda-foundation]        (NUTRI store, data/store.sqlite)");
    console.log("       npm run ingest -- sample [source-id...]          (online sample, data-sample/)");
    console.log(
      sources.map((s) => `  ${s.id.padEnd(20)} ${implemented[s.id] ? "ready" : "stub"}`).join("\n"),
    );
    process.exit(1);
  }
  const ids = args.includes("all") ? sources.map((s) => s.id).filter((id) => implemented[id]) : args;
  for (const id of ids) if (!getSource(id)) throw new Error(`Unknown source: ${id}`);

  const logDir = join(dataRoot, "logs");
  mkdirSync(logDir, { recursive: true });
  const results: Result[] = [];
  for (const id of ids) {
    const source = getSource(id)!;
    const run = implemented[source.id];
    if (!run) {
      console.log(`${id}: not implemented yet`);
      continue;
    }
    console.log(`\n=== ${source.id}: ${source.label} ${source.version} ===`);
    const t0 = Date.now();
    let result: Result;
    try {
      const res = await run();
      result = { id, ok: true, seconds: (Date.now() - t0) / 1000, bytes: res.bytes, tables: Object.keys(res.counts).length };
      console.log(`wrote ${res.path} (${fmtBytes(res.bytes)}) in ${result.seconds.toFixed(1)}s`);
      try {
        const doc = writeRelations(source);
        console.log(`relations: ${doc.edges.length} joins (${doc.ms} ms)`);
      } catch (err) {
        console.warn(`relations failed (the API computes them on demand): ${err instanceof Error ? err.message : err}`);
      }
    } catch (err) {
      result = { id, ok: false, seconds: (Date.now() - t0) / 1000, error: err instanceof Error ? err.message : String(err) };
      console.error(`FAILED ${id}: ${result.error}`);
    }
    results.push(result);
    appendFileSync(join(logDir, "ingest-runs.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...result }) + "\n");
  }

  if (results.length > 1) {
    console.log("\n=== summary ===");
    for (const r of results) {
      console.log(
        `${r.id.padEnd(18)} ${r.ok ? "ok    " : "FAILED"} ${r.seconds.toFixed(1).padStart(8)}s ${r.bytes ? fmtBytes(r.bytes).padStart(10) : ""}${r.error ? `  ${r.error}` : ""}`,
      );
    }
  }
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
