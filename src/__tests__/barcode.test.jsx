// src/__tests__/barcode.test.jsx
// Scanning a barcode on Log food: the product's serving from Open Food
// Facts, the USDA when Open Food Facts has nothing, and a plain word when
// neither does. The servings are chosen before it goes on today.
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { foodFromProduct, scanFood } from "../barcode";
import { ThemeProvider } from "../theme";
import { ShellProvider } from "../ui/shell";
import { FuelTab } from "../FuelTab";

afterEach(() => {
  cleanup();
  delete window.Capacitor;
});

const yogurt = {
  found: true, code: "0818290014245", name: "Greek Yogurt Plain", brand: "Chobani", serving: "170 g",
  perServing: { calories: 90, protein: 16, carbs: 6, fats: 0 }, per100g: { calories: 53, protein: 9.4, carbs: 3.5, fats: 0 },
};

function installScanner({ scan = async () => ({ code: yogurt.code }), lookup = async () => yogurt } = {}) {
  const plugin = { status: vi.fn(async () => ({ supported: true })), scan: vi.fn(scan), lookup: vi.fn(lookup) };
  window.Capacitor = { isNativePlatform: () => true, Plugins: { OTBarcode: plugin } };
  return plugin;
}

describe("foodFromProduct", () => {
  it("logs a serving as the label gives it, named with its brand", () => {
    expect(foodFromProduct(yogurt)).toEqual({ name: "Chobani Greek Yogurt Plain", serving: "170 g", calories: 90, protein: 16, carbs: 6, fats: 0, source: "scan" });
  });

  it("falls back to 100 g, and needs something to count", () => {
    expect(foodFromProduct({ ...yogurt, perServing: undefined, brand: "Greek" })).toMatchObject({ name: "Greek Yogurt Plain", serving: "100 g", calories: 53 });
    expect(foodFromProduct({ found: true, name: "Water", per100g: { calories: 0, protein: 0 } })).toBeNull();
    expect(foodFromProduct({ found: false })).toBeNull();
  });
});

describe("scanFood", () => {
  it("asks the USDA when Open Food Facts has nothing, and says when nobody does", async () => {
    installScanner({ lookup: async () => ({ found: false, code: "123456789012" }) });
    const usdaLookup = vi.fn(async () => ({ name: "Oats", serving: "100 g", calories: 380, protein: 13, carbs: 67, fats: 7, source: "scan" }));
    expect(await scanFood({ usdaLookup })).toMatchObject({ food: { name: "Oats" } });
    expect(await scanFood({ usdaLookup: async () => null })).toEqual({ notFound: yogurt.code, offline: false });
  });

  it("tells a closed scanner from a blocked camera", async () => {
    installScanner({ scan: async () => ({ cancelled: true }) });
    expect(await scanFood()).toEqual({ cancelled: true });
    installScanner({ scan: async () => { throw Object.assign(new Error("no"), { code: "camera" }); } });
    expect(await scanFood()).toEqual({ error: "camera" });
  });
});

function setPath(object, keys, value) {
  if (!keys.length) return value;
  const [head, ...rest] = keys;
  return { ...(object || {}), [head]: setPath(object?.[head], rest, value) };
}

function mountFuel() {
  let latest = null;
  function Harness() {
    const [day, setDay] = useState({ nutrition: { calories: "0", protein: "0" } });
    latest = day;
    const updateToday = (path, value) => setDay((prev) => setPath(prev, path.split("."), value));
    return (
      <ThemeProvider>
        <ShellProvider>
          <FuelTab settings={{ goals: { calories: 2400, protein: 200, carbs: 250, fats: 70, water: 128 } }} todayData={day} updateToday={updateToday} showToast={vi.fn()} todayKey="2026-11-26" loaded data={{}} onPatchSettings={async () => ({ ok: true })} />
        </ShellProvider>
      </ThemeProvider>
    );
  }
  render(<Harness />);
  return { day: () => latest };
}

describe("Fuel → Log food → Scan a barcode", () => {
  it("shows the product, takes the servings and logs it", async () => {
    installScanner();
    const { day } = mountFuel();
    fireEvent.click(screen.getByRole("button", { name: "Log food" }));
    const scanButton = await screen.findByRole("button", { name: "Scan a barcode" });
    await act(async () => { fireEvent.click(scanButton); });
    const sheet = await screen.findByRole("dialog", { name: "Chobani Greek Yogurt Plain" });
    expect(within(sheet).getByText("One serving is 170 g.")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "More servings" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Add to today" }));
    expect(day().nutrition.meals[0]).toMatchObject({ name: "Chobani Greek Yogurt Plain", qty: 1.5, source: "scan" });
    expect(day().nutrition.calories).toBe("135");
  });

  it("says so when the barcode isn't known", async () => {
    installScanner({ lookup: async () => ({ found: false }) });
    mountFuel();
    fireEvent.click(screen.getByRole("button", { name: "Log food" }));
    const scanButton = await screen.findByRole("button", { name: "Scan a barcode" });
    await act(async () => { fireEvent.click(scanButton); });
    expect(await screen.findByText(/isn’t in Open Food Facts or the USDA database yet/)).toBeTruthy();
  });

  it("isn't offered without the scanner", () => {
    mountFuel();
    fireEvent.click(screen.getByRole("button", { name: "Log food" }));
    expect(screen.queryByRole("button", { name: "Scan a barcode" })).toBeNull();
  });
});
