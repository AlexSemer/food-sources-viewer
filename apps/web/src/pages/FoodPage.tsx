import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getJson } from "../api";

type FoodRes = {
  source: { id: string; label: string; version: string };
  food: Record<string, unknown>;
  nutrients: {
    nutrient_id: number;
    name: string;
    unit_name: string;
    nutrient_nbr: string;
    amount: number | null;
    data_points: number | null;
    min: number | null;
    max: number | null;
    median: number | null;
    footnote: string | null;
  }[];
};

export function FoodPage() {
  const { sourceId, foodId } = useParams();
  const [data, setData] = useState<FoodRes | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceId || !foodId) return;
    getJson<FoodRes>(`/api/sources/${sourceId}/foods/${foodId}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [sourceId, foodId]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <p>
        <Link to={`/s/${sourceId}`}>{data.source.label}</Link>
        <span className="badge">{data.source.version}</span>
      </p>
      <h1>{String(data.food.description ?? foodId)}</h1>
      <p className="muted">
        fdc_id {String(data.food.fdc_id)} · {String(data.food.data_type)} ·{" "}
        {String(data.food.category ?? "")}
      </p>
      <p className="muted">Amounts are this source’s published values per 100 g. No mapping.</p>
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
          {data.nutrients.map((n) => (
            <tr key={n.nutrient_id}>
              <td>{n.nutrient_id}</td>
              <td>{n.nutrient_nbr}</td>
              <td>{n.name}</td>
              <td>{n.amount ?? ""}</td>
              <td>{n.unit_name}</td>
              <td>{n.data_points ?? ""}</td>
              <td>{n.min ?? ""}</td>
              <td>{n.max ?? ""}</td>
              <td>{n.median ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
