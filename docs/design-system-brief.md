# Design brief: 0VERTRAINED v20 design system

Paste everything below this line into a new session.

---

Design a complete design system for **0VERTRAINED**, a gamified workout tracker, and deliver it as a Design System artifact I can attach to future design and build sessions. Build it as a real system (tokens, type scale, components, states, motion, copy rules), not a mood board. Treat the product description, the screen inventory and the constraints below as fixed. Everything about the visual identity is open; I want you to make strong, opinionated choices and tell me why.

## 1. The product in one paragraph

0VERTRAINED is a mobile-first web app (installable PWA) for lifters, runners and bodyweight trainees. Every day it issues one **Daily Quest** sized by a five-second check-in, you log it one set at a time, and you claim XP. Real training raises your **Level**, your **Rank** (E to S) and three stats: **STR**, **END** and **VIT**. The tagline is "Level up. Never overtrain." That second half is the point: the game pays you for training to plan and recovering properly, never for grinding. Rest days earn XP. A day the app scales down still pays in full. Missing a day never costs progress; only a streak can reset, and shields protect it. The feeling we want: an ordinary person getting stronger through daily discipline, with a calm, confident interface that treats effort with respect. Inspired by progression RPGs in spirit, but with an original identity: no franchise names, no blue "status window" clone, no anime styling.

## 2. Who it is for

- **Primary:** people training 2–6 days a week who log on a phone in a gym, often one-handed, sweaty, with poor signal. They dropped spreadsheet-style trackers within six weeks and want a daily answer to "what do I do today?" and visible progress.
- **Secondary:** recruiters and engineers reviewing it as a portfolio piece. First impression matters; the demo opens with one tap and no signup.

## 3. Feature inventory (what the system must dress)

### Navigation
Three tabs: **Quest**, **Stats**, **Profile**. A slim status strip on every tab shows the rank badge, level, a thin XP bar, the streak with its shields, and a sync indicator (synced / saving / offline with a count of queued days). Full-screen flows (the session runner, the cardio runner) hide the tabs. Sheets slide up for check-in, exercise list, swap/skip, day detail, rank trial, stat explanation, titles, day editor, program generator and sign-in. Dialogs are confirm-only.

### Landing
Wordmark and tagline, an interactive "how do you feel today?" playground that runs the real tier logic, three one-line benefits, one primary action ("Try the demo"), a secondary ("Start fresh"), a text link ("Sign in"), a footer. Must fit about 1.5 phone screens.

### Onboarding (3 steps)
Goal (strength / muscle / endurance / general fitness / lift + run), then days per week (2–6), equipment (gym / dumbbells / none), experience, units, optional bodyweight. Then a generated 7-day program preview with a single "Start" action. Under 60 seconds.

### Quest (home)
One card: a tier badge (**FULL / REDUCED / RECOVER / REST**), one plain reason line ("Slept poorly + very sore: Reduced quest. One set less per lift. Same XP."), two or three objective rows with progress and XP value (Status check, Training 0/12 sets, Run 25 min, Recovery done), and **one primary button** whose label comes from the state machine: Check in → Begin quest → Continue (7/12) → Log cardio → Mark recovery done → Claim rewards → (disabled) Quest cleared +130 XP. Below: a week strip of seven day markers (kept / rest / protected / open / missed / today / upcoming) with a weekly quest row, and a single notice slot (Rank Trial available, Shield used, Pause/illness status). Nothing else.

### Check-in sheet
Four tap rows with three options each: Slept (poorly / fine / well), Sore (no / some / very), Stress (low / some / high), Energy (low / ok / high). An "Ill or injured" switch showing the pause allowance left. An optional 140-character note. A live result line with the tier badge. One Done button. Copy must make clear it can only lower today's quest, never raise it.

