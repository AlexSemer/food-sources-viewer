import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getJson, isAbort } from "../api";

/**
 * Relations view: how the tables of one source join, computed by the API (column-name candidates confirmed
 * by value overlap on samples) and cached in data/_relations/<id>.json. Plain SVG: the main food table in
 * the centre column, directly joined tables in the next column (left and right), tables joined through
 * those one column further out.
 */

type Side = { table: string; column: string; unique: boolean | null; rows: number };
type Edge = {
  a: Side;
  b: Side;
  cardinality: "1:1" | "1:N" | "N:1" | "N:M";
  how: string;
  condition?: string;
  sampled: number;
  matched: number;
  matchRate: number;
  coverage: number | null;
  perParent: number | null;
  multiValued?: boolean;
  note?: string;
};
type Doc = {
  sourceId: string;
  mainTable: string;
  mainId: string;
  generatedAt: string;
  ms: number;
  cached?: boolean;
  tables: { name: string; rows: number; columns: number }[];
  edges: Edge[];
  notes: string[];
};

type Node = { name: string; rows: number; level: number; x: number; y: number; w: number; h: number; side: number };
type Graph = { nodes: Map<string, Node>; parent: Map<string, string>; loose: string[]; width: number; height: number; splitY: number | null };

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (r: number | null) => (r == null ? "?" : r >= 0.9995 ? "100%" : `${(r * 100).toFixed(r >= 0.1 ? 0 : 1)}%`);
const rateClass = (r: number) => (r >= 0.95 ? "good" : r >= 0.5 ? "fair" : "poor");
const NODE_H = 36;
const ROW_H = 50;
const nodeW = (name: string) => Math.max(90, Math.min(260, name.length * 7.2 + 22));
const labelW = (text: string) => text.length * 6.2 + 10;

/**
 * Tidy two-sided tree: the main table in the centre column, tables joined to it in the next column
 * (split left / right to balance the height), tables joined through those one column further out.
 * Tables not reachable from the main table form extra trees below. Non-tree joins are drawn as curves.
 */
