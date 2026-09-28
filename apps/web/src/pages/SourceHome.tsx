import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getJson } from "../api";

type TablesRes = {
  source: { id: string; label: string; version: string; implemented: boolean };
  meta: Record<string, string>;
  tables: { name: string; rows: number }[];
};

type FoodsRes = {
  rows: {
    fdc_id: number;
    data_type: string;
    description: string;
    category: string | null;
  }[];
  total: number;
  page: number;
};

export function SourceHome() {
  const { sourceId } = useParams();
  const [tables, setTables] = useState<TablesRes | null>(null);
  const [foods, setFoods] = useState<FoodsRes | null>(null);
  const [q, setQ] = useState("");
  const [dataType, setDataType] = useState("foundation_food");
  const [error, setError] = useState<string | null>(null);

  function loadFoods(query: string, type: string) {
    if (!sourceId) return;
    const params = new URLSearchParams({ q: query, dataType: type, page: "1" });
    getJson<FoodsRes>(`/api/sources/${sourceId}/foods?${params}`)
      .then(setFoods)
      .catch((e: Error) => setError(e.message));
  }

  useEffect(() => {
    if (!sourceId) return;
    setError(null);
    getJson<TablesRes>(`/api/sources/${sourceId}/tables`)
      .then((res) => {
        setTables(res);
        if (res.source.implemented) loadFoods("", "foundation_food");
      })
      .catch((e: Error) => setError(e.message));
  }, [sourceId]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    loadFoods(q, dataType);
  }

  if (error) return <p className="error">{error}</p>;
  if (!tables) return <p>Loading…</p>;

  return (
    <>
      <h1>{tables.source.label}</h1>
      <p>
        <span className="badge">{tables.source.version}</span>
        <span className="badge">{tables.source.id}</span>
        {tables.meta.loaded_at ? <span className="muted"> loaded {tables.meta.loaded_at}</span> : null}
      </p>

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
                <Link to={`/s/${sourceId}/tables/${t.name}`}>{t.name}</Link>
              </td>
              <td>{t.rows}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {tables.source.implemented ? (
        <>
          <h2>Foods</h2>
          <form className="row" onSubmit={onSearch}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="name or fdc_id"
            />
            <select value={dataType} onChange={(e) => setDataType(e.target.value)}>
              <option value="foundation_food">foundation_food only</option>
              <option value="all">all rows in food.csv</option>
            </select>
            <button type="submit">Search</button>
          </form>
          <p className="muted">{foods ? `${foods.total} matches` : ""}</p>
          <table>
            <thead>
              <tr>
                <th>fdc_id</th>
                <th>description</th>
                <th>type</th>
                <th>category</th>
              </tr>
            </thead>
            <tbody>
              {foods?.rows.map((f) => (
                <tr key={f.fdc_id}>
                  <td>
                    <Link to={`/s/${sourceId}/foods/${f.fdc_id}`}>{f.fdc_id}</Link>
                  </td>
                  <td>{f.description}</td>
                  <td>{f.data_type}</td>
                  <td>{f.category}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="muted">Loader for this source is not written yet.</p>
      )}
    </>
  );
}
