import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getJson } from "../api";

type Related = {
  table: string;
  field: string;
  total: number;
  columns: string[];
  rows: Record<string, unknown>[];
};

type FoodRes = {
  source: { id: string; label: string; version: string; foodTable: string };
  idField: string;
  nameField: string;
  food: Record<string, unknown>;
  otherMatches: number;
  nutrients?: {
    nutrient_id: number;
    name: string;
    unit_name: string;
    nutrient_nbr: string | number | null;
    amount: number | null;
    data_points: number | null;
    min: number | null;
    max: number | null;
    median: number | null;
    footnote: string | null;
  }[];
  related: Related[];
};

const cell = (v: unknown) => (v == null ? "" : String(v));

/** One record as field / value rows, skipping empty fields. */
function RecordTable({ row }: { row: Record<string, unknown> }) {
  const entries = Object.entries(row).filter(([, v]) => v !== null && v !== undefined && v !== "");
  return (
    <table>
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <th style={{ textAlign: "left", fontWeight: "normal" }} className="muted">
              {k}
            </th>
            <td>{cell(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RelatedBlock({ sourceId, rel, value }: { sourceId: string; rel: Related; value: string }) {
  const browse = `/s/${sourceId}/tables/${encodeURIComponent(rel.table)}?${new URLSearchParams({ col: rel.field, val: value })}`;
  return (
    <>
      <h2>
        {rel.table} <span className="muted">({rel.field} = {value})</span>
      </h2>
      <p className="muted">
        {rel.total.toLocaleString()} row{rel.total === 1 ? "" : "s"}
        {rel.total > rel.rows.length ? `, first ${rel.rows.length} shown` : ""} · <Link to={browse}>open in table browser</Link>
      </p>
      {rel.rows.length === 1 ? (
        <RecordTable row={rel.rows[0]} />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                {rel.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rel.rows.map((r, i) => (
                <tr key={i}>
                  {rel.columns.map((c) => (
                    <td key={c}>{cell(r[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function FoodPage() {
  const { sourceId, foodId } = useParams();
  const [data, setData] = useState<FoodRes | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceId || !foodId) return;
    setData(null);
    setError(null);
    getJson<FoodRes>(`/api/sources/${encodeURIComponent(sourceId)}/foods/${encodeURIComponent(foodId)}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [sourceId, foodId]);

  if (error) return <p className="error">{error}</p>;
  if (!data || !sourceId) return <p>Loading…</p>;
  const id = cell(data.food[data.idField]);

  return (
    <>
      <p>
        <Link to={`/s/${sourceId}`}>{data.source.label}</Link>
        <span className="badge">{data.source.version}</span>
      </p>
      <h1>{cell(data.food[data.nameField]) || foodId}</h1>
      <p className="muted">
        {data.source.foodTable}.{data.idField} {id}
        {data.otherMatches > 0 ? ` · ${data.otherMatches} more rows share this ${data.idField} (listed below)` : ""}
      </p>
      <p className="muted">Values exactly as this source publishes them. No mapping.</p>

      <h2>{data.source.foodTable} row</h2>
      <RecordTable row={data.food} />

      {data.nutrients ? (
        <>
          <h2>food_nutrient ({data.nutrients.length})</h2>
          <table>
            <thead>
              <tr>
                <th>nutrient_id</th>
                <th>nbr</th>
                <th>name</th>
                <th>amount</th>
                <th>unit</th>
                <th>n</th>
                <th>min</th>
                <th>max</th>
                <th>median</th>
              </tr>
            </thead>
            <tbody>
              {data.nutrients.map((n, i) => (
                <tr key={`${n.nutrient_id}-${i}`}>
                  <td>{n.nutrient_id}</td>
                  <td>{cell(n.nutrient_nbr)}</td>
                  <td>{n.name}</td>
                  <td>{cell(n.amount)}</td>
                  <td>{n.unit_name}</td>
                  <td>{cell(n.data_points)}</td>
                  <td>{cell(n.min)}</td>
                  <td>{cell(n.max)}</td>
                  <td>{cell(n.median)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {data.related.map((rel) => (
        <RelatedBlock key={`${rel.table}:${rel.field}`} sourceId={sourceId} rel={rel} value={cell(rel.rows[0]?.[rel.field])} />
      ))}
    </>
  );
}
