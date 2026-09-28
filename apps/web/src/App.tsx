import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
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

export function App() {
  return (
    <>
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