### Session runner (full screen, the most-used surface)
Top: Exit, the session name, an "Exercise 2/5" button opening the exercise list (work out of order when equipment is taken), save status. Then exercise name and a one-line cue. A target line ("Target 185 × 6 · Last 180 × 6") with a "Use" action. A set card with large load and reps steppers (56 px controls; seconds for holds; reps only for bodyweight moves with optional added load), a sticky **Complete set 2 of 4** primary button that must never fall below the fold on a 390 × 844 screen, and set dots (done / current / planned; tap a done dot to edit). "+ Add set" beyond the plan (logged, earns no XP). A rest timer bar that appears after a set: drift-free countdown, ±30 s, Skip, haptic and chirp at zero. A non-modal record toast ("[RECORD] Bench Press est. max 221 lb"). An overflow menu: Swap (curated substitutions), Skip (equipment / time), Flag pain, I'm unwell, Plate math (barbell lifts only). A highlighted Rank Trial set when one is attached. At most 10 focusable controls in the set-card region.

### Cardio runner (full screen)
Planned or preset segments, a big timer, a segment bar, Pause/Resume (paused time excluded), then distance entry in the user's units. Start / Finish / Save.

### Quest cleared (reward sheet)
"[QUEST CLEARED]" with the tier, animated XP lines (Status +10, Training +120, Record +25), the level bar filling with a **LEVEL UP** moment when a level is crossed, records (old → new est. max), stat changes beyond ±3, streak and shields, any title unlocked, a full-screen **promotion** takeover when a Rank Trial passes, one compact summary row (duration, sets, volume), and a deliberate Done. This is the only celebratory surface in the app.

### Stats
1. Status: name and featured title, a large rank badge, "Lv 17 · 1,140 / 1,500 XP", and the next rank's requirements as a checklist (Level 22 (you: 19) · 12 qualifying weeks (9) · STR or END 40 (43, met) · VIT 50 (55, met) · Rank Trial: locked). A "Begin Rank Trial" primary only when one is available.
2. Three stat tiles (STR / END / VIT) with the value, a 4-week sparkline and a neutral delta ("steady", "+4 in 4 weeks"); tapping opens an explain sheet with the formula in plain words and the inputs that fed it. Drops are shown in neutral grey, never red.
3. Records: top 5 (est. max or best reps/hold, date, sparkline) and "View all".
4. Titles: "Titles 9/18" opening a grid; locked titles show their requirement.
5. Quest log: a paginated history (20 per page) with date, tier, status and XP; a day detail sheet.

### Profile (one autosaving page, no modals)
Program: a 7-row week; tapping a day opens the day editor (exercise autocomplete, sets/reps, rest toggle). "Generate new program" and "Switch preset" (5 presets: Beginner full body, Calisthenics, Bodybuilding, Powerlifting, Running), each confirmed. Changes apply from tomorrow. Settings: units (lb·mi / kg·km), bodyweight, rest-timer sound, haptics, default rest seconds, Pause training (sick / travel / life; shares a 14-days-per-90 allowance with illness). Data: Export backup, Import, Delete account. Sign out.

### Rank Trial sheet
The "boss" moment, deliberately sub-maximal: for a loaded lift, 5 reps at 80% of the 90-day best estimated max; for bodyweight, reps ≥ 80% of the 90-day best then a plank; for cardio, 20 continuous minutes. Shows the prescription, "stop if anything hurts", and the full-condition day it will attach to. Passing gives +300 XP, the promotion and a title.

### Account
Username + password sign-in, create account, forgot password via a recovery phrase. Guest mode: "Try the demo" (a seeded 10-week character) and "Start fresh" (empty), with a GUEST chip in the status strip and a prompt to keep guest progress on sign-up.

### System states the components must cover
- Tiers: FULL, REDUCED, RECOVER, REST (each needs a colour **and** a text label; never colour alone).
- Ranks: E, D, C, B, A, S (each needs a distinct badge treatment; E is the starting rank and must still feel fine to hold).
- Day markers: kept, rest, protected, open, missed, today, upcoming.
- Objective rows: not started, in progress, done.
- Set dots: done, current, planned, extra, trial, pain-flagged.
- Sync: synced, saving, offline (with a count), conflict resolved.
- Buttons: primary, secondary, ghost, danger; disabled; loading.
- Stat deltas: up, steady, down (down is neutral, never alarming).
- Notices: bracketed tags [QUEST], [QUEST CLEARED], [RECORD], [LEVEL UP], [RANK TRIAL], [SHIELD], [REST], [OFFLINE], each followed by one calm sentence.
- Empty states (always with one action), skeleton loading, error boundary ("Something broke. Your data is safe.").

