import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getJson } from "../api";

type SourceRow = {
  id: string;
  label: string;
  version: string;
  implemented: boolean;
  loaded: boolean;
  meta: Record<string, string>;
};

export function SourceList() {
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<SourceRow[]>("/api/sources")
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error} — is the API running on :3001?</p>;

  return (
    <>
      <h1>Sources</h1>
      <p className="muted">Each card is a separate SQLite file. Nothing is blended.</p>
      <div className="grid">
        {rows.map((s) => (
          <Link className="card" key={s.id} to={`/s/${s.id}`}>
            <h2>{s.label}</h2>
            <div>
              <span className="badge">{s.version}</span>
              {s.loaded ? <span className="badge">loaded</span> : <span className="badge warn">not ingested</span>}
              {!s.implemented ? <span className="badge warn">stub</span> : null}
            </div>
            <p className="muted">{s.id}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
