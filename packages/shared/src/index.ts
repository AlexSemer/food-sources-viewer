export type SourceId =
  | "usda-foundation"
  | "usda-sr-legacy"
  | "usda-fndds"
  | "usda-branded"
  | "usda-full"
  | "off"
  | "wafct"
  | "wafct-2012"
  | "fao-anfood"
  | "fao-biofoodcomp"
  | "fao-phyfoodcomp"
  | "fao-pulsesdm"
  | "fao-upulses"
  | "fao-ufish"
  | "fao-supplement"
  | "fao-density"
  | "frida"
  | "foodb"
  | "store";

/** Display-only lookup: adds column `as` = `table.value` where `table.key` = food.`foodField`. */
export type FoodJoin = {
  as: string;
  table: string;
  key: string;
  value: string;
  foodField: string;
};

/**
 * Rows of `table` whose `field` equals the food's `foodField` (default: foodIdField).
 * `table: "*"` means every table in this source's db that has a column named `field`
 * (except foodTable and `exclude`). Same source only: there is no cross-source linking.
 */
export type FoodRelated = {
  table: string;
  field: string;
  foodField?: string;
  limit?: number;
  exclude?: string[];
};

/**
 * One dataset inside a multi-dataset db (the NUTRI store, docs/store-schema.md): a food table and its amount
 * table. A preset only says which pair is read; two presets are never mixed.
 */
export type SourcePreset = {
  id: string;
  label: string;
  foodTable: string;
  amountTable: string;
  foodIdField: string;
  foodNameField: string;
  foodListFields?: string[];
  /** nutrient_code.family / source_version of this dataset's tickets. */
  family: string;
  codeVersion: string;
  /** Existing raw viewer entry with the same food ids (food page link). */
  rawSourceId?: SourceId;
  /** Headline ticket per Nutrient (docs/decisions/HEADLINES.md); a Nutrient without one has no headline marker. */
  headlines?: Record<string, { code: string; expression: string }>;
};

export type SourceDef = {
  id: SourceId;
  label: string;
  version: string;
  dbFile: string;
  datasourcesDir: string;
  implemented: boolean;
  /** Table the Foods search / food page reads. */
  foodTable: string;
  foodIdField: string;
  foodNameField: string;
  /**
   * foodTable is long-format: several rows per foodIdField (e.g. one per product × component). The Foods list
   * then shows one row per id; the food page lists all of the id's rows in either case.
   */
  foodIdRepeats?: boolean;
  /** Extra foodTable columns shown in the food search results. */
  foodListFields?: string[];
  /** Optional equality filter column for the food search (USDA data_type). */
  foodTypeField?: string;
  foodTypeDefault?: string;
  foodJoins?: FoodJoin[];
  foodRelated?: FoodRelated[];
  /** USDA FDC layout: food page lists food_nutrient joined to nutrient. */
  usdaNutrients?: boolean;
  /** Datasets behind a dropdown (?preset=); the first is the default. foodTable etc. are the default's. */
  presets?: SourcePreset[];
};

const usda = (
  s: Pick<SourceDef, "id" | "label" | "version" | "dbFile" | "datasourcesDir"> &
    Partial<SourceDef>,
): SourceDef => ({
  implemented: true,
  foodTable: "food",
  foodIdField: "fdc_id",
  foodNameField: "description",
  foodListFields: ["data_type", "publication_date"],
  foodTypeField: "data_type",
  usdaNutrients: true,
  foodRelated: [{ table: "*", field: "fdc_id", exclude: ["food_nutrient"], limit: 50 }],
  ...s,
});

const usdaCategory: FoodJoin = {
  as: "category",
  table: "food_category",
  key: "id",
  value: "description",
  foodField: "food_category_id",
};

const xlsx = (
  s: Pick<
    SourceDef,
    "id" | "label" | "version" | "dbFile" | "datasourcesDir" | "foodTable" | "foodIdField" | "foodNameField"
  > &
    Partial<SourceDef>,
): SourceDef => ({
  implemented: true,
  foodRelated: [{ table: "*", field: s.foodIdField, limit: 50 }],
  ...s,
});

/** FAO multi-sheet tables: foods live in one sheet per food group; `_food_index` points at them. */
const faoIndexed = (
  s: Pick<SourceDef, "id" | "label" | "version" | "dbFile" | "datasourcesDir">,
  sheetIdColumn: string,
): SourceDef =>
  xlsx({
    ...s,
    foodTable: "_food_index",
    foodIdField: "food_id",
    foodNameField: "food_name",
    foodListFields: ["sheet"],
    foodRelated: [{ table: "*", field: sheetIdColumn, foodField: "food_id", limit: 20 }],
  });

