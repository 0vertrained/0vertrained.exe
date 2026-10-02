# 0VERTRAINED V17.4.1 — Cascade Clarity

Patch release from a field report on V17.4.0, verbatim: *"What does the note drop + rp mean?"* A fair catch — the Cascade offer shipped as two lowercase abbreviations whose only explanation lived in hover tooltips, and phones have no hover. The comprehension doctrine ("jargon lives in expandables, plain language everywhere") applied to every figure in the app except the newest one.

## The fix

The offer is now two self-explanatory rows, full words with a plain hint each:

```
+ drop set      past failure: strip ~25% and go straight back in, no rest
+ rest-pause    same load: rest fifteen breaths, squeeze out more, repeat
```

And it appears **only on the final set of the exercise** — matching the programming doctrine (The Double Edition prescribes techniques on final sets) and eliminating the four-offers-per-exercise clutter the old behavior produced. Mid-exercise techniques remain available any time through Session Mode's V12 type-cycler, which is unchanged. The active figure's hints were upgraded to the same plain register.

## Verification

Offer tests rewritten: full-word labels and both plain hints asserted in the rendered text, the last-set gate exercised in both directions, the TodayTab call-site gate pinned. **142 test files passing, lint 0 errors, both builds green, dist secret scan clean.** No migrations, no deploy steps.
