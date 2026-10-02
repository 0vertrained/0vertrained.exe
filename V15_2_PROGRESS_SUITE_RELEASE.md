# 0VERTRAINED V15.2 — Progress Suite Spreads

Third slice of the desktop arc: every Progress sub-view composes at the broadsheet tier. Below 1440px each wrapper is `display:contents` — layout byte-identical to V15.1.1, pinned by the guard suite.

## Sub-masthead + FORM badge (mockup 1h)

`ProgressSubnav` graduates at the tier: taller, and FORM carries an unreviewed-checks badge. "Unreviewed" is honest: a view-timestamp (`ovt-form-viewed-at`, stamped when the Form sub-tab opens) — checks saved after your last visit count, nothing is fabricated. Badge is tier-only, so mobile stays untouched.

## History master–detail (mockup 1k — the headline)

The day-detail ledger was extracted out of the Entries lens into a panel **shared by both History lenses**. At the tier, Events and Entries each become `440px | 1fr`: master list left, day detail docked right (with an honest hint plate when nothing's selected). Timeline date-group headers become clickable at the tier to open the day alongside; Entries rows already selected days and now dock instead of taking over. On mobile, Entries keeps its exact full-screen takeover, and Timeline stays read-only — both asserted.

## Overview (mockup 1h, scoped honestly)

Shipped as the **structure-respecting two-column form**: verdict + limiting factors + evidence rail left (480px), wearable trends + the Planning-tools disclosure — **opened by default at the tier** — right. The mockup's full three-column cut would slice through the planning DisclosureBlock, which is stateful chrome; threading Suspense through it worked, threading the disclosure did not. The 3-col refinement is tracked in the plan pending that restructure, not faked around it.

## Program (mockup 1j) & Form (mockup 1i)

Program: `480px | 1fr` — plan summary, race block, and this-week guidance rail left; the week table + block history get the width they read best at. Form: `440px | 1fr` with explicit grid placement — personalized note + movement trends left, the check ledger wide right.

## Validation

Full gate green. 119 test files (+1 mounted `broadsheetProgress` smoke per the V15.1.1 policy — renders the Overview spread at the tier, clicks into History, asserts master + hint panels; plus 1 new static guard covering all eight section ids, the shared-panel invariant, and the badge mechanics). The centering guard **correctly failed** when Progress joined the broadsheet-aware set and was updated deliberately. Lint 0 errors, both builds, secret scan clean. No migrations, no env changes.
