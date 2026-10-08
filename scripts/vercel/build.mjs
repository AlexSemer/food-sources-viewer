/**
 * Vercel build (vercel.json buildCommand: `npm run build:vercel`). Writes a Build Output API v3 tree:
 *
 *   .vercel/output/static/                  the Vite build of apps/web (SPA; unknown paths fall back to index.html)
 *   .vercel/output/functions/api.func/      apps/api bundled by esbuild (vercel.ts -> index.mjs) + data-sample/
 *   .vercel/output/functions/_middleware.func/  Basic-auth gate on every request (SITE_PASSWORD)
 *   .vercel/output/config.json              routes: middleware, /api/* -> the function, filesystem, SPA fallback
 *
 * Only data-sample/ (committed, `npm run sample`) is bundled; data/ is never read here. Runs on Vercel and locally.
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, ".vercel/output");
const fn = join(out, "functions/api.func");
const mw = join(out, "functions/_middleware.func");
const sampleDir = join(root, "data-sample");
// Functions run on the build's Node major (package.json engines: 24.x); node:sqlite is unflagged from 22.13 / 24.
const nodeMajor = Number(process.versions.node.split(".")[0]) >= 24 ? 24 : 22;
const runtime = `nodejs${nodeMajor}.x`;

const sqlite = existsSync(sampleDir) ? readdirSync(sampleDir).filter((f) => f.endsWith(".sqlite")) : [];
if (!sqlite.length) throw new Error("data-sample/ has no .sqlite files; run `npm run sample` first");

console.log("> web: tsc -b && vite build");
execSync("npm run build --workspace=@fsv/web", { cwd: root, stdio: "inherit" });

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "static"), { recursive: true });
cpSync(join(root, "apps/web/dist"), join(out, "static"), { recursive: true });

console.log(`> api: esbuild apps/api/src/vercel.ts (${runtime})`);
await build({
  entryPoints: [join(root, "apps/api/src/vercel.ts")],
  outfile: join(fn, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: `node${nodeMajor}`,
  sourcemap: true,
  logLevel: "warning",
});
mkdirSync(join(fn, "data-sample/_relations"), { recursive: true });
let bytes = 0;
for (const f of sqlite) {
  cpSync(join(sampleDir, f), join(fn, "data-sample", f));
  bytes += statSync(join(sampleDir, f)).size;
}
if (existsSync(join(sampleDir, "_relations"))) cpSync(join(sampleDir, "_relations"), join(fn, "data-sample/_relations"), { recursive: true });
writeFileSync(
  join(fn, ".vc-config.json"),
  JSON.stringify(
    {
      runtime,
      handler: "index.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: false,
      shouldAddSourcemapSupport: true,
      supportsResponseStreaming: true,
      maxDuration: 30,
      environment: { FSV_SAMPLE: "1" },
    },
    null,
    2,
  ),
);
console.log(`  bundled ${sqlite.length} sample dbs (${(bytes / 1048576).toFixed(1)} MB): ${sqlite.join(", ")}`);

mkdirSync(mw, { recursive: true });
cpSync(join(root, "scripts/vercel/middleware.js"), join(mw, "index.js"));
writeFileSync(join(mw, ".vc-config.json"), JSON.stringify({ runtime: "edge", entrypoint: "index.js", envVarsInUse: ["SITE_PASSWORD"] }, null, 2));

writeFileSync(
  join(out, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "/(.*)", middlewarePath: "_middleware", continue: true },
        { src: "^/api/(.*)$", dest: "/api?__fsv_path=$1" },
        { handle: "filesystem" },
        { src: "^/assets/(.*)$", status: 404 },
        { src: "/(.*)", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);
console.log(`> wrote ${out}`);
