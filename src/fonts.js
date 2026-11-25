// src/fonts.js
// Self-hosted fonts via @fontsource: the three Ledger faces and nothing else.
// The woff2 files ship from /assets with immutable caching, so first paint
// never waits on a third party and the CSP needs no font domains. Static
// (non-"Variable") packages register the plain family names the stylesheet
// and theme.jsx use.

// IBM Plex Mono — 400/500/600 (data: numbers, logs, timers)
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";

// IBM Plex Sans — 400/500/600/700 (the interface face)
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";

// Newsreader — 400/500/600 upright + 400/500 italic (the voice: headlines and the call)
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/500.css";
import "@fontsource/newsreader/600.css";
import "@fontsource/newsreader/400-italic.css";
import "@fontsource/newsreader/500-italic.css";
