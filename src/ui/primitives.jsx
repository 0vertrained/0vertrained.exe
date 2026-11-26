// src/ui/primitives.jsx
// The two loading pieces the tabs share: a tab's skeleton while its data
// loads, and the quiet line shown over cached content while it refreshes.
import { useEffect, useState } from "react";

// LoadingShell: skeletons in the shape of what is coming, one card per row of
// the tab's plan (uiStability.js). After three seconds a line says it is
// still loading and that nothing logged is lost.
export function LoadingShell({ plan = [] }) {
  const rows = Array.isArray(plan) ? plan : [];
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(timer);
  }, []);
  if (!rows.length) return null;
  return (
    <div className="main" aria-busy="true" style={{ maxWidth: "var(--ovt-content-width)", margin: "0 auto", width: "100%" }}>
      <p className="sr" role="status">Loading</p>
      {rows.map((row, index) => (
        <section key={row.key || row.title || index} className="card" aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="sk" style={{ width: "36%", height: 14 }} />
          <span className="sk" style={{ width: index === 0 ? "80%" : "60%", height: index === 0 ? 24 : 16 }} />
          {index === 0 && <span className="sk" style={{ width: "92%", height: 14 }} />}
          {index === 0 && <span className="sk" style={{ width: "70%", height: 14 }} />}
        </section>
      ))}
      {slow && <p className="t-s c2" role="status">Still loading. Everything you logged is safe on this device.</p>}
    </div>
  );
}

// RefreshingBar: shown above cached content while a background refresh runs,
// so the screen keeps what it has instead of going blank.
export function RefreshingBar({ label = "Refreshing in the background" }) {
  return (
    <p role="status" aria-live="polite" className="t-s c2" style={{ margin: 0, padding: "6px 16px", borderBottom: "1px solid var(--line)", background: "var(--sunk)" }}>
      {label}
    </p>
  );
}
