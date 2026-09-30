import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import * as XLSX from "xlsx";
import { qi } from "./db.ts";

type Value = string | number | null;
type GridRow = { excelRow: number; cells: Value[] };

export type SheetOverride = {
  /** Excel row numbers (1-based) that form the header block. */
  headerRows: number[];
  /** Excel row whose texts become the column names. Default: the fullest header row. */
  nameRow?: number;
  /** Explicit column names by Excel column letter, for cells no header row names well. */
  names?: Record<string, string>;
};

export type WorkbookOptions = {
  overrides?: Record<string, SheetOverride>;
};

export type SheetResult = {
  sheet: string;
  table: string | null;
  headerRows: number[];
  nameRow: number | null;
  dataRows: number;
  columns: number;
  notes: number;
  status: "table" | "headerless" | "empty";
};

/** Table name from a sheet name: runs of non letters/digits become "_", case is kept. */
export function sheetSlug(name: string): string {
  const s = name.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
  return s || "sheet";
}

function cellValue(cell: XLSX.CellObject | undefined): Value {
  if (!cell) return null;
  switch (cell.t) {
    case "n":
      return typeof cell.v === "number" && Number.isFinite(cell.v) ? cell.v : null;
    case "s":
      return cell.v === undefined || cell.v === "" ? null : String(cell.v);
    case "b":
      return cell.v ? "TRUE" : "FALSE";
    case "e":
      return cell.w ?? "#ERROR";
    case "d":
      return cell.v instanceof Date ? cell.v.toISOString() : String(cell.v);
    default:
      return null;
  }
}

const isBlank = (v: Value) => v === null || (typeof v === "string" && v.trim() === "");
const text = (v: Value) => (v === null ? "" : String(v).replace(/\s+/g, " ").trim());
const nonEmpty = (r: GridRow) => r.cells.reduce<number>((n, v) => n + (isBlank(v) ? 0 : 1), 0);

function readGrid(ws: XLSX.WorkSheet): { rows: GridRow[]; firstCol: number; width: number } {
  const ref = ws["!ref"];
  if (!ref) return { rows: [], firstCol: 0, width: 0 };
  const range = XLSX.utils.decode_range(ref);
  const data = (ws["!data"] ?? []) as (XLSX.CellObject[] | undefined)[];
  const lastRow = Math.min(range.e.r, data.length - 1);
  const rows: GridRow[] = [];
  let maxCol = range.s.c;
  for (let r = range.s.r; r <= lastRow; r++) {
    const src = data[r];
    if (!src) continue;
    const cells: Value[] = [];
    let any = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = cellValue(src[c]);
      cells.push(v);
      if (!isBlank(v)) {
        any = true;
        if (c > maxCol) maxCol = c;
      }
    }
    if (any) rows.push({ excelRow: r + 1, cells });
  }
  const width = maxCol - range.s.c + 1;
  for (const row of rows) row.cells.length = width;
  return { rows, firstCol: range.s.c, width };
}

/**
 * Header detection for FAO/INFOODS-style sheets:
 * - header = first row (within the first 60 non-empty rows) that fills at least half as many
 *   cells as the fullest row and is at least 70% text;
 * - following rows join the header block (up to 4: translations, INFOODS tagnames, units,
 *   descriptions) while they contain no numbers AND either leave the first header column
 *   empty / repeat it, or put text into columns that are numeric in the data below;
 * - column names come from the fullest header row; blanks fall back to horizontally merged
 *   header cells, then to the other header rows, then to col_<letter>.
 */
function detectHeader(rows: GridRow[], width: number): { block: number[]; nameIdx: number } | null {
  if (rows.length === 0) return null;
  const scan = rows.slice(0, 300);
  const maxNE = Math.max(...scan.map(nonEmpty));
  if (maxNE < 2) return null;
  const threshold = Math.max(2, Math.ceil(maxNE * 0.5));
  let h = -1;
  for (let i = 0; i < Math.min(60, rows.length); i++) {
    const ne = nonEmpty(rows[i]);
    if (ne < threshold) continue;
    const strings = rows[i].cells.filter((v) => typeof v === "string" && v.trim() !== "").length;
    if (strings / ne >= 0.7) {
      h = i;
      break;
    }
  }
  if (h < 0) return null;

  const numericCol: boolean[] = [];
  for (let c = 0; c < width; c++) {
    let n = 0;
    let num = 0;
    for (const r of rows.slice(h + 1, h + 301)) {
      const v = r.cells[c];
      if (isBlank(v)) continue;
      n++;
      if (typeof v === "number") num++;
    }
    numericCol[c] = n >= 3 && num / n >= 0.4;
  }
  const fc = rows[h].cells.findIndex((v) => !isBlank(v));
  const headFirst = text(rows[h].cells[fc]);
  const block = [h];
  for (let j = h + 1; j < rows.length && block.length < 5; j++) {
    const cells = rows[j].cells;
    if (cells.some((v) => typeof v === "number")) break;
    const first = text(cells[fc]);
    const textInNumeric = cells.filter((v, c) => typeof v === "string" && v.trim() !== "" && numericCol[c]).length;
    if (first === "" || first === headFirst || textInNumeric >= 2) block.push(j);
    else break;
  }
  let nameIdx = block[0];
  for (const b of block) if (nonEmpty(rows[b]) > nonEmpty(rows[nameIdx])) nameIdx = b;
  return { block, nameIdx };
}

