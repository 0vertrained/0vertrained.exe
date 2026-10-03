// Error capture for the v20 app. Until the new backend lands (P6) reports stay
// on the device: a ring buffer of the last twenty errors, readable from the
// error screen, plus the console. Nothing here imports Supabase.
export interface ErrorReport {
  at: string;
  message: string;
  stack?: string;
  source: "error" | "unhandledrejection" | "boundary" | "manual";
  context?: string;
}

const LIMIT = 20;
const recent: ErrorReport[] = [];
let installed = false;

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message, ...(error.stack ? { stack: error.stack } : {}) };
  return { message: typeof error === "string" ? error : JSON.stringify(error) };
}

export function reportError(error: unknown, source: ErrorReport["source"] = "manual", context?: string): ErrorReport {
  const report: ErrorReport = { at: new Date().toISOString(), source, ...describe(error), ...(context ? { context } : {}) };
  recent.push(report);
  if (recent.length > LIMIT) recent.shift();
  console.error(`[0VERTRAINED ${source}]`, report.message, context ?? "", error instanceof Error ? error : "");
  return report;
}

export function getRecentErrors(): readonly ErrorReport[] {
  return recent.slice();
}

export function clearRecentErrors(): void {
  recent.length = 0;
}

/** Wire window-level capture once, before the app mounts. */
export function installErrorReporting(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (event) => {
    reportError(event.error ?? event.message, "error", `${event.filename}:${event.lineno}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportError(event.reason, "unhandledrejection");
  });
}
