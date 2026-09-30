import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { qi } from "./db.ts";

export type CsvLoadOptions = {
  /** Field delimiter, default ",". Open Food Facts uses "\t". */
  delimiter?: string;
  /** Quote character, or false for files that never quote (OFF). Default '"'. */
  quote?: string | false;
  /** Rows buffered up front to infer column affinities. Default 5000. */
  sampleRows?: number;
  /** Rows per transaction. Default 50000. */
  batchRows?: number;
};

export type CsvLoadStats = {
  table: string;
  file: string;
  rows: number;
  columns: number;
  /** Rows with fewer fields than the header (padded with NULL). */
  shortRows: number;
  /** Rows with more fields than the header; the surplus is kept in an `_extra` column. */
  longRows: number;
  seconds: number;
};

const INT_RE = /^-?(0|[1-9]\d{0,14})$/;
const NUM_RE = /^-?(0|[1-9]\d{0,14})(\.\d+)?([eE][-+]?\d{1,3})?$/;

function isIdHeader(h: string): boolean {
  const l = h.toLowerCase();
  return l === "id" || l.endsWith("_id") || l === "ndb_number";
}

/** Columns whose digits are identifiers (barcodes, codes), never numbers. */
function isCodeLike(h: string): boolean {
  return /code|nbr|upc|gtin|barcode/i.test(h);
}

/**
 * Column affinity from a sample. Only whole-sample-numeric columns get INTEGER/NUMERIC, and
 * values with leading zeros ("007") or code-like headers stay TEXT so nothing is rewritten.
 */
export function inferType(header: string, values: Iterable<string | undefined>): string {
  let n = 0;
  let allInt = true;
  for (const v of values) {
    if (v === undefined || v === "") continue;
    n++;
    if (allInt && !INT_RE.test(v)) allInt = false;
    if (!NUM_RE.test(v)) return "TEXT";
  }
  if (n === 0 || isCodeLike(header)) return "TEXT";
  if (allInt && isIdHeader(header)) return "INTEGER";
  return "NUMERIC";
}

export function uniqueHeaders(raw: string[]): string[] {
  const seen = new Set<string>();
  return raw.map((h, i) => {
    const base = h.trim() === "" ? `col_${i + 1}` : h;
    let name = base;
    for (let k = 2; seen.has(name.toLowerCase()) || name.toLowerCase() === "_extra"; k++) {
      name = `${base} (${k})`;
    }
    seen.add(name.toLowerCase());
    return name;
  });
}

/**
 * Streams a delimited file into `table` (dropped and recreated). Memory is bounded by
 * `sampleRows`: rows are inserted as they are parsed, in batched transactions.
 */
export async function loadCsvFile(
  db: DatabaseSync,
  table: string,
  filePath: string,
  opts: CsvLoadOptions = {},
): Promise<CsvLoadStats> {
  const t0 = Date.now();
  const sampleRows = opts.sampleRows ?? 5000;
  const batchRows = opts.batchRows ?? 50000;
  const parser = parse({
    bom: true,
    delimiter: opts.delimiter ?? ",",
    quote: opts.quote === false ? false : (opts.quote ?? '"'),
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
  });
  const input = createReadStream(filePath, { highWaterMark: 4 << 20 });
  input.on("error", (err) => parser.destroy(err));
  input.pipe(parser);

  const stats: CsvLoadStats = {
    table,
    file: filePath,
    rows: 0,
    columns: 0,
    shortRows: 0,
    longRows: 0,
    seconds: 0,
  };
  let header: string[] | undefined;
  let width = 0;
  let hasExtra = false;
  let stmt: StatementSync | undefined;
  const sample: string[][] = [];
  let inBatch = 0;
  let nextLog = 1_000_000;
  const delimiter = opts.delimiter ?? ",";

  const prepareInsert = () => {
    const cols = hasExtra ? [...header!, "_extra"] : header!;
    stmt = db.prepare(
      `INSERT INTO ${qi(table)} (${cols.map(qi).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    );
  };

  const insertRec = (rec: string[]) => {
    if (rec.length > width && !hasExtra) {
      db.exec(`ALTER TABLE ${qi(table)} ADD COLUMN "_extra" TEXT`);
      hasExtra = true;
      prepareInsert();
    }
    const params: (string | null)[] = new Array(hasExtra ? width + 1 : width);
    for (let i = 0; i < width; i++) {
      const v = rec[i];
      params[i] = v === undefined || v === "" ? null : v;
    }
    if (rec.length < width) stats.shortRows++;
    if (hasExtra) {
      if (rec.length > width) {
        stats.longRows++;
        params[width] = rec.slice(width).join(delimiter);
      } else {
        params[width] = null;
      }
    }
    if (inBatch === 0) db.exec("BEGIN");
    stmt!.run(...params);
    stats.rows++;
    if (++inBatch >= batchRows) {
      db.exec("COMMIT");
      inBatch = 0;
    }
    if (stats.rows >= nextLog) {
      const s = (Date.now() - t0) / 1000;
      console.log(`  ${table}: ${stats.rows.toLocaleString("en-US")} rows, ${Math.round(stats.rows / s)} rows/s`);
      nextLog += 1_000_000;
    }
  };

  const start = () => {
    const types = header!.map((h, i) => inferType(h, sample.map((r) => r[i])));
    db.exec(`DROP TABLE IF EXISTS ${qi(table)}`);
    db.exec(
      `CREATE TABLE ${qi(table)} (${header!.map((h, i) => `${qi(h)} ${types[i]}`).join(", ")})`,
    );
    prepareInsert();
    for (const r of sample) insertRec(r);
    sample.length = 0;
  };

  try {
    for await (const rec of parser as AsyncIterable<string[]>) {
      if (!header) {
        header = uniqueHeaders(rec);
        width = header.length;
        continue;
      }
      if (!stmt) {
        sample.push(rec);
        if (sample.length >= sampleRows) start();
        continue;
      }
      insertRec(rec);
    }
    if (!header) {
      db.exec(`DROP TABLE IF EXISTS ${qi(table)}`);
      db.exec(`CREATE TABLE ${qi(table)} (_empty TEXT)`);
    } else if (!stmt) {
      start();
    }
    if (inBatch > 0) db.exec("COMMIT");
  } catch (err) {
    if (inBatch > 0) db.exec("ROLLBACK");
    throw err;
  }
  stats.columns = width;
  stats.seconds = (Date.now() - t0) / 1000;
  if (stats.shortRows || stats.longRows) {
    console.log(`  ${table}: ${stats.shortRows} short rows (NULL-padded), ${stats.longRows} long rows (surplus in _extra)`);
  }
  return stats;
}

/** Back-compat wrapper: streams the file and returns the row count. */
export async function loadCsvTable(
  db: DatabaseSync,
  table: string,
  filePath: string,
  opts: CsvLoadOptions = {},
): Promise<number> {
  return (await loadCsvFile(db, table, filePath, opts)).rows;
}
