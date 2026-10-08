/**
 * Vercel function environment, evaluated before db.ts (vercel.ts imports this first): the sample dbs are bundled
 * next to the function file in data-sample/, and the API runs in sample (read-only) mode.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.FSV_DATA_DIR ??= join(dirname(fileURLToPath(import.meta.url)), "data-sample");
process.env.FSV_SAMPLE ??= "1";
