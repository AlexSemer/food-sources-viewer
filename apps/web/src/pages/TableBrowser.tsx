import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getJson } from "../api";

type TableRes = {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
};

export function TableBrowser() {
  const { sourceId, table } = useParams();
  const [data, setData] = useState<TableRes | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceId || !table) return;
    const params = new URLSearchParams({ q, page: String(page), pageSize: "50" });
    getJson<TableRes>(`/api/sources/${sourceId}/tables/${table}?${params}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [sourceId, table, q, page]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setQ((document.getElementById("q") as HTMLInputElement).value);
  }

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <p>
        <Link to={`/s/${sourceId}`}>{sourceId}</Link> / {table}
      </p>
      <form className="row" onSubmit={onSearch}>
        <input id="q" defaultValue={q} placeholder="filter any column" />
        <button type="submit">Filter</button>
        <span className="muted">{data.total} rows</span>
      </form>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              {data.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={i}>
                {data.columns.map((c) => (
                  <td key={c}>{row[c] == null ? "" : String(row[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Prev
        </button>
        <span>page {data.page}</span>
        <button
          type="button"
          disabled={page * 50 >= data.total}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </>
  );
}
