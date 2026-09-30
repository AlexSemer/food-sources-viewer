import { Link } from "react-router-dom";

export type SourceView = "single" | "all" | "composite" | "relations";

export function parseView(v: string | null): SourceView {
  return v === "all" || v === "composite" || v === "relations" ? v : "single";
}

/**
 * Single table / All tables / Composite / Relations switch. The mode lives in the URL:
 * /s/:id (single), /s/:id?view=all, ?view=composite, ?view=relations.
 */
export function ViewToggle({ sourceId, view }: { sourceId: string; view: SourceView }) {
  const items: { view: SourceView; label: string; to: string }[] = [
    { view: "single", label: "Single table", to: `/s/${sourceId}` },
    { view: "all", label: "All tables", to: `/s/${sourceId}?view=all` },
    { view: "composite", label: "Composite", to: `/s/${sourceId}?view=composite` },
    { view: "relations", label: "Relations", to: `/s/${sourceId}?view=relations` },
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