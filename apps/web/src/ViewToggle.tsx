import { Link } from "react-router-dom";

export type SourceView = "single" | "all" | "composite" | "relations";

export function parseView(v: string | null): SourceView {
  return v === "all" || v === "composite" || v === "relations" ? v : "single";
}

/**
 * Single table / All tables / Composite / Relations switch. The mode lives in the URL:
 * /s/:id (single), /s/:id?view=all, ?view=composite, ?view=relations.
 */
export function ViewToggle({ sourceId, view, query = "" }: { sourceId: string; view: SourceView; query?: string }) {
  // `query` = params kept across views (the store's ?preset=).
  const to = (v: string) => {
    const qs = [v && `view=${v}`, query].filter(Boolean).join("&");
    return `/s/${sourceId}${qs ? `?${qs}` : ""}`;
  };
  const items: { view: SourceView; label: string; to: string }[] = [
    { view: "single", label: "Single table", to: to("") },
    { view: "all", label: "All tables", to: to("all") },
    { view: "composite", label: "Composite", to: to("composite") },
    { view: "relations", label: "Relations", to: to("relations") },
  ];
  return (
    <div className="view-toggle" role="group" aria-label="Table view">
      {items.map((it) =>
        it.view === view ? (
          <span key={it.view} className="active" aria-current="true">
            {it.label}
          </span>
        ) : (
          <Link key={it.view} to={it.to}>
            {it.label}
          </Link>
        ),
      )}
    </div>
  );
}