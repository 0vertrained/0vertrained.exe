# 0VERTRAINED v18.2.0 — Adaptive Progression

## Release intent

Adaptive Progression turns Set Flow from a workout recorder into a conservative training prescription system. The intelligence stays inside the live workout experience so the v18.1.1 Today Command Center remains calm and focused.

The engine uses completed performance, effort, technique quality, pain flags, recent trends, weekly volume, and AM/PM context. Recommendations remain editable and never override safety guidance.

## What shipped

### Exercise-level prescriptions

Before an exercise, Set Flow now displays a next target based on prior exposures:

- Target load
- Target reps by set
- Hold, add-reps, add-load, reduce-load, or recovery guidance
- Confidence level and a short rationale
- One-tap **Use target** action

The default model uses double progression: earn repetitions inside the programmed range before increasing load. A single poor session does not create a stall or trigger a regression.

### Technique and pain feedback

Every working set can optionally record:

- Clean technique
- Grind
- Form breakdown
- Pain or discomfort

Weight and repetitions remain the primary interaction. Feedback is optional and stored on the existing set object, so prior workout history remains compatible.

Technique breakdown or pain prevents automatic load progression. Pain also raises a conservative intervention instead of encouraging the athlete to push through it.

### Next-session decisions

After an exercise is completed, the app generates and stores the next exposure:

- Progression decision
- Next load and rep targets
- Decision rationale
- Confidence

Substituted exercises retain independent progression histories. Performance on a machine press, for example, is not silently merged into the barbell press history.

### Stall and strength-retention detection

The progression engine looks across repeated exposures rather than reacting to one day. It can identify:

- Genuine multi-session stalls
- Repeated rep regression
- Excessive effort at the same load
- Technique-related holds
- Strength loss that may warrant reviewing cut fatigue or recovery

Strength-retention alerts are informational and do not automatically change calories or training volume.

### AM/PM load arbitration

Session Mode now evaluates the relationship between today's sessions. It can:

- Protect PM cardio after a demanding lower-body AM session
- Avoid stacking missed hard work into the same day
- Flag overlapping muscle stress
- Preserve tomorrow's priority session
- Keep easy Zone 2 work when appropriate

The app does not blindly redistribute missed work.

### Fatigue and deload recommendations

Deload guidance requires multiple corroborating signals, such as repeated performance decline, worsening effort, soreness, poor sleep, joint discomfort, or excessive volume.

When warranted, the app gives a concrete intervention rather than a vague warning, including a temporary set-volume reduction and duration. A safety flag bypasses optimization and shows the existing conservative safety guidance.

### Muscle-volume projection

The live-session intelligence rail now projects weekly hard sets by muscle group and compares them with configured minimum, target, and ceiling zones. Today remains free of another large dashboard; only the workout surface exposes this detail.

### Ranked exercise substitutions

Substitutions can now be ranked by the reason for the change:

- Equipment unavailable
- Joint tolerance
- Lower fatigue cost
- Similar movement pattern

Each option explains why it is appropriate, while preserving separate progression history for the performed movement.

## Persistence and compatibility

No database migration is required. New data is stored as optional fields inside the existing daily workout structure:

- `workout.exercises.<name>.sets[].quality`
- `workout.exercises.<name>.sets[].pain`
- `workout.exercises.<name>.progressionDecision`
- `workout.exercises.<name>.nextPrescription`

Existing sessions and set records remain readable.

## Main implementation files

- `src/progressionEngine.js`
- `src/fatigueManagement.js`
- `src/trainingArbitration.js`
- `src/exerciseSubstitutions.js`
- `src/setGhosts.js`
- `src/sessionIntelligence.js`
- `src/workout/CurrentSetComposer.jsx`
- `src/SessionMode.jsx`
- `src/TodayTab.jsx`
- `src/__tests__/adaptiveProgressionV18_2.test.js`
- `src/__tests__/setFlowV18.test.jsx`

## Validation

- All 148 repository test files passed in bounded batches.
- 1,624 tests passed.
- The focused v18.2 suites passed 24 tests covering double progression, stalls, technique feedback, safety bypass, deload logic, AM/PM arbitration, volume projection, substitutions, and Set Flow interaction.
- ESLint completed with zero errors.
- Production and demo builds passed.
- No database migration is required.

## Next release target

v18.3 should add the Weekly Coaching Review:

- Seven-day weight and waist trends
- Adherence review
- Plateau confirmation rules
- Calorie and activity adjustment proposals
- Phase and diet-break management
- Progress-photo workflow
