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
  | "foodb";

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
  /** Extra foodTable columns shown in the food search results. */
  foodListFields?: string[];
  /** Optional equality filter column for the food search (USDA data_type). */
  foodTypeField?: string;
  foodTypeDefault?: string;
  foodJoins?: FoodJoin[];
  foodRelated?: FoodRelated[];
  /** USDA FDC layout: food page lists food_nutrient joined to nutrient. */
  usdaNutrients?: boolean;
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
];

export function getSource(id: string): SourceDef | undefined {
  return sources.find((s) => s.id === id);
}