## 4. What the system must deliver

1. **Identity.** One nameable direction and the reasoning behind it. Pick something with a point of view; "dark mode with a teal accent" is the default I am trying to escape. Consider what "levelling up through discipline" looks like visually when it is calm and earned rather than loud: think in terms of materials, texture, type character, how reward moments differ from everyday moments.
2. **Colour tokens** as CSS custom properties: surfaces (at least three levels), borders (decorative and control), text (three levels), one accent, gold or equivalent for XP/records/level-up, the four tier colours, the six rank colours, danger (destructive actions and errors only). Dark theme is required; a light theme is optional. Every text/background pair must meet WCAG AA (4.5:1; 3:1 for 24 px and up), every control border 3:1 against its surface. Please state the contrast ratios.
3. **Typography.** A display face for numbers, ranks, tier badges, tags and screen titles, and a reading face for everything else. Open-licence (Google Fonts or similar), two families at most, self-hostable. A scale with a 12 px floor, 16 px inputs, tabular numerals for every number. Show the scale and where each step is used.
4. **Spacing, radius, elevation, z-layers.** A 4 px grid. Flat surfaces are fine; if you use shadow or glow, define exactly where.
5. **Components**, each with every state listed above: Button, Sheet (bottom), Dialog, Toast/Notice, Panel/Card, ObjectiveRow, TierBadge, RankBadge, StatTile with sparkline, ProgressBar (XP, objective, timer), Stepper, SetDots, WeekStrip, Tab bar, Status strip, Timer display, Switch, Text input, Segmented control (units), Skeleton, EmptyState, Icon set (about 14 line icons: quest, stats, profile, check, lock, flame, shield, chevron, more, swap, skip, pain, timer, offline).
6. **Motion rules.** Transform/opacity only, respect prefers-reduced-motion. Define the five reward moments (objective tick, XP fill, level up, record, rank promotion) and keep everything else near-instant. No confetti, no particles, no looping glows.
7. **Copy rules.** Two voices: plain second-person UI copy, and the bracketed notice voice ("[RECORD] Bench Press est. max 221 lb (was 216)."). No jargon (no RIR, e1RM, ACWR — say "est. max", "requirements"). Never shame: a missed day reads "Streak reset. Best: 23 days. Today is day 1." No franchise words anywhere ("Hunter", "Shadow", "Arise", "System" as a narrator, "Player" as branding).
8. **Three reference screens** rendered in the system so I can judge it: the Quest home, the Session runner mid-set with the rest timer showing, and the Quest cleared sheet with a level up.
9. **A short README** that a build agent can follow: how tokens map to CSS variables, which component to use for what, and the rules that must never be broken (one primary action per screen, tier always labelled, 44 px targets, numbers tabular, down-deltas neutral).

## 5. Constraints

- Mobile-first at 390 × 844; one desktop breakpoint at 1024 px (content centred in a 640 px column, tabs move to the header). No tablet layout.
- Implementation target is React + CSS Modules + CSS custom properties, no UI framework, so the system should be expressible as tokens plus plain CSS. No gradients-as-identity, no glassmorphism, no emoji as icons.
- Performance budget: two font families, latin subset, ideally under 120 KB total.
- Accessibility is a requirement, not a polish step: real buttons and inputs, focus-visible rings, screen-reader labels on icon-only controls, 44 px touch targets, reduced-motion support.
- Keep the name 0VERTRAINED. The leading zero can be a mark (it reads as "zero overtraining"); treat the wordmark as part of the brief.

## 6. Open questions I would like your recommendation on

- Dark only, or dark with a light variant?
- How literal should the "game" feel be? I want the structure of an RPG (quests, XP, ranks, stats), with the restraint of a good fitness product. Show me where you land on that spectrum and why.
- Rank badge: letter in a shape, a glyph per rank, or a material progression (iron → steel → gold)? Each rank should be recognisable at 24 px in the status strip.
- Reward moments: how much ceremony does a level up deserve versus a daily quest clear?

When you are done, give me the Design System artifact link and a one-paragraph summary of the direction. I will attach it to the build sessions.
