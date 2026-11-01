# 0VERTRAINED v19.0.0 — Unified Physique Coach

V19 replaces the single-model coach call with an observable, evidence-grounded coaching system. The user still interacts with one coach; the server selects the smallest suitable model route for the task.

## Model routes

- **Fast:** `gemma4:31b-cloud` for simple daily retrieval and next-action questions.
- **Main:** `qwen3.5:397b-cloud` for standard training, nutrition, recovery, and plan questions.
- **Deep:** `deepseek-v4-flash:cloud` for long-range intervention and trend analysis.
- **Fallback/control:** `gpt-oss:120b-cloud` when a primary route fails and as the retained comparison baseline.

All routes are server-configurable. `COACH_ROUTING_MODE=single` plus `COACH_MODEL=...` restores single-model behavior without a code rollback.

## Question-specific evidence

The client now builds a bounded evidence packet for each question rather than relying only on a generic recent-data dump. Packets may include:

- Clinician-defined hard constraints
- Active plan version and evaluation window
- Today’s calories, protein, steps, training, and remaining targets
- Current and previous seven-day trends
- Resolved wearable recovery context and confidence
- Deterministic app recommendation
- Nutrition Autopilot rescue options
- Exercise-specific exposure history
- Latest recommendation outcome
- Twelve-week windows for deep analysis

Every evidence item has an inspectable ID such as `E1`. Consequential or analytical answers must cite evidence IDs; the server adds a grounded footer when the provider omits citations.

## Deterministic authority and safety

Language models cannot directly mutate plans or replace tested application logic. Calories, progression rules, volume ceilings, phase state, clinician constraints, recommendation lifecycle, and approved-plan activation remain deterministic.

Acute concerning symptom language bypasses the model entirely. The server returns the stored clinician stop rules and emergency guidance rather than asking a provider whether the athlete should continue training.

## Resilience and observability

- Per-route timeout and output bounds
- Automatic fallback to the control model
- Optional single-model rollback mode
- Route, latency, fallback, grounding, and token telemetry
- Helpful/unhelpful feedback attached to the caller’s own run
- No prompt, response, conversation, or evidence content stored in telemetry
- Model names hidden from the client unless explicitly enabled for diagnostics

## Evaluation harness

`npm run eval:coach` runs deterministic route/safety checks across the app-specific regression suite.

`npm run eval:coach -- --live` calls every configured candidate against the same cases and writes a timestamped JSON report under `artifacts/`. Live execution requires `OLLAMA_API_KEY`; it is intentionally not part of the offline quality gate.

The included cases cover:

- Sparse-data honesty
- Clinician hard stops
- Active-plan change stacking
- Plateau versus adherence
- Conflicting wearables
- Exercise progression
- AM/PM arbitration
- Nutrition rescue
- Plan rollback awareness
- Longitudinal outcome analysis

## UI changes

- One unified Coach experience remains in place.
- Answers can expose the exact supporting evidence rows.
- Helpful/unhelpful controls feed model evaluation without storing message content.
- The user does not see route or model changes during normal use.

## Database

Apply `migrations/V19_0_coach_model_runs.sql` before relying on telemetry or response feedback. The coach itself still works if telemetry persistence fails.

## Compatibility

- No existing entry, workout, program, nutrition, wearable, or coaching-plan schema is changed.
- The existing access gate, daily cap, monthly entitlement, kill switch, and Supabase JWT verification remain active.
- Image generation is intentionally outside the v19 scope.
