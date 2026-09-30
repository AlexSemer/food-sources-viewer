import type { Ctx, Spec } from "./composite-specs.ts";
import { usdaSpec } from "./composite-usda.ts";
import { foodbSpec, fridaSpec } from "./composite-long.ts";
import { faoIndexSpec, offSpec, supplementSpec, wideSpecFor } from "./composite-wide.ts";

/** Composite definition for a source (see composite-specs.ts for the shared rules). */
export function specFor(ctx: Ctx): Spec {
  const id = ctx.sourceId;
  if (id.startsWith("usda-")) return usdaSpec(ctx);
  if (id === "foodb") return foodbSpec(ctx);
  if (id === "frida") return fridaSpec(ctx);
  if (id === "off") return offSpec(ctx);
  if (id === "fao-supplement") return supplementSpec(ctx);
  if (ctx.source.foodTable === "_food_index") return faoIndexSpec(ctx);
  return wideSpecFor(ctx);
}
