# 0VERTRAINED V15.5 — Recruiter/Investor Demo Mode

Demo mode existed (the gate's "demo build" — `VITE_DEMO_MODE=true`, a static build behind one URL, zero signup). What it lacked was a dataset worth showing: 30 thin days, two hardcoded lifts the volume/e1RM intelligence couldn't chew on, Whoop and Strava playing dead, no form history, a null recovery score at boot, and — found during this work — **no Oura activity docs at all**, so the V15.1 wearable-load plate was blank in the one mode built for showing off.

## The dataset (`src/demo/demoDataset.js`)

**Deterministic** — seeded PRNG (seed 193, the wordmark's number), so every walkthrough is identical and the contracts below are pinnable. **Program-driven** — 140 days of workouts drawn from `DEFAULT_PROGRAM`'s own lifts with weekly progression, five-week deload waves, ~10% missed days historically but a perfect trailing 12 so the masthead streak reads well. **Coherent across systems** — Strava runs *derive from the entries' own cardio days* (distances match to the meter), Oura readiness dips the morning after heavy lower sessions, body weight walks a slow cut 189→184, soreness follows leg day. **Interactive today** — no workout logged (Session Mode is live to drive in front of someone) and nutrition sits mid-day at ~55%, so Fuel has real gaps to log.

Coverage now: 35 days of Oura (sleep/readiness/**activity**/SpO₂), 35 days of Whoop raw-shaped records the real normalizers accept (the strain plate shows a number), derived Strava activities, and four form checks — an improving squat arc — dated so the FORM badge shows "4" on first visit.

## Wiring

Whoop and Strava now report **connected** in demo with the dataset behind their loaders; the App boot demo branch computes a real recovery score from the demo Oura data (same math, seeded inputs) instead of null; form history injects at the ProgressTab call site — deliberately not inside `formCheckHistory.js`, which stays dependency-free for its node-resolution test suite. All behind existing `isDemoMode()` branches; zero real-user paths touched.

## Validation

Full gate green including the demo build. 120 test files (+1: eight contracts — determinism, program-fidelity of every logged lift, interactive-today, streak ≥ 12, **the load model resolves a real A:C zone**, Whoop normalizes to a finite strain, Strava↔cardio coherence to <2m, form-history badge freshness). No migrations, no env changes; deploy is the standard demo-build publish.

## Using it

Send the demo URL directly — it's the pitch: the whitepaper aesthetic, the broadsheet at desktop width, live Session Mode, and every intelligence figure firing on data that holds up to a second look. Worth a 60-second self-run before sending to anyone, as with any demo.
