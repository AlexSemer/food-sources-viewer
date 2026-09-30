import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getJson } from "../api";

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
};

type TablesRes = {
  source: SourceInfo;
  meta: Record<string, string>;
  tables: { name: string; rows: number }[];
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
    getJson<TablesRes>(`/api/sources/${encodeURIComponent(sourceId)}/tables`)
      .then((res) => {
        setTables(res);
        setQ("");
        setQuery("");
        setPage(1);
        setType(res.source.foodTypeDefault ?? "all");
      })
      .catch((e: Error) => setError(e.message));
  }, [sourceId]);

  useEffect(() => {
    if (!sourceId || !tables?.source.implemented) return;
    const params = new URLSearchParams({ q: query, type, page: String(page) });
    getJson<FoodsRes>(`/api/sources/${encodeURIComponent(sourceId)}/foods?${params}`)
      .then(setFoods)
      .catch((e: Error) => setError(e.message));
  }, [sourceId, tables, query, type, page]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setQuery(q);
  }

  if (error) return <p className="error">{error}</p>;
  if (!tables) return <p>Loading…</p>;
  const src = tables.source;

  return (
    <>
      <h1>{src.label}</h1>
      <p>
        <span className="badge">{src.version}</span>
        <span className="badge">{src.id}</span>
        {tables.meta.loaded_at ? <span className="muted"> loaded {tables.meta.loaded_at}</span> : null}
      </p>
      {tables.meta.raw_path ? <p className="muted">raw: {tables.meta.raw_path}</p> : null}

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
                          <Link to={`/s/${sourceId}/foods/${encodeURIComponent(cell(f[c]))}`}>{cell(f[c])}</Link>
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
