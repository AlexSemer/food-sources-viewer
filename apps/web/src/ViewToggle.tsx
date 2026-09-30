import { Link } from "react-router-dom";

export type SourceView = "single" | "all";

/** Single table / All tables switch. The mode lives in the URL: /s/:id (single) or /s/:id?view=all. */
export function ViewToggle({ sourceId, view }: { sourceId: string; view: SourceView }) {
  const items: { view: SourceView; label: string; to: string }[] = [
    { view: "single", label: "Single table", to: `/s/${sourceId}` },
    { view: "all", label: "All tables", to: `/s/${sourceId}?view=all` },
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