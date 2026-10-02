#!/usr/bin/env node
// scripts/generate-icons.mjs
//
// V14.2.1 · Regenerates every favicon / app-icon asset from the theta mark.
//
// Provenance: IBM Plex Mono (the app's mono) ships NO Greek block — a capital
// theta set in it falls back to the system monospace. This mark is therefore
// constructed from Plex Mono Medium's own geometry: the outline below is the
// font's actual "O" glyph (U+004F, extracted with fontTools from
// @ibm/plex-mono complete/woff2, unitsPerEm 1000), and the crossbar is a rect
// at the font's own hyphen thickness (109 units vs 119-unit stems — Plex's
// optical correction for horizontal bars), centered on the O's optical center
// (y 349) and overlapping the ring so the union is seamless. Every stroke is
// authentically IBM Plex Mono. The font is OFL-licensed; embedding outlines
// is permitted.
//
// One-time deps (not in package.json — native/heavy, regeneration is rare):
//   npm i --no-save sharp png-to-ico
// Run from repo root:  node scripts/generate-icons.mjs
// Writes into public/ with the existing filenames (index.html + manifest.json
// reference them; index.html carries a ?v= cache-buster bumped separately).

import sharp from "sharp";
import pngToIco from "png-to-ico";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PAPER = "#FAF9F6";
const INK = "#1A1A1A";
const O_PATH = "M300 -12Q234 -12 185.5 12.5Q137 37 105.5 83.0Q74 129 59.0 196.0Q44 263 44 349Q44 434 59.0 501.5Q74 569 105.5 615.0Q137 661 185.5 685.5Q234 710 300 710Q366 710 414.5 685.5Q463 661 494.5 615.0Q526 569 541.0 501.5Q556 434 556 349Q556 263 541.0 196.0Q526 129 494.5 83.0Q463 37 414.5 12.5Q366 -12 300 -12ZM300 81Q375 81 406.0 137.5Q437 194 437 291V408Q437 504 406.0 560.5Q375 617 300 617Q225 617 194.0 560.5Q163 504 163 408V290Q163 194 194.0 137.5Q225 81 300 81Z";
const BAR = "M150 294.5 H450 V403.5 H150 Z";
const GLYPH = { x0: 44, y0: -12, x1: 556, y1: 710 };

function thetaSvg(heightFrac) {
  const gw = GLYPH.x1 - GLYPH.x0, gh = GLYPH.y1 - GLYPH.y0;
  const s = (512 * heightFrac) / gh;
  const tx = (512 - gw * s) / 2 - GLYPH.x0 * s;
  const ty = (512 - gh * s) / 2 + GLYPH.y1 * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" fill="${PAPER}"/>` +
    `<g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${s.toFixed(5)},-${s.toFixed(5)})">` +
    `<path d="${O_PATH}" fill="${INK}"/>` +
    `<path d="${BAR}" fill="${INK}"/>` +
    `</g></svg>`;
}

const pub = (f) => resolve(process.cwd(), "public", f);
const FAVICON = thetaSvg(0.70);
const APP = thetaSvg(0.66);
const TOUCH = thetaSvg(0.62);
const MASKABLE = thetaSvg(0.545);

writeFileSync(pub("favicon.svg"), FAVICON);
writeFileSync(pub("icon.svg"), APP);

const jobs = [
  [FAVICON, 16, "favicon-16.png"],
  [FAVICON, 32, "favicon-32.png"],
  [FAVICON, 48, "favicon-48.png"],
  [FAVICON, 64, "favicon-64.png"],
  [TOUCH, 180, "favicon-180.png"],
  [TOUCH, 180, "apple-touch-icon.png"],
  [APP, 512, "favicon-512.png"],
  [APP, 512, "icon.png"],
  [MASKABLE, 512, "icon-maskable.png"],
];

for (const [svg, size, name] of jobs) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(pub(name));
  console.log(`ok ${name} (${size}px)`);
}

const ico = await pngToIco([pub("favicon-16.png"), pub("favicon-32.png"), pub("favicon-48.png")]);
writeFileSync(pub("favicon.ico"), ico);
console.log("ok favicon.ico (16+32+48)");
