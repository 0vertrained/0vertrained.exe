// Error capture for the v20 app: a ring buffer of the last twenty errors
// (readable from the error screen), the console, and a best-effort POST to
// the error endpoint, anonymous for guests and with the session token for
// accounts. Reporting never throws and never blocks the app.
import { backendConfig } from "./config";

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
let tokenProvider: (() => Promise<string | null>) | null = null;
let postCount = 0;
/** A session never sends more than this many reports. */
const POST_LIMIT = 30;

/** Lets the auth layer attach the session token to reports. */
export function setErrorReportToken(provider: (() => Promise<string | null>) | null): void {
  tokenProvider = provider;
}

async function post(report: ErrorReport): Promise<void> {
  if (typeof fetch !== "function" || postCount >= POST_LIMIT) return;
  postCount += 1;
  try {
    const token = tokenProvider ? await tokenProvider() : null;
    await fetch(backendConfig.errorEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ message: report.message, stack: report.stack ?? "", component_stack: report.source === "boundary" ? report.context ?? "" : "", url: window.location.href, version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "", ref: report.source }),
      keepalive: true,
    });
  } catch {
    // reporting is best effort
  }
}

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message, ...(error.stack ? { stack: error.stack } : {}) };
  return { message: typeof error === "string" ? error : JSON.stringify(error) };
}

export function reportError(error: unknown, source: ErrorReport["source"] = "manual", context?: string): ErrorReport {
  const report: ErrorReport = { at: new Date().toISOString(), source, ...describe(error), ...(context ? { context } : {}) };
  recent.push(report);
  if (recent.length > LIMIT) recent.shift();
  console.error(`[0VERTRAINED ${source}]`, report.message, context ?? "", error instanceof Error ? error : "");
  void post(report);
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
