# 0VERTRAINED V14.2.1 — Theta Mark (favicon + app icons)

Asset-only patch: the new theta brand mark across every favicon and app-icon surface. No code paths, no schema, no environment changes.

## The mark, and an honest provenance note

The chosen direction was capital Θ in IBM Plex Mono — but **IBM Plex Mono ships no Greek block** (verified against the font's character map: one codepoint in the entire Greek range, the math π). The Θ in the typeface preview was the browser silently substituting a system monospace fallback.

Rather than switch typefaces, the mark is constructed from Plex Mono's own DNA: the ring is the font's actual capital **O** outline (U+004F, extracted from IBM Plex Mono Medium with fontTools), and the crossbar is set at the font's own **hyphen thickness** — 109 units against the O's 119-unit stems, which is Plex's built-in optical correction for horizontal strokes — centered on the O's optical center. Every curve and weight in the final glyph is authentically IBM Plex Mono; the theta simply didn't exist in the font until now. Ink `#1A1A1A` on paper `#FAF9F6`, no border, no rounding (iOS applies its own corner mask).

## Assets regenerated (all existing filenames preserved)

`favicon.svg`, `favicon.ico` (16+32+48 multi-size), `favicon-16/32/48/64.png` (glyph at 70% canvas height for tab presence), `favicon-180.png` + `apple-touch-icon.png` (62% — iOS home-screen margins), `favicon-512.png` + `icon.png` + `icon.svg` (66%), and `icon-maskable.png` (54.5% — inside the Android maskable safe zone's 80% circle).

Verified at pixel level: the 16px favicon holds both the ring and a ~2px crossbar — it reads as Θ, not O, at tab size.

## Reproducibility

`scripts/generate-icons.mjs` is committed with the outlined path and full provenance embedded. Regeneration: `npm i --no-save sharp png-to-ico && node scripts/generate-icons.mjs` from the repo root (deps deliberately kept out of package.json — native and heavy, and regeneration is rare). IBM Plex is OFL-licensed; embedding outlines is permitted.

## Cache behavior after deploy

- **Browser tabs:** icon links in `index.html` now carry `?v=2`, forcing the refetch past the browser's aggressive favicon cache. Expect the new tab icon on first load after deploy.
- **Service worker:** precached icon paths are revved by the `ovt-shell-v14.2.1` cache-name bump — handled by the existing version-sync pipeline.
- **iOS home screen:** iOS caches the apple-touch-icon at install time. Existing home-screen installs may keep the old icon until the user removes and re-adds the app; new installs get the theta immediately. This is an iOS platform behavior, not something the deploy can force.

## Validation

Full quality gate: 115 test files, lint 0 errors, production + demo builds, secret scan, deploy artifact — all green.
