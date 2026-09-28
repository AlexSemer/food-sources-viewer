import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import type Database from "better-sqlite3";

function sqliteType(header: string, sample: string | undefined): string {
  const h = header.toLowerCase();
  if (h.endsWith("_id") || h === "id" || h === "fdc_id" || h === "ndb_number") {
    return "INTEGER";
  }
  if (
    sample !== undefined &&
    sample !== "" &&
    /^-?\d+(\.\d+)?$/.test(sample) &&
    !header.toLowerCase().includes("code") &&
    !header.toLowerCase().includes("nbr")
  ) {
    return "REAL";
  }
  return "TEXT";
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export async function loadCsvTable(
  db: Database.Database,
  table: string,
  filePath: string,
): Promise<number> {
  const rows: Record<string, string>[] = [];
  await new Promise<void>((resolve, reject) => {
    createReadStream(filePath)
      .pipe(parse({ columns: true, relax_quotes: true, relax_column_count: true }))
      .on("data", (row: Record<string, string>) => rows.push(row))
      .on("end", () => resolve())
      .on("error", reject);
  });

  if (rows.length === 0) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (_empty TEXT)`);
    return 0;
  }

  const headers = Object.keys(rows[0]);
  const cols = headers.map((h) => {
    const sample = rows.find((r) => r[h] !== undefined && r[h] !== "")?.[h];
    return `${quoteIdent(h)} ${sqliteType(h, sample)}`;
  });

  db.exec(`DROP TABLE IF EXISTS ${quoteIdent(table)}`);
  db.exec(`CREATE TABLE ${quoteIdent(table)} (${cols.join(", ")})`);

  const placeholders = headers.map(() => "?").join(", ");
  const insert = db.prepare(
    `INSERT INTO ${quoteIdent(table)} (${headers.map(quoteIdent).join(", ")}) VALUES (${placeholders})`,
  );
  const tx = db.transaction((batch: Record<string, string>[]) => {
    for (const row of batch) {
      insert.run(headers.map((h) => (row[h] === "" ? null : row[h])));
    }
  });
  tx(rows);
  return rows.length;
}
