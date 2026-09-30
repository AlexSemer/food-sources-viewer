import { FormEvent, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { getJson } from "../api";
import { ViewToggle } from "../ViewToggle";
import { DataTable } from "../DataTable";

type TableRes = {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  totalCapped: boolean;
  page: number;
  pageSize: number;
  searchedColumns?: string[];
};

export function TableBrowser() {
  const { sourceId, table } = useParams();
  const [search, setSearch] = useSearchParams();
  const q = search.get("q") ?? "";
  const col = search.get("col");
  const val = search.get("val");
  const page = Math.max(1, Number(search.get("page") ?? 1) || 1);
  const [data, setData] = useState<TableRes | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceId || !table) return;
    setError(null);
    const params = new URLSearchParams({ q, page: String(page), pageSize: "50" });
    if (col && val !== null) {
      params.set("col", col);
      params.set("val", val);
    }
    getJson<TableRes>(`/api/sources/${encodeURIComponent(sourceId)}/tables/${encodeURIComponent(table)}?${params}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [sourceId, table, q, col, val, page]);

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(search);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setSearch(next);
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    update({ q: (document.getElementById("q") as HTMLInputElement).value, page: null });
  }

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <p>
        <Link to={`/s/${sourceId}`}>{sourceId}</Link> / {table}
      </p>
      <ViewToggle sourceId={sourceId!} view="single" />
      {col && val !== null ? (
        <p className="muted">
          {col} = {val} ·{" "}
          <button type="button" onClick={() => update({ col: null, val: null, page: null })}>
            clear
          </button>
        </p>
      ) : null}
      <form className="row" onSubmit={onSearch}>
        <input id="q" key={q} defaultValue={q} placeholder="filter any column" />
        <button type="submit">Filter</button>
        <span className="muted">
          {data.total.toLocaleString()}
          {data.totalCapped ? "+" : ""} rows
        </span>
      </form>
      {data.searchedColumns ? (
        <p className="muted">Large table: the filter searches indexed columns only ({data.searchedColumns.join(", ")}).</p>
      ) : null}
      <div style={{ overflowX: "auto" }}>
        <DataTable sourceId={sourceId!} table={table!} columns={data.columns} rows={data.rows} />
      </div>
      <div className="row">
        <button type="button" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
          Prev
        </button>
        <span>page {data.page}</span>
        <button
          type="button"
          disabled={data.rows.length < data.pageSize}
          onClick={() => update({ page: String(page + 1) })}
        >
          Next
        </button>
      </div>
    </>
  );
}
