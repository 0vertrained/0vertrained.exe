// src/fonts.js
// Self-hosted fonts via @fontsource, replacing the render-blocking
// Google Fonts <link> in index.html. Same families and weights as the old
// request; woff2 files ship from /assets with immutable caching, so first
// paint no longer waits on fonts.googleapis.com and the CSP no longer needs
// Google's domains. Static (non-"Variable") packages register the plain
// family names, so theme.jsx font stacks are untouched.

// IBM Plex Mono — 400/500/600 (Whitepaper System monospace)
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";

// IBM Plex Sans — 400/500/600 (primary UI face per theme.jsx)
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";

// Inter — 300–700 (fallback UI face)
import "@fontsource/inter/300.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";

// Space Grotesk — 400–700
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";

// Newsreader — 400/500/600 upright + 400/500 italic (editorial serif)
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/500.css";
import "@fontsource/newsreader/600.css";
import "@fontsource/newsreader/400-italic.css";
import "@fontsource/newsreader/500-italic.css";
