import { memo, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { layoutKey, useStoredState } from "./layout";

const MIN_COL = 40;
const MAX_COL = 1200;
/** Double-click auto-fit never makes a column wider than this. */
const AUTOFIT_MAX = 480;
/** th/td horizontal padding (8px + 8px in styles.css). */
const CELL_PAD_X = 16;

const cellText = (v: unknown) => (v == null ? "" : String(v));
const isTruncated = (el: HTMLElement) => el.scrollWidth > el.clientWidth + 1;

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, el: Element): number {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * 7;
  const cs = getComputedStyle(el);
  measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  return measureCtx.measureText(text).width;
}

type Props = {
  sourceId: string;
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  /** Panel look: cells stay on one line and are capped at a default width until resized. */
  compact?: boolean;
};

/**
 * Rows of one table with resizable columns. Drag a header edge to resize, double-click it to fit the
 * content. Widths are remembered per source + table. A resized column truncates; hovering a truncated
 * cell shows the full value and clicking it wraps that row (click again to unwrap).
 */
export const DataTable = memo(function DataTable({ sourceId, table, columns, rows, compact = false }: Props) {
  const [widths, setWidths] = useStoredState<Record<string, number>>(layoutKey(sourceId, table, "cols"));
  const tableRef = useRef<HTMLTableElement>(null);
  const [wrapped, setWrapped] = useState<ReadonlySet<number>>(() => new Set());
  useEffect(() => setWrapped(new Set()), [rows]);

  // Each resized column i gets a CSS variable --cw<i>; dragging updates it directly, without re-rendering.
  const vars: Record<string, string> = {};
  columns.forEach((c, i) => {
    if (widths[c]) vars[`--cw${i}`] = `${widths[c]}px`;
  });

  function startResize(e: ReactPointerEvent<HTMLSpanElement>, col: string, i: number) {
    if (e.button !== 0) return;
    const handle = e.currentTarget;
    const inner = handle.parentElement?.querySelector<HTMLElement>(".th-inner");
    if (!inner) return;
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = Math.round(inner.getBoundingClientRect().width);
    let w = startW;
    let moved = false;
    document.body.classList.add("col-resizing");
    const move = (ev: PointerEvent) => {
      w = Math.min(MAX_COL, Math.max(MIN_COL, Math.round(startW + ev.clientX - startX)));
      if (!moved) {
        moved = true;
        setWidths((prev) => ({ ...prev, [col]: w }));
      }
      tableRef.current?.style.setProperty(`--cw${i}`, `${w}px`);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      document.body.classList.remove("col-resizing");
      if (moved) setWidths((prev) => (prev[col] === w ? prev : { ...prev, [col]: w }));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  function autoFit(col: string, i: number, th: HTMLElement) {
    const sample = tableRef.current?.querySelector<HTMLElement>(`tbody td:nth-child(${i + 1}) .cell`) ?? th;
    let max = textWidth(col, th) + 8; // + room for the resize handle
    for (const r of rows) {
      const t = cellText(r[col]);
      if (t) max = Math.max(max, textWidth(t.length > 300 ? t.slice(0, 300) : t, sample));
      if (max >= AUTOFIT_MAX) break;
    }
    const w = Math.min(AUTOFIT_MAX, Math.max(MIN_COL, Math.ceil(max) + 2));
    setWidths((prev) => ({ ...prev, [col]: w }));
  }

  function onOver(e: MouseEvent<HTMLTableSectionElement>) {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".cell");
    if (!el) return;
    const t = isTruncated(el);
    el.classList.toggle("truncated", t);
    if (t) el.title = el.textContent ?? "";
    else el.removeAttribute("title");
  }

  function onClick(e: MouseEvent<HTMLTableSectionElement>) {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".cell");
    const tr = el?.closest("tr");
    if (!el || !tr || window.getSelection()?.toString()) return;
    const ri = Number(tr.dataset.i);
    if (!wrapped.has(ri) && !isTruncated(el)) return;
    setWrapped((prev) => {
      const next = new Set(prev);
      if (next.has(ri)) next.delete(ri);
      else next.add(ri);
      return next;
    });
  }

  return (
    <table ref={tableRef} className={compact ? "data-table compact" : "data-table"} style={vars as CSSProperties}>
      <thead>
        <tr>
          {columns.map((c, i) => {
            const sized = !!widths[c];
            return (
              <th key={c} style={sized ? { width: `calc(var(--cw${i}) + ${CELL_PAD_X}px)` } : undefined}>
                <div className={sized ? "th-inner sized" : "th-inner"} style={sized ? { width: `var(--cw${i})` } : undefined} title={c}>
                  {c}
                </div>
                <span
                  className="col-resize"
                  title="Drag to resize; double-click to fit"
                  onPointerDown={(e) => startResize(e, c, i)}
                  onDoubleClick={(e) => autoFit(c, i, e.currentTarget.parentElement!)}
                />
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody onMouseOver={onOver} onClick={onClick}>
        {rows.map((row, ri) => (
          <tr key={ri} data-i={ri} className={wrapped.has(ri) ? "wrapped" : undefined}>
            {columns.map((c, i) => {
              const sized = !!widths[c];
              return (
                <td key={c}>
                  <div className={sized ? "cell sized" : "cell"} style={sized ? { width: `var(--cw${i})` } : undefined}>
                    {cellText(row[c])}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
});