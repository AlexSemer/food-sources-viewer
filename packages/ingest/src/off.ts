import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { getSource } from "@fsv/shared";
import { sourceRawDir } from "./paths.ts";
import { loadCsvFile } from "./loadCsv.ts";
import { createIndex, finalizeIngestDb, indexFoodTable, openIngestDb, type FinalizeResult } from "./db.ts";

/**
 * Open Food Facts "en" products export: tab-separated, never quoted, ~200 columns.
 * Loaded as one raw `product` table, streamed. Delta JSON, RDF and the sister projects are
 * not loaded (see _meta.skipped).
 */
export async function ingestOff(): Promise<FinalizeResult> {
  const source = getSource("off")!;
  const root = sourceRawDir(source.datasourcesDir);
  const file = join(root, "csv-en", "en.openfoodfacts.org.products.csv");
  if (!existsSync(file)) {
    throw new Error(`${file} missing. Decompress csv-en/en.openfoodfacts.org.products.csv.gz next to it.`);
  }
  console.log(`raw: ${file} (${(statSync(file).size / 1e9).toFixed(1)} GB)`);
  const h = openIngestDb(source);
  const st = await loadCsvFile(h.db, "product", file, {
    delimiter: "\t",
    quote: false,
    sampleRows: 20000,
    batchRows: 20000,
  });
  console.log(`  product: ${st.rows} rows (${st.seconds.toFixed(1)}s)`);
  console.log("indexing");
  indexFoodTable(h.db, source); // (code) and (product_name, code)
  createIndex(h.db, "product", ["brands"]);
  return finalizeIngestDb(h, file, {
    loader: "off.ts (products TSV, streamed, quote handling off)",
    csv_stats: JSON.stringify(st),
    skipped: JSON.stringify([
      "delta/*.json(.gz): daily incremental product diffs on top of the MongoDB dump; applying them would merge a second snapshot into the CSV one",
      "rdf/en.openfoodfacts.org.products.rdf(.gz): same products as RDF triples, redundant with the CSV",
      "other-projects/openbeautyfacts|openpetfoodfacts|openproductsfacts: separate non-food databases, not part of this source",
    ]),
  });
}
