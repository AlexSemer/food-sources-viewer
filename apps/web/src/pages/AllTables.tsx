import { FormEvent, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router-dom";
import { getJson, isAbort, limited } from "../api";
import { DataTable } from "../DataTable";
import { layoutKey, resetLayout, useStoredState } from "../layout";

/** Rows per panel page. */
const PAGE_SIZE = 25;
/** Server-side time budget for a panel search, so a LIKE scan over millions of rows cannot stall the API. */
const SEARCH_TIMEOUT_MS = 1500;

/** Panel sizing (px). GAP must match `.panel-grid { gap }` in styles.css. */
const GAP = 12;
/** Default panels share each row evenly, as many per row as fit at this minimum width. */
const PANEL_MIN_COL = 460;
const MIN_W = 300;
const MIN_H = 220;
const MAX_H = 2400;
/** A dragged width this close to a whole number of columns snaps to it (and then follows the window). */
const SNAP = 24;
const EXPANDED_H = "max(600px, 78vh)";

export type TableSummary = { name: string; rows: number; columns?: number };

type PageRes = {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  totalCapped: boolean;
  page: number;
  pageSize: number;
  searchedColumns?: string[];
  timedOut?: boolean;
};

/** Stored per source + table. `span` = width in grid columns; `w` = free width in px; `eh` = expanded height. */
type PanelLayout = { w?: number; span?: number; h?: number; expanded?: boolean; eh?: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Every table of a source as its own panel. Panels fetch only once they are near the viewport. */
export function AllTables({ sourceId, tables, foodTable }: { sourceId: string; tables: TableSummary[]; foodTable?: string }) {
  const [filter, setFilter] = useState("");
  const f = filter.trim().toLowerCase();
  const shown = f ? tables.filter((t) => t.name.toLowerCase().includes(f)) : tables;
  const totalRows = tables.reduce((n, t) => n + t.rows, 0);
  const gridRef = useRef<HTMLDivElement>(null);

  // --panel-w = width of one default panel, so the flex-wrap row reads like an even grid.
  useEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const cols = Math.max(1, Math.floor((w + GAP) / (PANEL_MIN_COL + GAP)));
      el.style.setProperty("--panel-w", `${Math.floor((w - GAP * (cols - 1)) / cols)}px`);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="all-tables">
      <div className="row">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter table names" />
        <button
          type="button"
          className="link-button"
          title="Forget panel sizes, expanded panels and column widths for this source"
          onClick={() => resetLayout(sourceId)}
        >
          reset layout
        </button>
        <span className="muted">
          {shown.length === tables.length ? `${tables.length} tables` : `${shown.length} of ${tables.length} tables`}
          {" \u00b7 "}
          {totalRows.toLocaleString()} rows in total{" \u00b7 "}
          {PAGE_SIZE} rows per page; panels load as they scroll into view
        </span>
      </div>
      {shown.length === 0 ? <p className="muted">No table name contains "{filter.trim()}".</p> : null}
      <div className="panel-grid" ref={gridRef}>
        {shown.map((t) => (
          <TablePanel key={t.name} sourceId={sourceId} table={t} isFoodTable={t.name === foodTable} />
        ))}
      </div>
    </div>
  );
}

/** True while the element is within ~one screen of the viewport. */
function useNearViewport<T extends Element>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver((entries) => setNear(entries[entries.length - 1].isIntersecting), {
      rootMargin: "300px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, near] as const;
}

function TablePanel({ sourceId, table, isFoodTable }: { sourceId: string; table: TableSummary; isFoodTable: boolean }) {
  const [ref, near] = useNearViewport<HTMLElement>();
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<PageRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [layout, setLayout] = useStoredState<PanelLayout>(layoutKey(sourceId, table.name, "panel"));
  const [drag, setDrag] = useState<{ w?: number; h: number } | null>(null);

  const key = JSON.stringify([q, page, attempt]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const inflight = useRef<string | null>(null);

  useEffect(() => {
    if (!near || loadedKey === key || inflight.current === key) return;
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (q) {
      params.set("q", q);
      params.set("timeout", String(SEARCH_TIMEOUT_MS));
    }
    const url = `/api/sources/${encodeURIComponent(sourceId)}/tables/${encodeURIComponent(table.name)}?${params}`;
    const ctrl = new AbortController();
    let started = false;
    inflight.current = key;
    limited(() => {
      started = true;
      return getJson<PageRes>(url);
    }, ctrl.signal)
      .then((res) => {
        if (currentKey.current !== key) return;
        setData(res);
        setError(null);
        setLoadedKey(key);
      })
      .catch((e: unknown) => {
        if (isAbort(e) || currentKey.current !== key) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoadedKey(key);
      })
      .finally(() => {
        if (inflight.current === key) inflight.current = null;
      });
    // Scrolled away (or state changed) before the request left the queue: drop it. A request that
    // already started is left to finish, and its result is kept if it is still the one wanted.
    return () => {
      ctrl.abort();
      if (!started && inflight.current === key) inflight.current = null;
    };
  }, [near, key, loadedKey, sourceId, table.name, q, page]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setQ(draft.trim());
    setPage(1);
  }

  function toggleExpanded() {
    setLayout((p) => ({ ...p, expanded: !p.expanded || undefined }));
    requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "nearest" }));
  }

  /** Bottom-right corner drag. Width snaps to whole grid columns when close; expanded panels only change height. */
  function startResize(e: ReactPointerEvent<HTMLSpanElement>) {
    const panel = ref.current;
    const grid = panel?.parentElement;
    if (e.button !== 0 || !panel || !grid) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const start = panel.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const maxW = grid.clientWidth;
    const expanded = !!layout.expanded;
    let cur: { w?: number; h: number } | null = null;
    let frame = 0;
    document.body.classList.add(expanded ? "panel-resizing-y" : "panel-resizing");
    const move = (ev: PointerEvent) => {
      cur = {
        h: clamp(Math.round(start.height + ev.clientY - sy), MIN_H, MAX_H),
        w: expanded ? undefined : clamp(Math.round(start.width + ev.clientX - sx), Math.min(MIN_W, maxW), maxW),
      };
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          setDrag(cur);
        });
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      cancelAnimationFrame(frame);
      document.body.classList.remove("panel-resizing", "panel-resizing-y");
      const final = cur;
      setDrag(null);
      if (!final) return;
      if (expanded) {
        setLayout((p) => ({ ...p, eh: final.h }));
        return;
      }
      let w = final.w;
      let span: number | undefined;
      const colW = parseFloat(getComputedStyle(grid).getPropertyValue("--panel-w")) || 0;
      if (colW && w !== undefined) {
        const k = Math.max(1, Math.round((w + GAP) / (colW + GAP)));
        if (Math.abs(k * colW + (k - 1) * GAP - w) <= SNAP) {
          span = k;
          w = undefined;
        }
      }
      setLayout((p) => ({ ...p, h: final.h, w, span: span && span > 1 ? span : undefined }));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  const style: CSSProperties = {};
  if (layout.expanded) {
    style.flex = "0 0 100%";
    style.height = layout.eh ?? EXPANDED_H;
  } else {
    if (layout.span && layout.span > 1) {
      style.flex = "0 0 auto";
      style.width = `calc(${layout.span} * var(--panel-w, ${PANEL_MIN_COL}px) + ${(layout.span - 1) * GAP}px)`;
    } else if (layout.w) {
      style.flex = "0 0 auto";
      style.width = layout.w;
    }
    if (layout.h) style.height = layout.h;
  }
  if (drag) {
    style.height = drag.h;
    if (drag.w !== undefined) {
      style.flex = "0 0 auto";
      style.width = drag.w;
    }
  }

  const loading = loadedKey !== key;
  const failed = !loading && error !== null;
  const pages = data && !data.totalCapped ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : null;
  const canNext = !!data && !loading && !failed && data.rows.length >= PAGE_SIZE && (pages === null || page < pages);

  let body;
  if (failed) {
    body = (
      <div className="panel-state">
        <p className="error">{error}</p>
        <button type="button" onClick={() => setAttempt(attempt + 1)}>
          Retry
        </button>
      </div>
    );
  } else if (!data) {
    body = <p className="panel-state muted">{near ? "Loading\u2026" : "Waiting to scroll into view"}</p>;
  } else if (data.rows.length === 0 && !loading) {
    body = (
      <p className="panel-state muted">
        {q
          ? `No rows match "${q}"${data.timedOut ? ` in the part scanned within ${SEARCH_TIMEOUT_MS / 1000} s` : ""}.`
          : page > 1
            ? "No rows on this page."
            : "This table is empty."}
      </p>
    );
  } else {
    body = <DataTable sourceId={sourceId} table={table.name} columns={data.columns} rows={data.rows} compact />;
  }

  return (
    <section
      className={layout.expanded ? "panel expanded" : "panel"}
      ref={ref}
      style={style}
      data-table={table.name}
      aria-busy={loading && near}
    >
      <div className="panel-head">
        <Link to={`/s/${sourceId}/tables/${encodeURIComponent(table.name)}`} title="Open in single-table view">
          {table.name}
        </Link>
        {isFoodTable ? <span className="badge">foods</span> : null}
        <span className="muted">
          {table.rows.toLocaleString()} rows
          {table.columns !== undefined ? ` \u00b7 ${table.columns} cols` : ""}
        </span>
        <button
          type="button"
          className="panel-expand"
          aria-pressed={!!layout.expanded}
          title={layout.expanded ? "Back to normal size" : "Full width, taller"}
          onClick={toggleExpanded}
        >
          {layout.expanded ? "collapse" : "expand"}
        </button>
      </div>
      <form className="panel-search" onSubmit={onSearch}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="filter any column" aria-label={`Filter ${table.name}`} />
        <button type="submit">Filter</button>
        {q ? (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              setQ("");
              setPage(1);
            }}
          >
            Clear
          </button>
        ) : null}
      </form>
      {data?.searchedColumns && q ? (
        <p className="panel-note muted">Large table: searches indexed columns only ({data.searchedColumns.join(", ")}).</p>
      ) : null}
      {data?.timedOut && !loading ? (
        <p className="panel-note muted">Search stopped after {SEARCH_TIMEOUT_MS / 1000} s; results are partial.</p>
      ) : null}
      <div className={`panel-body${loading && data ? " stale" : ""}`}>{body}</div>
      <div className="panel-foot">
        <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
          Prev
        </button>
        <span>
          page {page}
          {pages !== null ? ` of ${pages.toLocaleString()}` : ""}
        </span>
        <button type="button" disabled={!canNext} onClick={() => setPage(page + 1)}>
          Next
        </button>
        <span className="muted">
          {loading && near ? "loading\u2026" : q && data ? `${data.total.toLocaleString()}${data.totalCapped ? "+" : ""} matches` : ""}
        </span>
      </div>
      <span
        className="panel-resize"
        title="Drag to resize; double-click to reset size"
        onPointerDown={startResize}
        onDoubleClick={() => setLayout((p) => ({ expanded: p.expanded }))}
      />
    </section>
  );
}