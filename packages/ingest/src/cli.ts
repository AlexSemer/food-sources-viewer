import { getSource, sources, type SourceId } from "@fsv/shared";
import { ingestUsdaFoundation } from "./usdaFoundation.ts";

const implemented: Record<string, () => Promise<void>> = {
  "usda-foundation": ingestUsdaFoundation,
};

async function main(): Promise<void> {
  const id = process.argv[2] as SourceId | "all" | undefined;
  if (!id) {
    console.log("Usage: npm run ingest -- <source-id|all>");
    console.log(
      sources.map((s) => `  ${s.id.padEnd(20)} ${s.implemented ? "ready" : "stub"}`).join("\n"),
    );
    process.exit(1);
  }

  const ids = id === "all" ? sources.map((s) => s.id) : [id];
  for (const next of ids) {
    const source = getSource(next);
    if (!source) {
      throw new Error(`Unknown source: ${next}`);
    }
    const run = implemented[next];
    if (!run) {
      console.log(`${next}: not implemented yet`);
      continue;
    }
    console.log(`\n=== ${source.label} ${source.version} ===`);
    await run();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
