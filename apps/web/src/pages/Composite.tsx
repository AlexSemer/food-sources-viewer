import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getJson, isAbort } from "../api";
import { DataTable } from "../DataTable";
import { layoutKey, useStoredState } from "../layout";

/**
 * Composite view: one row per "main food" of the source with identity columns, one column per
 * nutrient / component ("Name (unit)", alphabetical) and summaries of related rows. Pages are pivoted on
 * the server; filters live in the URL (?view=composite&preset=&q=&cat=&sub=&type=&mode=&agg=&page=).
 */

type Column = {
  key: string;
  label: string;
  kind: "identity" | "nutrient" | "related";
  unit?: string | null;
  optional?: boolean;
  pin?: boolean;
  title?: string;
  link?: boolean;
};
type Option = { value: string; label: string; count?: number | null; parent?: string | null };
type Meta = {
  columns: Column[];
  categories: Option[];
  subcategories: Option[];
  categoryNote: string | null;
  types: { label: string; value: string; options: Option[] } | null;
  modes: Option[] | null;
  aggs: Option[] | null;
  docs: { mainFood: string; identity: [string, string][]; values: string; split: string; related: string[]; notes: string[] };
  large: boolean;
  ms: number;
};
type Page = {
  rows: Record<string, unknown>[];
  nonEmpty: string[];
  total: number;
  totalCapped: boolean;
  page: number;
  pageSize: number;
  timedOut: boolean;
  ms: { ids: number; count: number; pivot: number; total: number };
};

/** Column picker: "page" = non-empty on this page (default), "all", or a custom set. */
type Picker = { mode?: "page" | "all" | "custom"; keys?: string[] };

const PAGE_SIZE = 50;
const FILTER_KEYS = ["preset", "q", "cat", "sub", "type", "mode", "agg"] as const;

const fmt = (n: number) => n.toLocaleString("en-US");
const optLabel = (o: Option) => (o.count != null ? `${o.label} (${fmt(o.count)})` : o.label);

