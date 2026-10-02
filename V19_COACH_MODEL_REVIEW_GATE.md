# V19 Unified Physique Coach — Model Review Gate

**Implementation status:** completed in v19.0.0. The routed stack, evidence packets, deterministic safety bypass, telemetry, feedback, and evaluation harness are now in the codebase. Live provider bake-off results remain deployment-specific and require an Ollama Cloud API key.

The current embedded Coach uses a server-selected model through the existing coach endpoint. That implementation is not automatically promoted into v19.

Before v19 begins, run a deliberate architecture and model review.

## 1. Define the coach jobs

Separate the workload into explicit capabilities rather than sending everything to one general model:

- Intent classification
- Data retrieval and tool selection
- Deterministic calculations
- Training-analysis explanation
- Nutrition planning
- Recovery interpretation
- Safety / guardrail enforcement
- Long-form monthly review
- Conversational response generation

Deterministic code remains the authority for calculations, thresholds, lifecycle state, and hard constraints. The model explains and orchestrates; it does not invent scores or silently change plans.

## 2. Model bakeoff

Evaluate the current model against contemporary alternatives available when v19 work starts. Do not choose by benchmark reputation alone.

Use an app-specific evaluation set covering:

- Correct use of logged data
- Correct attribution of dates and trends
- Refusal to fabricate missing values
- Adherence to clinician guardrails
- No unsafe encouragement to push through symptoms
- Correct handling of active recommendation windows
- No duplicate or conflicting plan changes
- Quality of exercise-progression explanations
- Nutrition suggestions that respect remaining macros and inventory
- Latency on mobile
- Cost per useful coaching interaction
- Privacy and data-retention terms

## 3. Routing strategy

Test whether a routed system outperforms one large model:

- Small/fast model for intent, extraction, and response shaping
- Deterministic tools for calculations and decision rules
- Stronger reasoning model only for complex analysis
- Optional local model path for privacy-sensitive summaries
- Fallback model with equivalent guardrail behavior

Routing must be observable: record which route was selected, latency, cost estimate, tool calls, and outcome quality.

## 4. Grounding and citations

The v19 coach should retrieve a minimal, question-specific evidence packet rather than always sending a generic 14-day slice.

Each answer should be grounded in structured references such as:

- Workout date and exercise exposure
- Set/load/rep/RIR evidence
- Weight and waist windows
- Nutrition days and adherence
- Wearable source and confidence
- Active plan version
- Recommendation outcome
- Clinician guardrail version

The UI should let the user inspect the supporting evidence behind consequential advice.

## 5. Memory design

Separate memory into:

- Stable preferences
- Current goals and active plan
- Clinician-defined constraints
- Recent conversational context
- Evaluated coaching outcomes
- Temporary hypotheses awaiting evidence

Memory must be editable, inspectable, bounded, and revocable. The coach should never convert an unverified conversational claim into a permanent health fact without explicit confirmation.

## 6. Evaluation harness

Create regression tests and a scored offline evaluation harness before model replacement.

Minimum suites:

- Safety and clinician constraints
- Hallucinated metrics
- Conflicting wearables
- Sparse-data honesty
- Recommendation lifecycle awareness
- Plan-version rollback awareness
- Plateau versus adherence distinction
- AM/PM workload arbitration
- Nutrition rescue accuracy
- Longitudinal question answering

A model or prompt change cannot ship if it regresses safety, grounding, or plan consistency even when its prose sounds better.

## 7. Privacy and security review

Re-evaluate:

- Provider data retention and training policy
- Exact data fields leaving the app
- Server-side redaction and allowlists
- Prompt-injection resistance
- Tool authorization boundaries
- Conversation storage and deletion
- Per-user isolation
- Rate limits and cost controls
- Audit logging without storing sensitive raw payloads

## 8. UX review

The v19 coach should not become a generic chat window pasted onto the app.

Preferred interaction modes:

- Context-aware suggested questions
- Evidence-backed answer cards
- One proposed action at a time
- Explicit approve / modify / hold workflow
- Inline links to the exact workout, meal, or review
- Clear distinction between observation, suggestion, and approved plan change

## Ship gate

The v19 model stack is approved only when it:

1. Beats the current coach on the app-specific evaluation set.
2. Preserves or improves safety and guardrail adherence.
3. Produces grounded answers with inspectable evidence.
4. Meets mobile latency and cost targets.
5. Supports provider/model replacement without rewriting product logic.
6. Keeps all consequential plan changes behind explicit user approval.
