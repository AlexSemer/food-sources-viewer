import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "../../..");
export const datasourcesRoot = resolve(repoRoot, "datasources");

/** When datasources/ is empty, reuse the Grok project landing zone. */
export function sourceRawDir(relative: string): string {
  const preferred = resolve(datasourcesRoot, relative);
  const fallback = resolve(repoRoot, "../data/raw", relative);
  return existsSync(preferred) ? preferred : fallback;
}
export const dataRoot = resolve(repoRoot, "data");

export function ensureDataDir(): void {
  mkdirSync(dataRoot, { recursive: true });
}
