import { usdaLoader } from "./usdaFdc.ts";

export { findCsvDir } from "./usdaFdc.ts";

/** USDA Foundation Foods: now the shared FoodData Central CSV loader (every CSV table). */
export const ingestUsdaFoundation = usdaLoader("usda-foundation");
