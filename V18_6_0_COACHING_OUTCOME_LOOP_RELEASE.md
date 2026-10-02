# 0VERTRAINED v18.6.0 — Coaching Outcome Loop

Released: 2026-07-20

This release closes the loop between a coaching recommendation and its real-world result. Approved recommendations now create explicit plan versions, remain active for a defined evaluation window, and are judged against adherence, body-composition, recovery, and performance evidence.

## Dedicated coaching workspace

A new **Progress → Coach** workspace keeps the Today and Progress Overview surfaces calm. It contains:

- Weekly Coaching Review
- Coaching inbox
- Recommendation lifecycle and outcome history
- Active plan and plan-version history
- Goal projection
- Monthly physique review
- Formal phase management
- Coaching notification policy
- Clinician guardrails

## Recommendation lifecycle

Each weekly recommendation moves through:

`Proposed → Approved / Modified / Held → Active → Evaluated`

Approved and modified recommendations store:

- Effective date
- Evaluation due date
- Baseline snapshot
- Recommendation kind and changes
- Active plan version
- Outcome status

Possible outcomes:

- Effective
- Ineffective
- Harmful
- Inconclusive
- Not followed closely enough to evaluate

The evaluator uses recommendation-specific evidence. Fat-loss levers are judged by weight or waist movement, adherence, recovery, and performance. Recovery interventions are judged by sleep, soreness, and performance rebound.

## Plan versioning and rollback

Approving a recommendation creates `Plan vN` with:

- Calories
- Protein
- Steps
- Phase
- Training-volume modifier
- Cardio-minute modifier
- Effective and evaluation dates
- Link to the prior plan version

Calories and steps update the real app targets after approval. Active training-volume reductions are enforced inside Set Flow by reducing prescribed working sets. Any historical version can be restored, which also restores its goal targets and phase.

## Goal projection

The projection engine uses up to 28 days of weigh-ins and a regression-based trend rather than a fixed countdown. It reports:

- Current trend weight
- Goal-weight range
- Recent weekly rate
- Estimated completion window
- Confidence and data-quality note

No window is shown when the data is too sparse or the recent trend is too flat/noisy.

## Monthly physique review

The four-week review compares current and previous 28-day blocks across:

- Weight
- Waist
- Protein adherence
- Training volume / strength-retention proxy
- Sleep and soreness
- Standardized progress-photo protocol

The app records completion metadata for a standardized front/side/back photo set. It does not reshape or fabricate progress images.

## Formal phase management

The coach can recommend and require approval for transitions among:

- Fat loss
- Maintenance
- Diet break
- Recomposition
- Medical hold

Medical holds are hard constraints and cannot be exited by the coaching engine without clinician clearance.

## Coaching inbox and notification policy

The coaching inbox surfaces only unresolved items, including:

- Weekly review ready
- Evaluation window approaching
- Harmful or ineffective outcome requiring review
- Low Factor inventory
- Phase transition awaiting approval

Category controls and quiet hours are persisted under `settings.coachingSystem.notificationPrefs`. These switches govern the coaching inbox in this release. Existing remote Web Push delivery remains managed by Profile → Notifications and its current Courier channels.

## Clinician guardrails

The app now stores clinician-defined:

- Exercise heart-rate guidance
- Symptom-based stop rules
- Medication notes
- Training restrictions
- Emergency instructions
- Review date

When enabled, these are treated as hard constraints:

- Set Flow blocks new set completion when an existing safety flag activates the clinician stop rule.
- Training restrictions and heart-rate guidance are shown in the live session.
- The embedded Coach receives a sanitized guardrail summary and is explicitly instructed never to override it.

## Embedded Coach grounding

The current Coach now receives:

- Active approved plan
- Current phase
- Training modifiers
- Latest evaluated coaching outcome
- Enabled clinician guardrails

The server sanitizes and whitelists these fields before they reach the model.

## Data compatibility

No database migration is required. New optional settings and entry fields are stored in the existing JSON settings and daily-entry structures:

- `settings.coachingSystem.activePlan`
- `settings.coachingSystem.planHistory`
- `settings.coachingSystem.goalWeightRange`
- `settings.coachingSystem.notificationPrefs`
- `settings.coachingSystem.clinicianGuardrails`
- `intelligence.weeklyCoachReviewResponse.lifecycle`
- `intelligence.weeklyCoachReviewResponse.planVersion`
- `body.progressPhotos[]` (protocol-completion metadata only)

## Main implementation files

- `src/coachingOutcomeLoop.js`
- `src/CoachingOutcomeCenter.jsx`
- `src/WeeklyCoachingReview.jsx`
- `src/ProgressTab.jsx`
- `src/SessionMode.jsx`
- `src/Coach.jsx`
- `netlify/functions/coach.js`
- `src/__tests__/coachingOutcomeLoopV18_6.test.js`

## V19 gate

v19 must not assume the current model/provider remains the best choice. The model, routing, grounding, memory, privacy, latency, cost, and evaluation stack must pass the review documented in `V19_COACH_MODEL_REVIEW_GATE.md` before Unified Physique Coach development begins.
