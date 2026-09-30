import { existsSync } from "node:fs";
import { join } from "node:path";
import { getSource, type SourceId } from "@fsv/shared";
import { sourceRawDir } from "./paths.ts";
import { loadWorkbook, type SheetOverride } from "./xlsx.ts";
import {
  createIndex,
  findColumn,
  finalizeIngestDb,
  indexColumnsIfPresent,
  indexFoodTable,
  openIngestDb,
  qi,
  tableNames,
  type FinalizeResult,
} from "./db.ts";

type FoodIndexSpec = {
  /** Sheets (by name) whose rows are foods, e.g. one sheet per food group. */
  sheetPattern: RegExp;
  exclude?: RegExp;
  idColumns: string[];
  nameColumns: string[];
};

type XlsxSourceConfig = {
  /** Workbook path relative to the source's datasourcesDir. */
  file: string;
  /** Columns indexed in every sheet that has them. */
  indexColumns: string[];
  foodIndex?: FoodIndexSpec;
  overrides?: Record<string, SheetOverride>;
  /** Other copies in the folder that are deliberately not loaded. */
  notLoaded?: string[];
};

const faoGroupSheets = (idColumn: string): FoodIndexSpec => ({
  sheetPattern: /^\d\d[ _]/,
  exclude: /fatty acids/i,
  idColumns: [idColumn],
  nameColumns: ["Food name in English", "Foodname in English"],
});

const CONFIG: Partial<Record<SourceId, XlsxSourceConfig>> = {
  wafct: {
    file: "WAFCT_2019.xlsx",
    indexColumns: ["Code", "Food name in English"],
    notLoaded: ["openknowledge-ca7779b/WAFCT_2019.xlsx (openknowledge.fao.org copy)"],
  },
  "wafct-2012": {
    file: "WestAfricanFCT_Userdatabase_2012_xls.xls",
    indexColumns: ["Code", "Food name in English"],
  },
  "fao-anfood": {
    file: "AnFooD2.0.xlsx",
    indexColumns: ["Food Item ID"],
    foodIndex: faoGroupSheets("Food Item ID"),
    notLoaded: ["openknowledge-i7360en/AnFooD2.0.xlsx (openknowledge.fao.org copy)"],
  },
  "fao-biofoodcomp": {
    file: "BioFoodComp4.0.xlsx",
    indexColumns: ["Food Item ID", "Code"],
    foodIndex: faoGroupSheets("Food Item ID"),
    notLoaded: ["openknowledge-i7364en/BioFoodComp4.0.xlsx (openknowledge.fao.org copy)"],
  },
  "fao-phyfoodcomp": {
    file: "PhyFoodComp_1.0.xlsx",
    indexColumns: ["Food item ID"],
    foodIndex: faoGroupSheets("Food item ID"),
    notLoaded: ["openknowledge-i8542en/PhyFoodComp_1.0.xlsx (openknowledge.fao.org copy)"],
  },
  "fao-pulsesdm": {
    file: "PulsesDM1.0.xlsx",
    indexColumns: ["FoodID", "Food name in English"],
    notLoaded: ["openknowledge-i7065en/PulsesDM1.0.xlsx (openknowledge.fao.org copy)"],
  },
  "fao-upulses": {
    file: "uPulses1.0.xlsx",
    indexColumns: ["FoodID", "Food name in English"],
    notLoaded: ["openknowledge-i6832en/uPulses1.0_Jul2026.xlsx (openknowledge.fao.org, re-issued Jul 2026)"],
  },
  "fao-ufish": {
    file: "uFiSh1.0.xlsx",
    indexColumns: ["Food Item ID", "Food item ID", "Food name in English"],
    notLoaded: [
      "openknowledge-i6655en/uFiSh1.0.xlsx (openknowledge.fao.org copy)",
      "openknowledge-i6655en/uFiSh1.0_Jul2026.xlsx (openknowledge.fao.org, re-issued Jul 2026)",
    ],
  },
  "fao-supplement": {
    file: "Copy_of_Supplement_DB_FINAL_FOR_FAO_2015_10_29.xlsx",
    indexColumns: ["Product ID", "ID", "Full product name", "Barcode"],
  },
  "fao-density": {
    file: "density_DB_v2_0_final-1__1_.xlsx",
    indexColumns: ["Food name and description"],
    notLoaded: ["../density-v1/Densitydatabasev2__1_.xls (v1, superseded)"],
  },
  frida: {
    file: "Frida_5.5_Dataset.xlsx",
    indexColumns: ["FoodID", "FoodName", "ParameterID", "FoodGroupID", "SourceID"],
    // Data_Table is the wide pivot: rows 1-4 are ParameterNavn / ParameterName / Unit / ParameterID.
    // Column C holds the FoodID; its header cell (row 4) reads "↓FoodID/→ParameterID".
    overrides: { Data_Table: { headerRows: [1, 2, 3, 4], nameRow: 2, names: { C: "↓FoodID/→ParameterID" } } },
    notLoaded: ["Frida_5.5_Dataset.ods (same data as the xlsx)", "frida/4.1 ... frida/5.4 (older releases)"],
  },
};

