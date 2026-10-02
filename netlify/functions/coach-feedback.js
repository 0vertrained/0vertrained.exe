// netlify/functions/coach-feedback.js
// V19.0 · Best-effort helpful / unhelpful feedback for routed coach runs.
// Stores no prompt, answer, or evidence payload—only the rating on the caller's
// own telemetry row.

function requestTooLarge(req, maxBytes = 8_000) {
  const len = Number(req.headers.get("content-length") || 0);
  return Number.isFinite(len) && len > maxBytes;
}

const HEADERS = {
  "content-type": "application/json",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: HEADERS });
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (requestTooLarge(req)) return json({ error: "Request body too large" }, 413);

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "Server not configured" }, 500);

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json({ error: "Missing authorization token" }, 401);

  let userId;
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { "authorization": `Bearer ${token}`, "apikey": anonKey },
    });
    if (!response.ok) return json({ error: "Invalid or expired session" }, 401);
    userId = (await response.json())?.id || null;
  } catch {
    return json({ error: "Auth verification failed" }, 502);
  }
  if (!userId) return json({ error: "Could not resolve user" }, 401);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }
  const runId = typeof body?.runId === "string" ? body.runId.trim() : "";
  const rating = Number(body?.rating);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
    return json({ error: "Invalid run id" }, 400);
  }
  if (![1, -1].includes(rating)) return json({ error: "Invalid rating" }, 400);

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/coach_model_runs?id=eq.${encodeURIComponent(runId)}&user_id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: {
          "apikey": serviceRoleKey,
          "authorization": `Bearer ${serviceRoleKey}`,
          "content-type": "application/json",
          "prefer": "return=minimal",
        },
        body: JSON.stringify({ feedback: rating, feedback_at: new Date().toISOString() }),
      },
    );
    if (!response.ok) return json({ error: "Feedback unavailable" }, 503);
  } catch {
    return json({ error: "Feedback unavailable" }, 503);
  }
  return json({ ok: true }, 200);
};

export const config = { path: "/api/coach-feedback" };