export const sources: SourceDef[] = [
  usda({
    id: "usda-foundation",
    label: "USDA Foundation Foods",
    version: "2026-04-30",
    dbFile: "usda-foundation.sqlite",
    datasourcesDir: "usda-fdc/foundation-2026-04-30",
    foodTypeDefault: "foundation_food",
    foodJoins: [usdaCategory],
  }),
  usda({
    id: "usda-sr-legacy",
    label: "USDA SR Legacy",
    version: "2018-04",
    dbFile: "usda-sr-legacy.sqlite",
    datasourcesDir: "usda-fdc/sr-legacy-2018-04",
    foodTypeDefault: "sr_legacy_food",
    foodJoins: [usdaCategory],
  }),
  usda({
    id: "usda-fndds",
    label: "USDA FNDDS (Survey Foods)",
    version: "2024-10-31",
    dbFile: "usda-fndds.sqlite",
    datasourcesDir: "usda-fdc/fndds-2024-10-31",
    foodTypeDefault: "survey_fndds_food",
    foodJoins: [
      {
        as: "wweia_category",
        table: "wweia_food_category",
        key: "wweia_food_category",
        value: "wweia_food_category_description",
        foodField: "food_category_id",
      },
    ],
  }),
  usda({
    id: "usda-branded",
    label: "USDA Branded Foods",
    version: "2026-04-30",
    dbFile: "usda-branded.sqlite",
    datasourcesDir: "usda-fdc/branded-2026-04-30",
    foodTypeDefault: "branded_food",
    foodJoins: [
      { as: "brand_owner", table: "branded_food", key: "fdc_id", value: "brand_owner", foodField: "fdc_id" },
      {
        as: "branded_food_category",
        table: "branded_food",
        key: "fdc_id",
        value: "branded_food_category",
        foodField: "fdc_id",
      },
    ],
  }),
  usda({
    id: "usda-full",
    label: "USDA FoodData Central Full Download (all data types)",
    version: "2026-04-30",
    dbFile: "usda-full.sqlite",
    datasourcesDir: "usda-fdc/full-2026-04-30",
    foodTypeDefault: "all",
    foodJoins: [usdaCategory],
  }),
  {
    id: "off",
    label: "Open Food Facts",
    version: "csv-en",
    dbFile: "off.sqlite",
    datasourcesDir: "openfoodfacts",
    implemented: true,
    foodTable: "product",
    foodIdField: "code",
    foodNameField: "product_name",
    foodListFields: ["brands", "quantity", "countries_en", "nutriscore_grade"],
  },
  xlsx({
    id: "wafct",
    label: "FAO/INFOODS WAFCT",
    version: "2019",
    dbFile: "wafct.sqlite",
    datasourcesDir: "fao-infoods/wafct-2019",
    foodTable: "05_NV_sum_57_per_100g_EP",
    foodIdField: "Code",
    foodNameField: "Food name in English",
    foodListFields: ["Food name in French", "Scientific name"],
  }),
  xlsx({
    id: "wafct-2012",
    label: "FAO/INFOODS WAFCT (West African FCT)",
    version: "2012",
    dbFile: "wafct-2012.sqlite",
    datasourcesDir: "fao-infoods/wafct-2012",
    foodTable: "USERDATABASE",
    foodIdField: "Code",
    foodNameField: "Food name in English",
    foodListFields: ["Foodname in French", "Scientific name"],
  }),
  faoIndexed(
    {
      id: "fao-anfood",
      label: "FAO/INFOODS AnFooD (analytical food composition)",
      version: "2.0",
      dbFile: "fao-anfood.sqlite",
      datasourcesDir: "fao-infoods/anfood-2.0",
    },
    "Food Item ID",
  ),
  faoIndexed(
    {
      id: "fao-biofoodcomp",
      label: "FAO/INFOODS BioFoodComp (biodiversity)",
      version: "4.0",
      dbFile: "fao-biofoodcomp.sqlite",
      datasourcesDir: "fao-infoods/biofoodcomp-4.0",
    },
    "Food Item ID",
  ),
  faoIndexed(
    {
      id: "fao-phyfoodcomp",
      label: "FAO/INFOODS/IZiNCG PhyFoodComp (phytate)",
      version: "1.0",
      dbFile: "fao-phyfoodcomp.sqlite",
      datasourcesDir: "fao-infoods/phyfoodcomp-1.0",
    },
    "Food item ID",
  ),
  xlsx({
    id: "fao-pulsesdm",
    label: "FAO/INFOODS PulsesDM (pulses, dry matter)",
    version: "1.0",
    dbFile: "fao-pulsesdm.sqlite",
    datasourcesDir: "fao-infoods/pulsesdm-1.0",
    foodTable: "04_NV_sum_per_100_g_EPDM",
    foodIdField: "FoodID",
    foodNameField: "Food name in English",
    foodListFields: ["Processing", "Species/Subspecies"],
  }),
  xlsx({
    id: "fao-upulses",
    label: "FAO/INFOODS uPulses (pulses)",
    version: "1.0",
    dbFile: "fao-upulses.sqlite",
    datasourcesDir: "fao-infoods/upulses-1.0",
    foodTable: "04_NV_sum_per_100_g_EP_on_FW",
    foodIdField: "FoodID",
    foodNameField: "Food name in English",
    foodListFields: ["Processing", "Species/Subspecies"],
  }),
  xlsx({
    id: "fao-ufish",
    label: "FAO/INFOODS uFiSh (fish and shellfish)",
    version: "1.0",
    dbFile: "fao-ufish.sqlite",
    datasourcesDir: "fao-infoods/ufish-1.0",
    foodTable: "04_NV_sum_per_100_g_EP",
    foodIdField: "Food Item ID",
    foodNameField: "Food name in English",
    foodListFields: ["3-Alpha", "State of food"],
  }),
  xlsx({
    id: "fao-supplement",
    label: "FAO/INFOODS Supplement DB",
    version: "2015-10-29",
    dbFile: "fao-supplement.sqlite",
    datasourcesDir: "fao-infoods/supplement-db-1",
    foodTable: "Main_extract",
    foodIdField: "Product ID",
    foodNameField: "Full product name",
    foodIdRepeats: true,
    foodListFields: ["Country name", "Brand Name", "Supplement group name"],
  }),
  xlsx({
    id: "fao-density",
    label: "FAO/INFOODS Density Database",
    version: "2.0",
    dbFile: "fao-density.sqlite",
    datasourcesDir: "fao-infoods/density-v2",
    foodTable: "Density_DB",
    foodIdField: "_row",
    foodNameField: "Food name and description",
    foodListFields: ["Specific gravity", "BiblioID"],
    foodRelated: [],
  }),
  xlsx({
    id: "frida",
    label: "Frida (DTU Food Institute)",
    version: "5.5",
    dbFile: "frida.sqlite",
    datasourcesDir: "frida/5.5",
    foodTable: "Food",
    foodIdField: "FoodID",
    foodNameField: "FoodName",
    foodListFields: ["FødevareNavn", "FoodGroup"],
    foodRelated: [
      { table: "Data_Table", field: "↓FoodID/→ParameterID", limit: 1 },
      { table: "*", field: "FoodID", limit: 300 },
    ],
  }),
  {
    id: "foodb",
    label: "FooDB",
    version: "2020-04-07",
    dbFile: "foodb.sqlite",
    datasourcesDir: "foodb/2020-04-07",
    implemented: true,
    foodTable: "Food",
    foodIdField: "id",
    foodNameField: "name",
    foodListFields: ["public_id", "name_scientific", "food_group", "food_subgroup"],
    foodRelated: [{ table: "*", field: "food_id", limit: 200 }],
  },
  {
    id: "store",
    label: "NUTRI store (schema v1)",
    version: "v1",
    dbFile: "store.sqlite",
    datasourcesDir: "",
    implemented: true,
    // Default preset (usda_foundation); the food page lists the amount rows itself, so no generic related scan.
    foodTable: "usda_foundation_food",
    foodIdField: "fdc_id",
    foodNameField: "name",
    foodListFields: ["group_code", "n_factor"],
    foodRelated: [],
    presets: [
      {
        id: "usda_foundation",
        label: "USDA Foundation 2026-04-30",
        foodTable: "usda_foundation_food",
        amountTable: "usda_foundation_amount",
        foodIdField: "fdc_id",
        foodNameField: "name",
        foodListFields: ["group_code", "n_factor"],
        family: "usda",
        codeVersion: "foundation-2026-04-30",
        rawSourceId: "usda-foundation",
        headlines: {
          energy: { code: "208", expression: "" },
          vit_a: { code: "320", expression: "RAE" },
          vit_b9: { code: "435", expression: "DFE" },
          vit_e: { code: "323", expression: "alpha_tocopherol" },
        },
      },
    ],
  },
];

export function getSource(id: string): SourceDef | undefined {
  return sources.find((s) => s.id === id);
}

/** The named preset of a source (default: the first); undefined for sources without presets or an unknown id. */
export function presetOf(source: SourceDef, presetId?: string | null): SourcePreset | undefined {
  if (!source.presets?.length) return undefined;
  if (!presetId) return source.presets[0];
  return source.presets.find((p) => p.id === presetId);
}

/** The source as seen through one preset: foodTable / ids / names come from that preset. Others are returned as is. */
export function withPreset(source: SourceDef, presetId?: string | null): SourceDef {
  if (!source.presets?.length) return source;
  const p = presetOf(source, presetId);
  if (!p) throw Object.assign(new Error(`unknown preset: ${presetId}`), { status: 400 });
  return {
    ...source,
    foodTable: p.foodTable,
    foodIdField: p.foodIdField,
    foodNameField: p.foodNameField,
    foodListFields: p.foodListFields,
  };
}
