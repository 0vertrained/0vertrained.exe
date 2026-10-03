// The v20 entry, loaded by src/main.jsx at /next. Nothing from the legacy
// tree is imported here, so /next carries only the new app.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../design/tokens.css";
import "../design/kit.css";
import { App } from "./App";

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
