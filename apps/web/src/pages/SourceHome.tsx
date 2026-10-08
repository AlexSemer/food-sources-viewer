import { FormEvent, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { getJson } from "../api";
import { parseView, ViewToggle } from "../ViewToggle";
import { AllTables } from "./AllTables";
import { Composite } from "./Composite";
import { Relations } from "./Relations";

type SourceInfo = {
  id: string;
  label: string;
  version: string;
  implemented: boolean;
  foodTable: string;
  foodIdField: string;
  foodNameField: string;
  foodTypeField?: string;
  foodTypeDefault?: string;
  presets?: { id: string; label: string; foodTable: string; amountTable: string }[];
};

type TablesRes = {
  source: SourceInfo;
  meta: Record<string, string>;
  tables: { name: string; rows: number; columns?: number }[];
};

type FoodsRes = {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  totalCapped: boolean;
  page: number;
  pageSize: number;
  types?: string[];
};

const cell = (v: unknown) => (v == null ? "" : String(v));

export function SourceHome() {
  const { sourceId } = useParams();
  const [params, setParams] = useSearchParams();
  const view = parseView(params.get("view"));
  // Multi-dataset sources (the NUTRI store): ?preset= picks which food/amount table pair is read.
  const preset = params.get("preset") ?? "";
  const presetQs = preset ? `preset=${encodeURIComponent(preset)}` : "";
  const [tables, setTables] = useState<TablesRes | null>(null);
  const [foods, setFoods] = useState<FoodsRes | null>(null);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceId) return;
    setError(null);
    setTables(null);
    setFoods(null);
    getJson<TablesRes>(`/api/sources/${encodeURIComponent(sourceId)}/tables${presetQs ? `?${presetQs}` : ""}`)
      .then((res) => {
        setTables(res);
        setQ("");
        setQuery("");
        setPage(1);
        setType(res.source.foodTypeDefault ?? "all");
      })
      .catch((e: Error) => setError(e.message));
  }, [sourceId, presetQs]);

  useEffect(() => {
    if (!sourceId || !tables?.source.implemented || view !== "single") return;
    const qs = new URLSearchParams({ q: query, type, page: String(page) });
    if (preset) qs.set("preset", preset);
    getJson<FoodsRes>(`/api/sources/${encodeURIComponent(sourceId)}/foods?${qs}`)
      .then(setFoods)
      .catch((e: Error) => setError(e.message));
  }, [sourceId, tables, query, type, page, view, preset]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setQuery(q);
  }

  if (error) return <p className="error">{error}</p>;
  if (!tables) return <p>Loading…</p>;
  const src = tables.source;

  const heading = (
    <>
      <h1>{src.label}</h1>
      <p>
        <span className="badge">{src.version}</span>
        <span className="badge">{src.id}</span>
        {tables.meta.loaded_at ? <span className="muted"> loaded {tables.meta.loaded_at}</span> : null}
      </p>
      {tables.meta.raw_path ? <p className="muted">raw: {tables.meta.raw_path}</p> : null}
      {src.presets?.length ? (
        <p className="row">
          <label>
            Dataset{" "}
            <select
              value={preset || src.presets[0].id}
              onChange={(e) => {
                // Only switches which table pair is read; filters of the previous dataset do not carry over.
                const next = new URLSearchParams();
                if (params.get("view")) next.set("view", params.get("view")!);
                next.set("preset", e.target.value);
                setParams(next);
              }}
            >
              {src.presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <span className="muted">
            {src.foodTable} + {src.presets.find((p) => p.id === (preset || src.presets![0].id))?.amountTable}
          </span>
        </p>
      ) : null}
      <ViewToggle sourceId={src.id} view={view} query={presetQs} />
    </>
  );

  if (view === "composite") {
    return (
      <>
        {heading}
        <Composite sourceId={src.id} key={preset} />
      </>
    );
  }

  if (view === "relations") {
    return (
      <>
        {heading}
        <Relations sourceId={src.id} />
      </>
    );
  }

  if (view === "all") {
    return (
      <>
        {heading}
        <AllTables sourceId={src.id} tables={tables.tables} foodTable={src.foodTable} />
      </>
    );
  }

  return (
    <>
      {heading}

      <h2>Tables</h2>
      <table>
        <thead>
          <tr>
            <th>name</th>
            <th>rows</th>
          </tr>
        </thead>
        <tbody>
          {tables.tables.map((t) => (
            <tr key={t.name}>
              <td>
                <Link to={`/s/${sourceId}/tables/${encodeURIComponent(t.name)}`}>{t.name}</Link>
                {t.name === src.foodTable ? <span className="badge">foods</span> : null}
              </td>
              <td>{t.rows.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {src.implemented ? (
        <>
          <h2>Foods</h2>
          <p className="muted">
            {src.foodTable}: search {src.foodNameField} or {src.foodIdField}
          </p>
          <form className="row" onSubmit={onSearch}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${src.foodNameField} or ${src.foodIdField}`} />
            {foods?.types ? (
              <select
                value={type}
                onChange={(e) => {
                  setPage(1);
                  setType(e.target.value);
                }}
              >
                <option value="all">all {src.foodTypeField} values</option>
                {foods.types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : null}
            <button type="submit">Search</button>
          </form>
          <p className="muted">{foods ? `${foods.total.toLocaleString()}${foods.totalCapped ? "+" : ""} matches` : ""}</p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  {foods?.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {foods?.rows.map((f, i) => (
                  <tr key={i}>
                    {foods.columns.map((c) => (
                      <td key={c}>
                        {c === src.foodIdField ? (
                          <Link to={`/s/${sourceId}/foods/${encodeURIComponent(cell(f[c]))}${presetQs ? `?${presetQs}` : ""}`}>{cell(f[c])}</Link>
                        ) : (
                          cell(f[c])
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {foods ? (
            <div className="row">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Prev
              </button>
              <span>page {foods.page}</span>
              <button
                type="button"
                disabled={foods.rows.length < foods.pageSize}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="muted">Loader for this source is not written yet.</p>
      )}
    </>
  );
}
