/**
 * Vercel function entry (bundled by scripts/vercel/build.mjs into .vercel/output/functions/api.func/index.mjs).
 * Same handler as the local server; config.json rewrites /api/<path> to this function as /api?__fsv_path=<path>,
 * so the original path is restored first when the platform passes the rewritten URL.
 */
import "./vercel-env.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handle } from "./app.ts";

export function restorePath(rawUrl: string): string {
  const url = new URL(rawUrl, "http://localhost");
  const path = url.searchParams.get("__fsv_path");
  if (path === null) return rawUrl;
  url.searchParams.delete("__fsv_path");
  const segments = path.split("/").filter(Boolean).map(encodeURIComponent);
  const qs = url.searchParams.toString();
  return `/api/${segments.join("/")}${qs ? `?${qs}` : ""}`;
}

export default function vercelHandler(req: IncomingMessage, res: ServerResponse): void {
  req.url = restorePath(req.url ?? "/");
  handle(req, res);
}
