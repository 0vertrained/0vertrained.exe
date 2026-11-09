# Coach deployment and rollback

## Required environment

Existing required variables remain unchanged:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
OLLAMA_API_KEY
COACH_ALLOWED_USER_ID and/or SUPABASE_SERVICE_ROLE_KEY
```

## Recommended routed configuration

The defaults work without additional variables. Set them explicitly when you want the deployment configuration visible in Netlify:

```text
COACH_ROUTING_MODE=routed
COACH_FAST_MODEL=gemma4:31b-cloud
COACH_MAIN_MODEL=qwen3.5:397b-cloud
COACH_DEEP_MODEL=deepseek-v4-flash:cloud
COACH_FALLBACK_MODEL=gpt-oss:120b-cloud
COACH_EXPOSE_MODEL=false
```

Optional timeout overrides:

```text
COACH_FAST_TIMEOUT_MS=14000
COACH_MAIN_TIMEOUT_MS=22000
COACH_DEEP_TIMEOUT_MS=26000
COACH_FALLBACK_TIMEOUT_MS=22000
```

The server clamps timeout values to safe ranges.

## Database migration

Apply:

```text
migrations/V19_0_coach_model_runs.sql
```

The table stores only operational metadata and user feedback. It does not store questions, responses, evidence payloads, or conversation history.

## Verification after deploy

1. Ask “How much protein do I have left today?” and verify a concise evidence-backed answer.
2. Ask an exercise-specific question and verify it does not become an oversized monthly analysis.
3. Ask a twelve-week intervention question and verify deeper analysis with evidence IDs.
4. Confirm that evidence details expand below the response.
5. Mark one response useful and confirm the feedback endpoint returns success.
6. Temporarily set the fast model to an invalid name in a staging environment and verify fallback behavior.
7. Confirm no model name is returned unless `COACH_EXPOSE_MODEL=true`.

## Immediate single-model rollback

No application rollback is required:

```text
COACH_ROUTING_MODE=single
COACH_MODEL=gpt-oss:120b-cloud
```

Redeploy or refresh the function environment. Every route then uses the control model.

## Kill switch

```text
COACH_ENABLED=false
```

This stops coach traffic without disabling the rest of 0VERTRAINED.

## Evaluation

Offline routing/safety regression:

```bash
npm run eval:coach
```

Live candidate bake-off:

```bash
OLLAMA_API_KEY=... npm run eval:coach -- --live
```

Live reports are written to `artifacts/` and should not be committed when they contain generated answers.