function layout(doc: Doc): Graph {
  const rows = new Map(doc.tables.map((t) => [t.name, t.rows]));
  const adj = new Map<string, Set<string>>();
  const pairCount = new Map<string, number>();
  const link = (x: string, y: string) => {
    if (!adj.has(x)) adj.set(x, new Set());
    adj.get(x)!.add(y);
  };
  for (const e of doc.edges) {
    if (e.a.table === e.b.table) continue;
    link(e.a.table, e.b.table);
    link(e.b.table, e.a.table);
    const k = [e.a.table, e.b.table].sort().join("|");
    pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
  }
  const level = new Map<string, number>();
  const parent = new Map<string, string>();
  const children = new Map<string, string[]>();
  const bfs = (root: string) => {
    level.set(root, 0);
    const queue = [root];
    while (queue.length) {
      const t = queue.shift()!;
      for (const n of [...(adj.get(t) ?? [])].sort()) {
        if (level.has(n)) continue;
        level.set(n, level.get(t)! + 1);
        parent.set(n, t);
        if (!children.has(t)) children.set(t, []);
        children.get(t)!.push(n);
        queue.push(n);
      }
    }
  };
  bfs(doc.mainTable);
  const roots = [doc.mainTable];
  for (const t of [...adj.keys()].sort()) {
    if (level.has(t)) continue;
    roots.push(t);
    bfs(t);
  }
  const loose = doc.tables.map((t) => t.name).filter((t) => !level.has(t) && t !== doc.mainTable);

  const slot = (n: string) => {
    const p = parent.get(n);
    return p ? ROW_H + (Math.max(1, pairCount.get([n, p].sort().join("|")) ?? 1) - 1) * 16 : ROW_H;
  };
  const leaves = (n: string): number => (children.get(n) ?? []).reduce((s, c) => s + leaves(c), 0) || slot(n);

  // Column widths per depth (shared by both sides) and the label room in front of each column.
  const depthW = new Map<number, number>();
  const gapW = new Map<number, number>();
  for (const [n, l] of level) depthW.set(l, Math.max(depthW.get(l) ?? 0, nodeW(n) + (l === 0 && n === doc.mainTable ? 20 : 0)));
  for (const e of doc.edges) {
    const la = level.get(e.a.table) ?? 0;
    const lb = level.get(e.b.table) ?? 0;
    if (la === lb) continue;
    const d = Math.max(la, lb);
    gapW.set(d, Math.max(gapW.get(d) ?? 0, labelW(edgeLabel(e))));
  }
  const colX = (depth: number) => {
    if (depth === 0) return 0;
    let x = (depthW.get(0) ?? 0) / 2;
    for (let d = 1; d <= depth; d++) x += (gapW.get(d) ?? 60) + 40 + (depthW.get(d) ?? 0) / (d === depth ? 2 : 1);
    return x;
  };

  const nodes = new Map<string, Node>();
  const put = (n: string, side: number, y: number) => {
    const l = level.get(n) ?? 0;
    const isMain = n === doc.mainTable;
    nodes.set(n, { name: n, rows: rows.get(n) ?? 0, level: roots.includes(n) && !isMain ? 1 : l, x: side * colX(l), y, w: nodeW(n) + (isMain ? 20 : 0), h: NODE_H + (isMain ? 8 : 0), side });
  };
  const assign = (n: string, side: number, top: { y: number }): number => {
    const kids = children.get(n) ?? [];
    let y: number;
    if (!kids.length) {
      y = top.y + slot(n) / 2;
      top.y += slot(n);
    } else {
      const ys = kids.map((k) => assign(k, side, top));
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    put(n, side, y);
    return y;
  };

  // Main tree: balance the direct children between the right (+1) and left (-1) side.
  const direct = [...(children.get(doc.mainTable) ?? [])];
  const right: string[] = [];
  const left: string[] = [];
  let hr = 0;
  let hl = 0;
  for (const c of [...direct].sort((x, y) => leaves(y) - leaves(x) || x.localeCompare(y))) {
    if (hr <= hl) {
      right.push(c);
      hr += leaves(c);
    } else {
      left.push(c);
      hl += leaves(c);
    }
  }
  right.sort();
  left.sort();
  const H = Math.max(hr, hl, ROW_H);
  const topR = { y: (H - hr) / 2 };
  for (const c of right) assign(c, 1, topR);
  const topL = { y: (H - hl) / 2 };
  for (const c of left) assign(c, -1, topL);
  put(doc.mainTable, 0, H / 2);

  // Other components below, growing to the right from the centre column.
  let yOff = H + (roots.length > 1 ? 60 : 0);
  const splitY = roots.length > 1 ? H + 20 : null;
  for (const r of roots.slice(1)) {
    const top = { y: yOff };
    const kids = children.get(r) ?? [];
    let y: number;
    if (kids.length) {
      const ys = kids.map((k) => assign(k, 1, top));
      y = (ys[0] + ys[ys.length - 1]) / 2;
    } else {
      y = yOff + ROW_H / 2;
      top.y += ROW_H;
    }
    put(r, 0, y);
    yOff = top.y + 10;
  }

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const n of nodes.values()) {
    minX = Math.min(minX, n.x - n.w / 2);
    maxX = Math.max(maxX, n.x + n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2);
    maxY = Math.max(maxY, n.y + n.h / 2);
  }
  const pad = 24;
  for (const n of nodes.values()) {
    n.x += pad - minX;
    n.y += pad - minY;
  }
  return { nodes, parent, loose, width: maxX - minX + 2 * pad, height: maxY - minY + 2 * pad, splitY: splitY == null ? null : splitY + pad - minY };
}