export function Composite({ sourceId }: { sourceId: string }) {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? "";
  const q = get("q");
  const cat = get("cat");
  const sub = get("sub");
  const type = get("type");
  const mode = get("mode");
  const agg = get("agg");
  const preset = get("preset");
  const layoutTable = `composite:${preset ? `${preset}:` : ""}${mode || "default"}`;
  const page = Math.max(1, Number(get("page")) || 1);

  const [meta, setMeta] = useState<Meta | null>(null);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [qInput, setQInput] = useState(q);
  const [pickerFilter, setPickerFilter] = useState("");
  const [csvCols, setCsvCols] = useState<"all" | "shown">("all");
  const [csvSep, setCsvSep] = useState<"," | ";">(",");
  const [picker, setPicker] = useStoredState<Picker>(layoutKey(sourceId, layoutTable, "picker"));
  useEffect(() => setQInput(q), [q]);

  const update = useCallback(
    (changes: Record<string, string>, resetPage = true) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (resetPage && !("page" in changes)) next.delete("page");
      next.set("view", "composite");
      setParams(next, { replace: false });
    },
    [params, setParams],
  );

  const filterQs = useMemo(() => {
    const p = new URLSearchParams();
    for (const k of FILTER_KEYS) if (params.get(k)) p.set(k, params.get(k)!);
    return p;
  }, [params]);
  const metaQs = useMemo(() => {
    const p = new URLSearchParams();
    for (const k of ["preset", "type", "mode", "agg"]) if (params.get(k)) p.set(k, params.get(k)!);
    return p.toString();
  }, [params]);
  const base = `/api/sources/${encodeURIComponent(sourceId)}`;

  useEffect(() => {
    const ac = new AbortController();
    setError(null);
    getJson<Meta>(`${base}/composite/meta?${metaQs}`, ac.signal)
      .then(setMeta)
      .catch((e: unknown) => {
        if (!isAbort(e)) setError((e as Error).message);
      });
    return () => ac.abort();
  }, [base, metaQs]);

  useEffect(() => {
    const ac = new AbortController();
    const p = new URLSearchParams(filterQs);
    p.set("page", String(page));
    p.set("pageSize", String(PAGE_SIZE));
    setLoading(true);
    getJson<Page>(`${base}/composite?${p}`, ac.signal)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) setError((e as Error).message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [base, filterQs, page]);

  const nonEmpty = useMemo(() => new Set(data?.nonEmpty ?? []), [data]);
  const pickMode = picker.mode ?? "page";
  const shown = useMemo(() => {
    if (!meta) return [] as Column[];
    if (pickMode === "all") return meta.columns;
    if (pickMode === "custom") {
      const keys = new Set(picker.keys ?? []);
      return meta.columns.filter((c) => keys.has(c.key));
    }
    return meta.columns.filter((c) => (c.kind === "identity" && !c.optional) || (nonEmpty.has(c.key) && !(c.kind === "identity" && c.optional)));
  }, [meta, pickMode, picker.keys, nonEmpty]);

  const keys = useMemo(() => shown.map((c) => c.key), [shown]);
  const labels = useMemo(() => Object.fromEntries(shown.map((c) => [c.key, c.label])), [shown]);
  const titles = useMemo(() => Object.fromEntries(shown.map((c) => [c.key, [c.label, c.title].filter(Boolean).join("\n")])), [shown]);
  const kinds = useMemo(() => new Map(meta?.columns.map((c) => [c.key, c.kind]) ?? []), [meta]);
  const linkKeys = useMemo(() => new Set(meta?.columns.filter((c) => c.link).map((c) => c.key) ?? []), [meta]);
  // Pin the leading pinned identity columns that are shown.
  let sticky = 0;
  while (sticky < shown.length && shown[sticky].pin) sticky++;

  const renderCell = useCallback(
    (col: string, v: unknown) => {
      if (v === null || v === undefined || v === "") return <span className="missing">-</span>;
      if (linkKeys.has(col))
        return <Link to={`/s/${sourceId}/foods/${encodeURIComponent(String(v))}${preset ? `?preset=${encodeURIComponent(preset)}` : ""}`}>{String(v)}</Link>;
      return String(v);
    },
    [sourceId, linkKeys, preset],
  );
  const colClass = useCallback(
    (col: string) => (kinds.get(col) === "nutrient" ? "num" : kinds.get(col) === "related" ? "rel" : col === "notes" ? "notes" : undefined),
    [kinds],
  );

  function toggleKey(key: string) {
    const current = new Set(shown.map((c) => c.key));
    if (current.has(key)) current.delete(key);
    else current.add(key);
    setPicker(() => ({ mode: "custom", keys: meta!.columns.filter((c) => current.has(c.key)).map((c) => c.key) }));
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    update({ q: qInput.trim() });
  }

  const csvHref = useMemo(() => {
    const p = new URLSearchParams(filterQs);
    if (csvCols === "shown" && meta) {
      const idx = new Map(meta.columns.map((c, i) => [c.key, i]));
      p.set("cols", shown.map((c) => idx.get(c.key)).join(","));
    }
    if (csvSep === ";") p.set("sep", ";");
    return `${base}/composite.csv?${p}`;
  }, [base, filterQs, csvCols, csvSep, meta, shown]);

  if (error && !meta) return <p className="error">{error}</p>;
  if (!meta) return <p>Loading composite…</p>;

  const subs = meta.subcategories.filter((s) => !cat || !s.parent || s.parent === cat);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const counts = { identity: 0, nutrient: 0, related: 0 };
  for (const c of meta.columns) counts[c.kind]++;
  const pf = pickerFilter.trim().toLowerCase();

  return (
    <div className="composite">
      <form className="row composite-filters" onSubmit={onSearch}>
        <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search name or category" aria-label="Search" />
        <button type="submit">Search</button>
        {meta.types ? (
          <select value={type || meta.types.value} onChange={(e) => update({ type: e.target.value, cat: "", sub: "" })} aria-label={meta.types.label}>
            {meta.types.options.map((o) => (
              <option key={o.value} value={o.value}>
                {optLabel(o)}
              </option>
            ))}
          </select>
        ) : null}
        {meta.categories.length ? (
          <select value={cat} onChange={(e) => update({ cat: e.target.value, sub: "" })} aria-label="Category">
            <option value="">All categories</option>
            {meta.categories.map((o) => (
              <option key={o.value} value={o.value}>
                {optLabel(o)}
              </option>
            ))}
          </select>
        ) : null}
        {subs.length ? (
          <select value={sub} onChange={(e) => update({ sub: e.target.value })} aria-label="Sub-category">
            <option value="">All sub-categories</option>
            {subs.map((o) => (
              <option key={o.value} value={o.value}>
                {optLabel(o)}
              </option>
            ))}
          </select>
        ) : null}
        {meta.modes ? (
          <select value={mode || meta.modes[0].value} onChange={(e) => update({ mode: e.target.value })} aria-label="Values">
            {meta.modes.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : null}
        {meta.aggs ? (
          <select value={agg || meta.aggs[0].value} onChange={(e) => update({ agg: e.target.value }, false)} aria-label="Aggregate">
            {meta.aggs.map((o) => (
              <option key={o.value} value={o.value}>
                cell = {o.label}
              </option>
            ))}
          </select>
        ) : null}
        {q || cat || sub ? (
          <button type="button" className="link-button" onClick={() => update({ q: "", cat: "", sub: "" })}>
            clear filters
          </button>
        ) : null}
      </form>
      {meta.categoryNote ? <p className="muted">{meta.categoryNote}</p> : null}

      <div className="row composite-bar">
        <span>
          {data ? (
            <>
              <strong>
                {fmt(data.total)}
                {data.totalCapped ? "+" : ""}
              </strong>{" "}
              foods · page {data.page} of {fmt(pages)}
              {data.totalCapped ? "+" : ""}
            </>
          ) : (
            "…"
          )}
        </span>
        <button type="button" disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, false)}>
          Prev
        </button>
        <button type="button" disabled={!data || data.rows.length < PAGE_SIZE} onClick={() => update({ page: String(page + 1) }, false)}>
          Next
        </button>
        <details className="picker">
          <summary>
            Columns: {shown.length} of {meta.columns.length}
          </summary>
          <div className="picker-body">
            <div className="row">
              <button type="button" aria-pressed={pickMode === "page"} onClick={() => setPicker(() => ({ mode: "page" }))}>
                Non-empty on this page
              </button>
              <button type="button" aria-pressed={pickMode === "all"} onClick={() => setPicker(() => ({ mode: "all" }))}>
                Show all
              </button>
              <button
                type="button"
                onClick={() =>
                  setPicker(() => ({ mode: "custom", keys: meta.columns.filter((c) => c.kind === "identity" && !c.optional).map((c) => c.key) }))
                }
              >
                Identity only
              </button>
              <input value={pickerFilter} onChange={(e) => setPickerFilter(e.target.value)} placeholder="filter columns" />
            </div>
            {(["identity", "nutrient", "related"] as const).map((kind) => (
              <fieldset key={kind}>
                <legend>
                  {kind === "identity" ? "Identity" : kind === "nutrient" ? "Nutrients / components" : "Related rows"} ({counts[kind]})
                </legend>
                {meta.columns
                  .filter((c) => c.kind === kind && (!pf || c.label.toLowerCase().includes(pf)))
                  .map((c) => (
                    <label key={c.key} title={c.title} className={nonEmpty.has(c.key) ? undefined : "muted"}>
                      <input type="checkbox" checked={keys.includes(c.key)} onChange={() => toggleKey(c.key)} /> {c.label}
                    </label>
                  ))}
              </fieldset>
            ))}
          </div>
        </details>
        <span className="csv">
          <a className="button" href={csvHref} download>
            Download CSV
          </a>
          <select value={csvCols} onChange={(e) => setCsvCols(e.target.value as "all" | "shown")} aria-label="CSV columns">
            <option value="all">all {meta.columns.length} columns</option>
            <option value="shown">shown columns only</option>
          </select>
          <select value={csvSep} onChange={(e) => setCsvSep(e.target.value as "," | ";")} aria-label="CSV separator">
            <option value=",">comma</option>
            <option value=";">semicolon (Excel with a comma-decimal locale)</option>
          </select>
        </span>
        {data ? (
          <span className="muted timing" title="server: row ids / count / pivot">
            {data.ms.total} ms (ids {data.ms.ids}, count {data.ms.count}, pivot {data.ms.pivot})
          </span>
        ) : null}
      </div>
      {data?.timedOut ? <p className="badge warn">Search stopped after 2 s on this large source: showing the matches found so far.</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <div className={loading ? "composite-body stale" : "composite-body"}>
        {data && data.rows.length === 0 ? (
          <p className="panel-state muted">No foods match.</p>
        ) : (
          <DataTable
            sourceId={sourceId}
            table={layoutTable}
            columns={keys}
            rows={data?.rows ?? []}
            compact
            labels={labels}
            titles={titles}
            stickyCols={sticky}
            renderCell={renderCell}
            colClass={colClass}
          />
        )}
      </div>

      <details className="composite-docs">
        <summary>How this composite is built</summary>
        <p>
          <strong>Main food:</strong> {meta.docs.mainFood}
        </p>
        <table>
          <tbody>
            {meta.docs.identity.map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <strong>Split rule:</strong> {meta.docs.split}
        </p>
        <p>
          <strong>Nutrient columns:</strong> {meta.docs.values}
        </p>
        {meta.docs.related.length ? (
          <>
            <p>
              <strong>Related rows:</strong>
            </p>
            <ul>
              {meta.docs.related.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        ) : null}
        {meta.docs.notes.length ? (
          <ul>
            {meta.docs.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
        <p className="muted">
          Everything stays within this source: no cross-source mapping, no unit conversion unless stated above. Missing values are shown as "-". Columns:{" "}
          {counts.identity} identity, {counts.nutrient} nutrient / component, {counts.related} related.
        </p>
      </details>
    </div>
  );
}
