// src/__tests__/nativeShell.test.js
// Inside the iPhone app the page is marked html.native-app, a swipe in from
// the left edge presses the screen's Back button, and the tabs' screens load
// shortly after launch. In a browser none of it happens.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installEdgeSwipeBack, prefetchScreens, startNativeShell, swipeBackTarget } from "../nativeShell";

function touch(type, x, y, target = document) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: y }] });
  target.dispatchEvent(event);
  return event;
}

function swipe(points) {
  const [first, ...rest] = points;
  touch("touchstart", first[0], first[1]);
  for (const [x, y] of rest) touch("touchmove", x, y);
  touch("touchend", 0, 0);
}

function backButton(parent = document.body) {
  const button = document.createElement("button");
  button.dataset.nav = "back";
  button.textContent = "Back";
  button.onclick = vi.fn();
  parent.appendChild(button);
  return button;
}

beforeEach(() => {
  // jsdom lays nothing out; an element counts as shown unless it is hidden.
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function rects() {
    return this.closest("[hidden]") ? [] : [{}];
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.Capacitor;
  document.body.innerHTML = "";
});

describe("startNativeShell", () => {
  it("does nothing in a browser", () => {
    const doc = document.implementation.createHTMLDocument("browser");
    const win = { setTimeout: vi.fn() };
    expect(startNativeShell({ doc, win })).toBe(false);
    expect(doc.documentElement.classList.contains("native-app")).toBe(false);
    expect(win.setTimeout).not.toHaveBeenCalled();
  });

  it("in the app, marks the page and loads the screens a moment after launch", () => {
    window.Capacitor = { isNativePlatform: () => true };
    const doc = document.implementation.createHTMLDocument("app");
    const win = { setTimeout: vi.fn() };
    expect(startNativeShell({ doc, win })).toBe(true);
    expect(doc.documentElement.classList.contains("native-app")).toBe(true);
    expect(win.setTimeout).toHaveBeenCalledWith(expect.any(Function), 1500);
  });
});

describe("prefetchScreens", () => {
  it("asks for every screen and shrugs off any that fail to load", async () => {
    const loaded = vi.fn(async () => ({}));
    const offline = vi.fn(async () => { throw new Error("offline"); });
    const broken = vi.fn(() => { throw new Error("broken"); });
    expect(() => prefetchScreens([loaded, offline, broken])).not.toThrow();
    await Promise.resolve();
    expect(loaded).toHaveBeenCalled();
    expect(offline).toHaveBeenCalled();
    expect(broken).toHaveBeenCalled();
  });
});

describe("swipeBackTarget", () => {
  it("is the screen's Back button", () => {
    const back = backButton();
    expect(swipeBackTarget()).toBe(back);
  });

  it("is nothing on a top-level screen", () => {
    expect(swipeBackTarget()).toBeNull();
  });

  it("skips a Back button that isn't on screen", () => {
    const hidden = document.createElement("div");
    hidden.hidden = true;
    document.body.appendChild(hidden);
    backButton(hidden);
    expect(swipeBackTarget()).toBeNull();
  });

  it("is nothing while a sheet is open", () => {
    backButton();
    document.body.insertAdjacentHTML("beforeend", '<section class="sheet"></section>');
    expect(swipeBackTarget()).toBeNull();
  });

  it("never reaches behind a full-screen flow", () => {
    backButton();
    const flow = document.createElement("div");
    flow.className = "flow-screen";
    document.body.appendChild(flow);
    expect(swipeBackTarget()).toBeNull();
    const inside = backButton(flow);
    expect(swipeBackTarget()).toBe(inside);
  });
});

describe("installEdgeSwipeBack", () => {
  let remove;
  beforeEach(() => { remove = installEdgeSwipeBack(document); });
  afterEach(() => remove());

  it("goes back after a swipe in from the left edge", () => {
    const back = backButton();
    swipe([[4, 300], [30, 302], [90, 305]]);
    expect(back.onclick).toHaveBeenCalledTimes(1);
  });

  it("shows an arrow while the finger moves and removes it after", () => {
    backButton();
    touch("touchstart", 4, 300);
    touch("touchmove", 60, 300);
    expect(document.querySelector("[data-edge-back]")).not.toBeNull();
    touch("touchend", 0, 0);
    expect(document.querySelector("[data-edge-back]")).toBeNull();
  });

  it("stays put when the swipe is let go early", () => {
    const back = backButton();
    swipe([[4, 300], [30, 300], [50, 300]]);
    expect(back.onclick).not.toHaveBeenCalled();
  });

  it("ignores a swipe that starts away from the edge", () => {
    const back = backButton();
    swipe([[60, 300], [140, 300], [200, 300]]);
    expect(back.onclick).not.toHaveBeenCalled();
  });

  it("leaves a scroll that starts at the edge alone", () => {
    const back = backButton();
    swipe([[4, 300], [10, 260], [90, 200]]);
    expect(back.onclick).not.toHaveBeenCalled();
    expect(document.querySelector("[data-edge-back]")).toBeNull();
  });
});
