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
  if (args.length === 0) {
    console.log("Usage: npm run ingest -- <source-id...|all>");
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
