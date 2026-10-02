# 0VERTRAINED V4.6A Today UI Compression

## Scope

Today tab only.

No backend, SQL, storage schema, scoring, recommendation, or navigation changes.

## What changed

- Added a single primary `Do next` row under the Today Coach hero.
- Added `buildNextAction()` in `src/todaySummary.js` to derive Start / Continue / Cardio / Finish / Check-in copy from existing logging state.
- Compact Today Coach default:
  - shows call/title/subtitle first
  - moves DO / AVOID / WATCH and WHY into `Coach detail`
  - preserves source/confidence/risk badges
  - preserves After Session feedback disclosure
- Session notes now collapse by default for long cardio notes.
- Check-in remains collapsed by default with summary intact.
- Existing logging write paths are unchanged.

## Visual inspection

Demo build was inspected on Today only before moving to any other tab.

Confirmed:

- Today call/title remains visible.
- The primary `Start logging` / `Log` row is now prominent.
- Coach detail expands and reveals DO / AVOID / WATCH / WHY.
- Session notes expand and still show interval instructions.
- Console clean during browser smoke.

## Verification

Focused verification:

```bash
npm test -- src/__tests__/todaySummary.test.js src/__tests__/todayDecision.test.js src/__tests__/uiStability.test.js
npm run build
```

Full verification:

```bash
npm test
npm audit --omit=dev
npm run quality:gate
npm run build
```

Results:

- 69 test files passed
- 989 tests passed
- 0 vulnerabilities
- quality gate passed
- production build restored after demo inspection

## Known follow-up

Do not move to Recovery/Fuel/Progress/More until Today has user approval. Next candidate after approval: Recovery compression.
