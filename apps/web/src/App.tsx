import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { getJson } from "./api";
import { SourceList } from "./pages/SourceList";
import { SourceHome } from "./pages/SourceHome";
import { TableBrowser } from "./pages/TableBrowser";
import { FoodPage } from "./pages/FoodPage";

function SourceBanner() {
  const sourceId = useLocation().pathname.split("/")[2];
  return (
    <header>
      <Link to="/">Sources</Link>
      {sourceId ? <span>{sourceId}</span> : null}
      <span className="sub">local viewer · no mapping</span>
    </header>
  );
}

type ApiMeta = { sample: { foodsPerSource: number; sampledAt: string | null; sources: string[] } | null };

/** Online sample deployment only (the API reports `sample`); nothing is shown locally. */
function SampleBanner() {
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  useEffect(() => {
    getJson<ApiMeta>("/api/meta")
      .then(setMeta)
      .catch(() => setMeta(null));
  }, []);
  if (!meta?.sample) return null;
  const s = meta.sample;
  return (
    <div className="sample-banner" role="note">
      Sample: {s.foodsPerSource} foods per source — not the full data.{" "}
      <span className="sub">
        {s.sources.length} sources{s.sampledAt ? `, cut ${s.sampledAt.slice(0, 10)}` : ""}; related rows are only those of the sampled foods.
      </span>
    </div>
  );
}

export function App() {
  return (
    <>
      <SampleBanner />
      <SourceBanner />
      <main>
        <Routes>
          <Route path="/" element={<SourceList />} />
          <Route path="/s/:sourceId" element={<SourceHome />} />
          <Route path="/s/:sourceId/tables/:table" element={<TableBrowser />} />
          <Route path="/s/:sourceId/foods/:foodId" element={<FoodPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
