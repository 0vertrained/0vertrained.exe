import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import L from "leaflet";
import { CourseMap } from "../rehearsal/CourseMap";

const points = [{ lat: 40.71, lon: -74.01 }, { lat: 40.71, lon: -74.00 }, { lat: 40.71, lon: -73.99 }];
const originalSvg = L.Browser.svg;
beforeEach(() => {
  // jsdom implements the SVG nodes that Leaflet uses without the legacy SVG feature-test method.
  L.Browser.svg = true;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(520);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(350);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); L.Browser.svg = originalSvg; });

function mount(props) {
  const mapFactory = vi.spyOn(L, "map");
  const view = render(<CourseMap {...props} />);
  return { ...view, map: mapFactory.mock.results[0].value };
}

function tap(map, lat, lon) {
  const latlng = L.latLng(lat, lon);
  act(() => { map.fire("click", { latlng, layerPoint: map.latLngToLayerPoint(latlng) }); });
}

describe("race rehearsal course map", () => {
  it("uses attributed tiles with origin referrers and draws locations only in edit mode", () => {
    const add = vi.fn();
    const geo = vi.fn();
    vi.stubGlobal("navigator", Object.create(navigator, { geolocation: { value: { getCurrentPosition: geo } } }));
    const { map, rerender } = mount({ points, mode: "draw", onAddPoint: add });
    expect(screen.getByRole("link", { name: /OpenStreetMap contributors/ }).href).toMatch(/copyright/);
    expect(document.querySelector(".leaflet-tile").referrerPolicy).toBe("strict-origin-when-cross-origin");
    tap(map, 40.715, -74.005);
    expect(add.mock.calls[0][0].lat).toBe(40.715);
    expect(add.mock.calls[0][0].lon).toBeCloseTo(-74.005);
    expect(geo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Find my location" }));
    act(() => { geo.mock.calls[0][1]({ code: 1 }); });
    expect(screen.getByText(/Location is unavailable/)).toBeTruthy();
    rerender(<CourseMap points={points} mode="draw" onAddPoint={add} readOnly />);
    tap(map, 40.72, -74);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("snaps a checkpoint to a route segment or an existing point, renders names as text, and preserves its outline on tile errors", () => {
    const insert = vi.fn(), pick = vi.fn();
    const checkpoints = [{ id: "aid", pointIndex: 1, name: "<b>Water</b>", kind: "aid" }];
    const { map, rerender } = mount({ points, checkpoints, mode: "checkpoint", onPickPoint: pick, onInsertCheckpointPoint: insert });
    const marker = screen.getByRole("button", { name: "<b>Water</b>" });
    fireEvent.click(marker);
    expect(pick).toHaveBeenCalledWith(1);
    tap(map, 40.7101, -74.005);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toBe(1);
    expect(insert.mock.calls[0][1].lat).toBeCloseTo(40.71, 3);
    expect(insert.mock.calls[0][1].lon).toBeCloseTo(-74.005, 3);
    rerender(<CourseMap points={points} mode="checkpoint" onPickPoint={pick} />);
    tap(map, 40.71, -74.006);
    expect(pick).toHaveBeenLastCalledWith(0);
    tap(map, 40.82, -74.085);
    expect(screen.getByText(/Tap on the course line/)).toBeTruthy();
    act(() => { map.eachLayer(layer => { if (layer instanceof L.TileLayer) layer.fire("tileerror"); }); });
    expect(screen.getByRole("button", { name: "Retry map tiles" })).toBeTruthy();
    expect(document.querySelectorAll(".leaflet-overlay-pane path").length).toBeGreaterThan(0);
  });

  it("moves the correct waypoint and supports closing a circuit at the start", () => {
    const move = vi.fn(), add = vi.fn();
    const { map } = mount({ points, mode: "draw", onMovePoint: move, onAddPoint: add });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(add).toHaveBeenCalledWith(points[0]);
    act(() => {
      map.eachLayer(layer => {
        if (layer instanceof L.Marker && layer.options.title === "Waypoint 2") {
          layer.setLatLng([40.711, -74.002]); layer.fire("dragend");
        }
      });
    });
    expect(move.mock.calls[0][0]).toBe(1);
    expect(move.mock.calls[0][1].lat).toBeCloseTo(40.711);
  });
});