function buildFoodIndex(h: ReturnType<typeof openIngestDb>, spec: FoodIndexSpec, sheets: { sheet: string; table: string | null }[]): number {
  const { db } = h;
  db.exec(`DROP TABLE IF EXISTS _food_index`);
  db.exec(`CREATE TABLE _food_index (food_id, food_name, sheet TEXT, table_name TEXT, "_row" INTEGER)`);
  let n = 0;
  for (const s of sheets) {
    if (!s.table || !spec.sheetPattern.test(s.sheet) || spec.exclude?.test(s.sheet)) continue;
    const idCol = spec.idColumns.map((c) => findColumn(db, s.table!, c)).find(Boolean);
    const nameCol = spec.nameColumns.map((c) => findColumn(db, s.table!, c)).find(Boolean);
    if (!idCol || !nameCol) {
      console.warn(`  _food_index: sheet "${s.sheet}" has no id/name column, skipped`);
      continue;
    }
    const r = db
      .prepare(
        `INSERT INTO _food_index SELECT ${qi(idCol)}, ${qi(nameCol)}, ?, ?, "_row" FROM ${qi(s.table)} WHERE ${qi(idCol)} IS NOT NULL`,
      )
      .run(s.sheet, s.table);
    n += Number(r.changes);
  }
  return n;
}

export function xlsxLoader(id: SourceId): () => Promise<FinalizeResult> {
  return async () => {
    const source = getSource(id)!;
    const cfg = CONFIG[id];
    if (!cfg) throw new Error(`no xlsx config for ${id}`);
    const file = join(sourceRawDir(source.datasourcesDir), cfg.file);
    if (!existsSync(file)) throw new Error(`${file} missing`);
    console.log(`raw: ${file}`);
    const h = openIngestDb(source);
    const sheets = loadWorkbook(h.db, file, { overrides: cfg.overrides });
    for (const s of sheets) {
      console.log(
        `  [${s.sheet}] -> ${s.table ?? "(empty, no table)"}: ${s.dataRows} rows x ${s.columns} cols, header rows ${s.headerRows.join(",") || "-"}${s.status === "headerless" ? " (no header detected)" : ""}`,
      );
    }
    if (cfg.foodIndex) {
      const n = buildFoodIndex(h, cfg.foodIndex, sheets);
      console.log(`  _food_index: ${n} rows`);
    }
    for (const t of tableNames(h.db)) {
      if (t.startsWith("_") && t !== "_food_index") continue;
      indexColumnsIfPresent(h.db, t, cfg.indexColumns);
    }
    if (cfg.foodIndex) createIndex(h.db, "_food_index", ["table_name", "_row"]);
    indexFoodTable(h.db, source);
    return finalizeIngestDb(h, file, {
      loader: "xlsxSources.ts (every sheet as a table, header rows detected)",
      sheets: JSON.stringify(sheets),
      skipped: JSON.stringify(cfg.notLoaded ?? []),
    });
  };
}

export const xlsxSourceIds = Object.keys(CONFIG) as SourceId[];
