// Profile, mounted: the hub is a short list of doors; Coach holds the coach's
// preferences and the clinician guardrails; Your data holds the backups.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { useState } from "react";
import { ThemeProvider } from "../theme";
import { ProfileScreen } from "../ProfileScreen";
import { APP_VERSION } from "../appMeta";

afterEach(cleanup);

// The app owns the view; this stands in for it.
function Harness({ start = "home", onView, ...props }) {
  const [view, setView] = useState(start);
  return <ProfileScreen {...props} view={view} onView={(next) => { onView?.(next); setView(next); }} />;
}

function mount(props = {}) {
  const calls = {
    onView: vi.fn(), onSettings: vi.fn(), onLogout: vi.fn(), showToast: vi.fn(),
    exportJSON: vi.fn(), exportCSV: vi.fn(), onPasteImport: vi.fn(),
    onSaveCoachPreferences: vi.fn(), onSaveCoachingSettings: vi.fn(),
  };
  const fileRef = { current: { click: vi.fn() } };
  const view = render(<ThemeProvider><Harness username="athlete01" settings={{}} allData={{}} fileRef={fileRef} {...calls} {...props} /></ThemeProvider>);
  return { ui: within(view.container), container: view.container, fileRef, ...calls };
}

describe("Profile", () => {
  it("names the account and lists six doors, each a real row", () => {
    const { ui } = mount();
    expect(ui.getByRole("heading", { level: 2, name: "athlete01" })).toBeTruthy();
    const rows = within(ui.getByRole("list")).getAllByRole("button");
    expect(rows.map((row) => row.querySelector(".t-bs").textContent)).toEqual(["Notifications", "Coach", "Settings", "Integrations", "Your data", "Help and about"]);
    // jsdom cannot send a push, and the row says so before it is opened.
    expect(rows[0].textContent).toContain("Not available here");
    expect(rows[1].textContent).toContain("Memory off, clinician guardrails off");
    expect(ui.getByText(`Version ${APP_VERSION.replace(/^V/, "")}`)).toBeTruthy();
  });

  it("says what is on from the saved settings", () => {
    const { ui } = mount({ settings: { coachPreferences: { enabled: true }, coachingSystem: { clinicianGuardrails: { enabled: true } } } });
    expect(ui.getByRole("button", { name: /^Coach/ }).textContent).toContain("Memory on, clinician guardrails on");
  });

  it("opens Settings at the section a row names", () => {
    const { ui, onSettings, onView } = mount();
    fireEvent.click(ui.getByRole("button", { name: /^Settings/ }));
    fireEvent.click(ui.getByRole("button", { name: /^Integrations/ }));
    fireEvent.click(ui.getByRole("button", { name: /^Help and about/ }));
    expect(onSettings.mock.calls.map((call) => call[0])).toEqual([undefined, "integrations", "about"]);
    expect(onView).not.toHaveBeenCalled();
  });

  it("logs out from the hub", () => {
    const { ui, onLogout } = mount();
    fireEvent.click(ui.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("is plain about the demo", () => {
    const { ui } = mount({ demoMode: true, username: null });
    expect(ui.getByRole("heading", { level: 2, name: "Demo" })).toBeTruthy();
    expect(ui.getByText("Sample data. Nothing you change here is saved.")).toBeTruthy();
  });
});

describe("Profile › Coach", () => {
  const openCoach = (props) => {
    const mounted = mount(props);
    fireEvent.click(mounted.ui.getByRole("button", { name: /^Coach/ }));
    expect(mounted.onView).toHaveBeenCalledWith("coach");
    return mounted;
  };

  it("holds the coach's preferences as a draft and saves them on Save", () => {
    const { ui, onSaveCoachPreferences } = openCoach();
    fireEvent.click(ui.getByRole("switch", { name: "Coach memory" }));
    fireEvent.click(within(ui.getByRole("radiogroup", { name: "Tone" })).getByRole("radio", { name: "Direct" }));
    fireEvent.click(within(ui.getByRole("radiogroup", { name: "Focus" })).getByRole("radio", { name: "Endurance" }));
    fireEvent.click(within(ui.getByRole("radiogroup", { name: "Intensity" })).getByRole("radio", { name: "Conservative" }));
    fireEvent.click(within(ui.getByRole("radiogroup", { name: "When in doubt" })).getByRole("radio", { name: "More rest" }));
    fireEvent.change(ui.getByLabelText("A note about you"), { target: { value: "Knee rehab" } });
    expect(onSaveCoachPreferences).not.toHaveBeenCalled();
    fireEvent.click(ui.getByRole("button", { name: "Save coach preferences" }));
    expect(onSaveCoachPreferences).toHaveBeenCalledWith({ enabled: true, tone: "direct", focus: "endurance", intensity: "conservative", restBias: "more-rest", note: "Knee rehab" });
  });

  it("puts the defaults back, and saves them, on Reset", () => {
    const { ui, onSaveCoachPreferences } = openCoach({ settings: { coachPreferences: { enabled: true, tone: "direct" } } });
    expect(within(ui.getByRole("radiogroup", { name: "Tone" })).getByRole("radio", { name: "Direct" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(ui.getByRole("button", { name: "Reset" }));
    expect(onSaveCoachPreferences).toHaveBeenCalledWith({ enabled: false, tone: "balanced", focus: "hybrid", intensity: "moderate", restBias: "balanced", note: "" });
    expect(ui.getByRole("switch", { name: "Coach memory" }).getAttribute("aria-checked")).toBe("false");
  });

  it("is where the clinician guardrails are set", () => {
    const { ui, onSaveCoachingSettings, showToast } = openCoach();
    fireEvent.click(ui.getByRole("button", { name: /Clinician guardrails/ }));
    fireEvent.click(ui.getByRole("switch", { name: "Enforce these rules" }));
    fireEvent.change(ui.getByLabelText("Stop rules"), { target: { value: "Stop on chest pain" } });
    fireEvent.click(ui.getByRole("button", { name: "Save guardrails" }));
    expect(onSaveCoachingSettings).toHaveBeenCalledTimes(1);
    expect(onSaveCoachingSettings.mock.calls[0][0].coachingSystem.clinicianGuardrails).toMatchObject({ enabled: true, stopRules: "Stop on chest pain" });
    expect(showToast).toHaveBeenCalledWith("Clinician guardrails saved");
  });
});

describe("Profile › Your data", () => {
  it("exports and imports with the app's own handlers", () => {
    const { ui, exportJSON, exportCSV, onPasteImport, fileRef } = mount({ start: "data" });
    fireEvent.click(ui.getByRole("button", { name: "Export full backup (JSON)" }));
    fireEvent.click(ui.getByRole("button", { name: "Export stats (CSV)" }));
    fireEvent.click(ui.getByRole("button", { name: "Import from a file (JSON)" }));
    fireEvent.click(ui.getByRole("button", { name: "Import from pasted text" }));
    expect(exportJSON).toHaveBeenCalledTimes(1);
    expect(exportCSV).toHaveBeenCalledTimes(1);
    expect(fileRef.current.click).toHaveBeenCalledTimes(1);
    expect(onPasteImport).toHaveBeenCalledTimes(1);
    expect(ui.getByText(/Erase-my-data controls are not included in this beta\./)).toBeTruthy();
  });
});

describe("Profile › Notifications", () => {
  it("says notifications are unavailable where the browser cannot send them", () => {
    const { ui } = mount({ start: "notifications" });
    expect(ui.getByRole("heading", { name: "Notifications are unavailable here" })).toBeTruthy();
    expect(ui.queryByRole("switch")).toBeNull();
  });
});
