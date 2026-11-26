// src/barcode.js
// Scanning a food's barcode into the log, in iPhone app builds with the
// scanner (ios/App/App/BarcodePlugin.swift). The phone reads the barcode and
// looks it up in Open Food Facts; the USDA database is asked when Open Food
// Facts doesn't have it. Fuel confirms the servings before logging.
import { nativePlugin } from "./native";

export function barcodeScanner() {
  return nativePlugin("OTBarcode") || null;
}

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

/**
 * A product as a food to log: one serving as the label gives it, or 100 g
 * when the label only gives that. Null without a name's worth of data.
 */
export function foodFromProduct(product) {
  if (!product?.found) return null;
  const per = product.perServing ? { macros: product.perServing, serving: String(product.serving || "").trim() || "1 serving" }
    : product.per100g ? { macros: product.per100g, serving: "100 g" }
    : null;
  if (!per || !(number(per.macros.calories) > 0 || number(per.macros.protein) > 0)) return null;
  const name = String(product.name || "").trim();
  const brand = String(product.brand || "").trim();
  const title = !name ? (brand || "Scanned food")
    : brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${name}` : name;
  return {
    name: title,
    serving: per.serving,
    calories: Math.round(number(per.macros.calories)),
    protein: Math.round(number(per.macros.protein) * 10) / 10,
    carbs: Math.round(number(per.macros.carbs) * 10) / 10,
    fats: Math.round(number(per.macros.fats) * 10) / 10,
    source: "scan",
  };
}

/**
 * Scan, then look up: { food }, { cancelled: true }, { notFound: code,
 * offline }, or { error: "camera" | "unavailable" }. `usdaLookup(code)` is
 * asked when Open Food Facts has nothing.
 */
export async function scanFood({ usdaLookup = null } = {}) {
  const scanner = barcodeScanner();
  if (!scanner) return { error: "unavailable" };
  let scanned;
  try {
    scanned = await scanner.scan();
  } catch (error) {
    return { error: error?.code === "camera" ? "camera" : "unavailable" };
  }
  if (!scanned?.code) return { cancelled: true };
  let product;
  try { product = await scanner.lookup({ code: scanned.code }); } catch { product = null; }
  let food = foodFromProduct(product);
  if (!food && usdaLookup) {
    try { food = await usdaLookup(scanned.code); } catch { food = null; }
  }
  if (food) return { food };
  return { notFound: scanned.code, offline: Boolean(product?.offline) };
}