/** Curve between two nodes, leaving / entering at the facing sides. */
function edgePath(a: Node, b: Node): { d: string; mx: number; my: number } {
  const [p, q] = a.x <= b.x ? [a, b] : [b, a];
  if (Math.abs(p.x - q.x) < 1) {
    const x = p.x + p.w / 2;
    const cx = x + 50 + Math.abs(p.y - q.y) * 0.15;
    return { d: `M${x},${p.y} C${cx},${p.y} ${cx},${q.y} ${q.x + q.w / 2},${q.y}`, mx: cx - 12, my: (p.y + q.y) / 2 };
  }
  const x1 = p.x + p.w / 2;
  const x2 = q.x - q.w / 2;
  const mx = (x1 + x2) / 2;
  return { d: `M${x1},${p.y} C${mx},${p.y} ${mx},${q.y} ${x2},${q.y}`, mx, my: (p.y + q.y) / 2 };
}

function edgeLabel(e: Edge) {
  const cols = e.a.column === e.b.column ? e.a.column : `${e.a.column}↔${e.b.column}`;
  return `${cols} · ${e.cardinality} · ${pct(e.matchRate)}`;
}

export function Relations({ sourceId }: { sourceId: string }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [labels, setLabels] = useState(true);
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    getJson<Doc>(`/api/sources/${encodeURIComponent(sourceId)}/relations${refresh ? "?refresh=1" : ""}`, ac.signal)
      .then(setDoc)
      .catch((e: unknown) => {
        if (!isAbort(e)) setError((e as Error).message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [sourceId, refresh]);

  const g = useMemo(() => (doc ? layout(doc) : null), [doc]);
  const edges = useMemo(() => {
    if (!doc) return [];
    const main = doc.mainTable;
    const touches = (e: Edge) => (e.a.table === main || e.b.table === main ? 0 : 1);
    return [...doc.edges].sort((x, y) => touches(x) - touches(y) || x.a.table.localeCompare(y.a.table) || x.b.table.localeCompare(y.b.table));
  }, [doc]);

  if (error) return <p className="error">{error}</p>;
  if (!doc || !g) return <p>{loading ? "Computing relations…" : "…"}</p>;

  // Several edges between the same two tables: fan their labels out along the line.
  const pairIndex = new Map<string, number>();
  const pairKey = (e: Edge) => [e.a.table, e.b.table].sort().join("|");
  const pairTotals = new Map<string, number>();
  for (const e of doc.edges) pairTotals.set(pairKey(e), (pairTotals.get(pairKey(e)) ?? 0) + 1);
  const pairCountOf = (k: string) => pairTotals.get(k) ?? 1;
  const active = (e: Edge) => !focus || e.a.table === focus || e.b.table === focus;

  return (
    <div className="relations">
      <div className="row">
        <span>
          Main food table <strong>{doc.mainTable}</strong> (id <code>{doc.mainId}</code>) · {doc.edges.length} joins across {doc.tables.length} tables
        </span>
        <label>
          <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> edge labels
        </label>
        <button type="button" disabled={loading} onClick={() => setRefresh((n) => n + 1)}>
          {loading ? "Recomputing…" : "Recompute"}
        </button>
        <span className="muted">
          {doc.cached ? "cached" : "computed"} {new Date(doc.generatedAt).toLocaleString()} in {fmt(doc.ms)} ms
        </span>
      </div>
      <p className="muted">
        Joins are found by column names (same name, <code>x_id</code> → <code>x.id</code>, declared keys, FooDB's polymorphic{" "}
        <code>source_type</code>) and kept only when a sample of values actually matches. Match = share of distinct referencing values found
        in the referenced column; coverage = share of referenced rows that have any. Click a table to highlight its joins.
      </p>

      {doc.edges.length ? (
        <div className="relations-diagram">
          <svg width={g.width} height={g.height} viewBox={`0 0 ${g.width} ${g.height}`} role="img" aria-label={`Relations of ${sourceId}`}>
            {g.splitY != null ? (
              <text x={12} y={g.splitY + 14} className="split">
                not joined to {doc.mainTable}:
              </text>
            ) : null}
            {edges.map((e, i) => {
              const a = g.nodes.get(e.a.table);
              const b = g.nodes.get(e.b.table);
              if (!a || !b || a === b) return null;
              const k = pairKey(e);
              const n = pairIndex.get(k) ?? 0;
              pairIndex.set(k, n + 1);
              const { d, mx, my } = edgePath(a, b);
              const text = edgeLabel(e);
              const lw = labelW(text);
              // Tree edge: label just in front of the child; other joins: at the curve's middle.
              const child = g.parent.get(b.name) === a.name ? b : g.parent.get(a.name) === b.name ? a : null;
              const par = child === b ? a : b;
              let lx = mx;
              let ly = my + n * 16;
              if (child) {
                const toRight = child.x > par.x;
                lx = toRight ? child.x - child.w / 2 - 8 - lw / 2 : child.x + child.w / 2 + 8 + lw / 2;
                ly = child.y + (n - ((pairCountOf(k) - 1) / 2)) * 16;
              }
              const on = active(e);
              return (
                <g key={i} className={`edge ${rateClass(e.matchRate)}${on ? "" : " dim"}${e.cardinality === "N:M" ? " nm" : ""}`}>
                  <title>
                    {`${e.a.table}.${e.a.column} ↔ ${e.b.table}.${e.b.column}\n${e.cardinality} · ${e.how} · match ${pct(e.matchRate)} (${e.matched}/${e.sampled})${e.condition ? `\nwhere ${e.condition}` : ""}${e.note ? `\n${e.note}` : ""}`}
                  </title>
                  <path d={d} />
                  {labels && on ? (
                    <>
                      <rect x={lx - lw / 2} y={ly - 8} width={lw} height={15} rx={3} />
                      <text x={lx} y={ly + 3} textAnchor="middle">
                        {text}
                      </text>
                    </>
                  ) : null}
                </g>
              );
            })}
            {[...g.nodes.values()].map((n) => (
              <g
                key={n.name}
                className={`node level${Math.min(n.level, 3)}${focus === n.name ? " focus" : ""}`}
                transform={`translate(${n.x - n.w / 2}, ${n.y - n.h / 2})`}
                onClick={() => setFocus((f) => (f === n.name ? null : n.name))}
              >
                <rect width={n.w} height={n.h} rx={4} />
                <text x={n.w / 2} y={15} textAnchor="middle" className="name">
                  {n.name}
                </text>
                <text x={n.w / 2} y={n.h - 6} textAnchor="middle" className="count">
                  {fmt(n.rows)} rows
                </text>
              </g>
            ))}
          </svg>
        </div>
      ) : (
        <p className="muted">No joins found between the tables of this source.</p>
      )}
      {g.loose.length ? (
        <p className="muted">
          Not joined to anything:{" "}
          {g.loose.map((t, i) => (
            <span key={t}>
              {i ? ", " : ""}
              <Link to={`/s/${sourceId}/tables/${encodeURIComponent(t)}`}>{t}</Link>
            </span>
          ))}
        </p>
      ) : null}

      <table className="relations-list">
        <thead>
          <tr>
            <th>Referenced (1 side)</th>
            <th>Referencing</th>
            <th>Card.</th>
            <th>Found by</th>
            <th>Match</th>
            <th>Coverage</th>
            <th>Rows / parent</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {edges.map((e, i) => (
            <tr key={i} className={active(e) ? undefined : "dim"}>
              <td>
                <Link to={`/s/${sourceId}/tables/${encodeURIComponent(e.a.table)}`}>{e.a.table}</Link>.{e.a.column}
              </td>
              <td>
                <Link to={`/s/${sourceId}/tables/${encodeURIComponent(e.b.table)}`}>{e.b.table}</Link>.{e.b.column}
                {e.condition ? <div className="muted">where {e.condition}</div> : null}
              </td>
              <td>{e.cardinality}</td>
              <td>{e.how}</td>
              <td className={rateClass(e.matchRate)} title={`${e.matched} of ${e.sampled} sampled distinct values`}>
                {pct(e.matchRate)}
              </td>
              <td>{pct(e.coverage)}</td>
              <td>{e.perParent == null ? "-" : e.perParent < 10 ? e.perParent.toFixed(1) : fmt(Math.round(e.perParent))}</td>
              <td className="muted">
                {e.multiValued ? "multi-valued cell. " : ""}
                {e.note ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {doc.notes.length ? (
        <ul className="muted">
          {doc.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
