export type SourceId =
  | "usda-foundation"
  | "usda-sr-legacy"
  | "off"
  | "wafct"
  | "frida"
  | "foodb";

export type SourceDef = {
  id: SourceId;
  label: string;
  version: string;
  dbFile: string;
  datasourcesDir: string;
  implemented: boolean;
  foodIdField: string;
  foodNameField: string;
  foodTable: string;
};

export const sources: SourceDef[] = [
  {
    id: "usda-foundation",
    label: "USDA Foundation Foods",
    version: "2026-04-30",
    dbFile: "usda-foundation.sqlite",
    datasourcesDir: "usda-fdc/foundation-2026-04-30",
    implemented: true,
    foodIdField: "fdc_id",
    foodNameField: "description",
    foodTable: "food",
  },
  {
    id: "usda-sr-legacy",
    label: "USDA SR Legacy",
    version: "2018-04",
    dbFile: "usda-sr-legacy.sqlite",
    datasourcesDir: "usda-fdc/sr-legacy-2018-04",
    implemented: false,
    foodIdField: "fdc_id",
    foodNameField: "description",
    foodTable: "food",
  },
  {
    id: "off",
    label: "Open Food Facts",
    version: "csv-en",
    dbFile: "off.sqlite",
    datasourcesDir: "openfoodfacts",
    implemented: false,
    foodIdField: "code",
    foodNameField: "product_name",
    foodTable: "product",
  },
  {
    id: "wafct",
    label: "FAO/INFOODS WAFCT",
    version: "2019",
    dbFile: "wafct.sqlite",
    datasourcesDir: "fao-infoods/wafct-2019",
    implemented: false,
    foodIdField: "Code",
    foodNameField: "Food name in English",
    foodTable: "foods",
  },
  {
    id: "frida",
    label: "Frida",
    version: "5.5",
    dbFile: "frida.sqlite",
    datasourcesDir: "frida/5.5",
    implemented: false,
    foodIdField: "FoodID",
    foodNameField: "FoodName",
    foodTable: "Food",
  },
  {
    id: "foodb",
    label: "FooDB",
    version: "2020-04-07",
    dbFile: "foodb.sqlite",
    datasourcesDir: "foodb/2020-04-07",
    implemented: false,
    foodIdField: "public_id",
    foodNameField: "name",
    foodTable: "food",
  },
];

export function getSource(id: string): SourceDef | undefined {
  return sources.find((s) => s.id === id);
}
