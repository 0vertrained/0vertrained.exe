import React from "react";
import ReactDOM from "react-dom/client";
import App from "../App.jsx";
import "../fonts";
import "../index.css";
import { initErrorReporting } from "../errorReporting";
import { registerAppServiceWorker } from "../pwa";


// Focused number inputs should not mutate when the desktop page is scrolled.
document.addEventListener("wheel", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.type === "number" && document.activeElement === target) target.blur();
}, { capture: true, passive: true });

// V9 · Wire global error capture before the app mounts so even render-time
// failures on first paint are reported.
initErrorReporting();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

registerAppServiceWorker();
