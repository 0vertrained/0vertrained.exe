// The password-reset request: a POST to the recovery endpoint with the
// username, the recovery phrase and the new password. The server verifies
// the phrase against the stored hash and answers { ok: true }, a generic
// mismatch error, or 429 with retryAfterSeconds while the account is
// locked. The phrase travels normalised (see normalizePhrase) and is never
// kept here.
import { backendConfig } from "../app/config";
import { AUTH_COPY, tooManyAttempts } from "./authErrors";

export interface RecoveryRequest {
  username: string;
  recoveryPhrase: string;
  newPassword: string;
  captchaToken?: string;
}

export type RecoveryOutcome = { ok: true; error?: undefined } | { ok: false; error: string };

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await res.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function requestPasswordReset(
  input: RecoveryRequest,
  endpoint: string = backendConfig.recoveryEndpoint,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<RecoveryOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, error: AUTH_COPY.offline };
  }
  const payload = await readJson(res);
  if (res.ok && payload["ok"] === true) return { ok: true };
  if (res.status === 429) {
    const after = payload["retryAfterSeconds"];
    return { ok: false, error: tooManyAttempts(typeof after === "number" ? after : undefined) };
  }
  if (res.status >= 500) return { ok: false, error: AUTH_COPY.generic };
  return { ok: false, error: AUTH_COPY.phraseMismatch };
}