function colLetter(c: number): string {
  return XLSX.utils.encode_col(c);
}

function ensureMetaTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _sheets (
      sheet_index INTEGER, sheet_name TEXT, table_name TEXT, file TEXT, ref TEXT,
      header_excel_rows TEXT, name_excel_row INTEGER, data_rows INTEGER, columns INTEGER,
      notes_rows INTEGER, status TEXT
    );
    CREATE TABLE IF NOT EXISTS _columns (
      table_name TEXT, position INTEGER, excel_column TEXT, column_name TEXT, header_values TEXT
    );
    CREATE TABLE IF NOT EXISTS _notes (
      table_name TEXT, sheet_name TEXT, excel_row INTEGER, text TEXT
    );
  `);
}

/**
 * Loads every sheet of a workbook as its own table (`_row` = Excel row number, then the
 * sheet's columns with their original header text). Cell values are stored as-is: numbers as
 * numbers, text as text, no type affinity. Rows above the header go to `_notes`; the full
 * header block per column goes to `_columns`; one line per sheet goes to `_sheets`.
 */
export function loadWorkbook(
  db: DatabaseSync,
  filePath: string,
  opts: WorkbookOptions = {},
): SheetResult[] {
  const wb = XLSX.read(readFileSync(filePath), {
    type: "buffer",
    dense: true,
    cellDates: false,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
  });
  ensureMetaTables(db);
  const results: SheetResult[] = [];
  const usedTables = new Set<string>();
  const insSheet = db.prepare(`INSERT INTO _sheets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insCol = db.prepare(`INSERT INTO _columns VALUES (?, ?, ?, ?, ?)`);
  const insNote = db.prepare(`INSERT INTO _notes VALUES (?, ?, ?, ?)`);

  wb.SheetNames.forEach((sheetName, sheetIndex) => {
    const ws = wb.Sheets[sheetName];
    const { rows, firstCol, width } = readGrid(ws);
    let table = sheetSlug(sheetName);
    for (let k = 2; usedTables.has(table.toLowerCase()); k++) table = `${sheetSlug(sheetName)}_${k}`;

    if (rows.length === 0) {
      insSheet.run(sheetIndex, sheetName, null, filePath, ws["!ref"] ?? null, null, null, 0, 0, 0, "empty");
      results.push({ sheet: sheetName, table: null, headerRows: [], nameRow: null, dataRows: 0, columns: 0, notes: 0, status: "empty" });
      return;
    }
    usedTables.add(table.toLowerCase());

    // header block (indexes into rows)
    let block: number[] = [];
    let nameIdx = -1;
    const ov = opts.overrides?.[sheetName];
    if (ov) {
      block = ov.headerRows.map((er) => rows.findIndex((r) => r.excelRow === er)).filter((i) => i >= 0);
      nameIdx = rows.findIndex((r) => r.excelRow === (ov.nameRow ?? ov.headerRows[0]));
      if (nameIdx < 0 && block.length) nameIdx = block[0];
    } else {
      const det = detectHeader(rows, width);
      if (det) {
        block = det.block;
        nameIdx = det.nameIdx;
      }
    }
    const headerless = block.length === 0;
    const firstData = headerless ? 0 : Math.max(...block) + 1;
    const preamble = headerless ? [] : rows.slice(0, Math.min(...block));
    const dataRows = rows.slice(firstData);

    // merged header cells: value of the merge's top-left cell for every other cell it covers
    const merged = new Map<string, Value>();
    if (!headerless) {
      const headerExcelRows = new Set(block.map((i) => rows[i].excelRow));
      for (const m of (ws["!merges"] ?? []) as XLSX.Range[]) {
        const topRow = rows.find((r) => r.excelRow === m.s.r + 1);
        if (!topRow || !headerExcelRows.has(m.s.r + 1)) continue;
        const v = topRow.cells[m.s.c - firstCol];
        if (isBlank(v)) continue;
        for (let r = m.s.r; r <= m.e.r; r++) {
          for (let c = m.s.c; c <= m.e.c; c++) {
            if (r !== m.s.r || c !== m.s.c) merged.set(`${r + 1}:${c - firstCol}`, v);
          }
        }
      }
    }
    const headerCell = (rowIdx: number, c: number): string => {
      const row = rows[rowIdx];
      const v = row.cells[c];
      if (!isBlank(v)) return text(v);
      const m = merged.get(`${row.excelRow}:${c}`);
      return m === undefined ? "" : text(m);
    };

    // name row: the fullest header row, counting cells filled by horizontal merges
    if (!headerless && !ov?.nameRow) {
      const filled = (b: number) => {
        let n = 0;
        for (let c = 0; c < width; c++) if (headerCell(b, c) !== "") n++;
        return n;
      };
      nameIdx = block[0];
      for (const b of block) if (filled(b) > filled(nameIdx)) nameIdx = b;
    }

    // columns
    const hasData = new Array<boolean>(width).fill(false);
    for (const r of dataRows) r.cells.forEach((v, c) => { if (!isBlank(v)) hasData[c] = true; });
    const otherRows = headerless ? [] : [...block.filter((b) => b > nameIdx), ...block.filter((b) => b < nameIdx)];
    const draft: { c: number; name: string; alt: string; header: string[] }[] = [];
    for (let c = 0; c < width; c++) {
      const header = headerless ? [] : block.map((b) => headerCell(b, c));
      const explicit = ov?.names?.[colLetter(c + firstCol)];
      const fromName = headerless ? "" : headerCell(nameIdx, c);
      const others = otherRows.map((b) => headerCell(b, c)).filter((v) => v !== "");
      let name = explicit || fromName || others[0] || "";
      if (name === "" && !hasData[c]) continue; // ghost column: no header, no data
      if (name === "") name = `col_${colLetter(c + firstCol)}`;
      draft.push({ c, name, alt: others.find((v) => v !== name) ?? "", header });
    }
    // duplicated names (merged group headers, repeated tagnames): qualify every member with
    // the next header row ("Boiled / seeds"), then number whatever still collides.
    const freq = new Map<string, number>();
    for (const d of draft) freq.set(d.name.toLowerCase(), (freq.get(d.name.toLowerCase()) ?? 0) + 1);
    const seen = new Set<string>(["_row"]);
    const columns: { c: number; name: string; header: string[] }[] = [];
    for (const d of draft) {
      let name = d.name;
      if ((freq.get(name.toLowerCase()) ?? 0) > 1 && d.alt) name = `${name} / ${d.alt}`;
      const base = name;
      for (let k = 2; seen.has(name.toLowerCase()); k++) name = `${base} (${k})`;
      seen.add(name.toLowerCase());
      columns.push({ c: d.c, name, header: d.header });
    }

    db.exec(`DROP TABLE IF EXISTS ${qi(table)}`);
    db.exec(`CREATE TABLE ${qi(table)} ("_row" INTEGER, ${columns.map((col) => qi(col.name)).join(", ")})`);
    const ins = db.prepare(
      `INSERT INTO ${qi(table)} VALUES (?, ${columns.map(() => "?").join(", ")})`,
    );
    db.exec("BEGIN");
    for (const r of dataRows) ins.run(r.excelRow, ...columns.map((col) => r.cells[col.c] ?? null));
    columns.forEach((col, i) =>
      insCol.run(table, i + 1, colLetter(col.c + firstCol), col.name, JSON.stringify(col.header)),
    );
    for (const r of preamble) {
      insNote.run(table, sheetName, r.excelRow, r.cells.filter((v) => !isBlank(v)).map(String).join(" | "));
    }
    const headerExcel = block.map((b) => rows[b].excelRow);
    insSheet.run(
      sheetIndex,
      sheetName,
      table,
      filePath,
      ws["!ref"] ?? null,
      headerExcel.join(","),
      nameIdx >= 0 && !headerless ? rows[nameIdx].excelRow : null,
      dataRows.length,
      columns.length,
      preamble.length,
      headerless ? "headerless" : "table",
    );
    db.exec("COMMIT");
    results.push({
      sheet: sheetName,
      table,
      headerRows: headerExcel,
      nameRow: nameIdx >= 0 && !headerless ? rows[nameIdx].excelRow : null,
      dataRows: dataRows.length,
      columns: columns.length,
      notes: preamble.length,
      status: headerless ? "headerless" : "table",
    });
  });
  return results;
}
