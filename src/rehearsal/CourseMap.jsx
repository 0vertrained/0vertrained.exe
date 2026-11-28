import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./courseMap.css";

const EMPTY = [];
const coordinate = latlng => ({ lat: latlng.lat, lon: latlng.wrap().lng });
const latLng = point => [point.lat, point.lon];
const samePoint = (a, b) => a?.lat === b?.lat && a?.lon === b?.lon;
const valid = p => Number.isFinite(p?.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180;

function frameCourse(map, points) {
  const coords = points.filter(valid).map(latLng);
  if (!coords.length) return;
  if (coords.length === 1) map.setView(coords[0], 15, { animate: false });
  else map.fitBounds(coords, { padding: [30, 30], maxZoom: 17, animate: false });
}

// Measure proximity in screen pixels; a trail switchback must be picked as
// it appears at the current zoom. Keep original indices for imported tracks.
function nearestCourse(map, points, tap) {
  let nearest = null;
  let best = 32;
  for (let i = 0; i < points.length; i++) {
    if (!valid(points[i])) continue;
    const end = map.latLngToLayerPoint(latLng(points[i]));
    if (!i || !valid(points[i - 1])) {
      const distance = end.distanceTo(tap);
      if (distance <= best) { nearest = { index: i }; best = distance; }
      continue;
    }
    const start = map.latLngToLayerPoint(latLng(points[i - 1]));
    const snapped = L.LineUtil.closestPointOnSegment(tap, start, end);
    const distance = snapped.distanceTo(tap);
    if (distance > best) continue;
    const d1 = start.distanceTo(snapped), d2 = end.distanceTo(snapped);
    nearest = { index: d1 < d2 ? i - 1 : i };
    if (Math.min(d1, d2) > 12) nearest.insert = { index: i, point: coordinate(map.layerPointToLatLng(snapped)) };
    best = distance;
  }
  return nearest;
}

function tooltip(text) {
  const el = document.createElement("span");
  el.textContent = text;
  return el;
}

export function CourseMap({ points = EMPTY, checkpoints = EMPTY, mode = "pan", onAddPoint, onPickPoint,
  onMovePoint, onInsertCheckpointPoint, readOnly = false }) {
  const element = useRef(null);
  const mapRef = useRef(null);
  const tiles = useRef(null);
  const initial = useRef(points);
  const previous = useRef(points);
  const locationMarker = useRef(null);
  const actions = useRef({});
  const canDrag = Boolean(onMovePoint);
  useEffect(() => {
    actions.current = { onMovePoint, onAddPoint, onPickPoint, onInsertCheckpointPoint };
  }, [onMovePoint, onAddPoint, onPickPoint, onInsertCheckpointPoint]);
  const [notice, setNotice] = useState("");
  const [tileError, setTileError] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    const map = L.map(element.current, { minZoom: 2, maxZoom: 19, zoomControl: true,
      doubleClickZoom: false, scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false });
    mapRef.current = map;
    if (initial.current.some(valid)) frameCourse(map, initial.current);
    else map.setView([25, 0], 2);
    map.attributionControl.setPrefix(false);
    const layer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
      referrerPolicy: "strict-origin-when-cross-origin", maxZoom: 19, noWrap: true,
      updateWhenIdle: true, updateWhenZooming: false,
    });
    let failed = false;
    layer.on("loading", () => { failed = false; });
    layer.on("tileerror", () => { failed = true; setTileError(true); });
    layer.on("load", () => setTileError(failed));
    layer.addTo(map);
    tiles.current = layer;
    L.control.scale({ maxWidth: 78, position: "bottomleft" }).addTo(map);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => map.invalidateSize()) : null;
    observer?.observe(element.current);
    return () => {
      observer?.disconnect();
      mapRef.current = null;
      tiles.current = null;
      locationMarker.current = null;
      layer.off();
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const old = previous.current;
    // A file import or selection of another course replaces the geometry.
    // Ordinary taps, drags and undo keep the athlete's current viewport.
    const replaced = Math.abs(old.length - points.length) > 1 ||
      (old.length > 1 && points.length > 1 && !samePoint(old[0], points[0]) && !samePoint(old.at(-1), points.at(-1))) ||
      (points.length === 1 && valid(points[0]) && (map.getZoom() < 10 || !map.getBounds().contains(latLng(points[0]))));
    if (replaced) frameCourse(map, points);
    previous.current = points;
  }, [points]);

  useEffect(() => {
    const map = mapRef.current;
    const group = L.layerGroup().addTo(map);
    const coords = points.filter(valid).map(latLng);
    if (coords.length > 1) {
      L.polyline(coords, { color: "#fff", weight: 8, opacity: 0.95, interactive: false }).addTo(group);
      L.polyline(coords, { color: "#0b5174", weight: 4.5, opacity: 1, interactive: false }).addTo(group);
    }
    const handles = L.layerGroup().addTo(group);
    const checkpointAt = new Map();
    for (const checkpoint of checkpoints) {
      const list = checkpointAt.get(checkpoint.pointIndex) || [];
      list.push(checkpoint);
      checkpointAt.set(checkpoint.pointIndex, list);
    }
    const edit = !readOnly && mode === "draw";
    const place = !readOnly && mode === "checkpoint";
    function showHandles() {
      handles.clearLayers();
      const cells = new Set();
      const bounds = map.getBounds().pad(0.1);
      points.forEach((point, i) => {
        if (!valid(point)) return;
        const checkpointsHere = checkpointAt.get(i);
        const endpoint = i === 0 || i === points.length - 1;
        if (!endpoint && !checkpointsHere) {
          if (!edit && !place) return;
          if (points.length > 80) {
            if (!bounds.contains(latLng(point))) return;
            const pixel = map.latLngToLayerPoint(latLng(point));
            const cell = Math.floor(pixel.x / 36) + ":" + Math.floor(pixel.y / 36);
            if (cells.has(cell)) return;
            cells.add(cell);
          }
        }
        const symbol = checkpointsHere ? "◆" : i === 0 ? "S" : endpoint ? "F" : "";
        const title = checkpointsHere?.map(c => c.name || c.kind || "Checkpoint").join(" · ") ||
          (endpoint ? (i === 0 ? "Start" : "Finish") : "Waypoint " + (i + 1));
        const icon = L.divIcon({ html: symbol, className: "course-map-pin " + (checkpointsHere ? "checkpoint" : endpoint ? "endpoint" : "waypoint"),
          iconSize: [26, 26], iconAnchor: [13, 13] });
        const marker = L.marker(latLng(point), { icon, title, draggable: edit && canDrag,
          keyboard: place || Boolean(checkpointsHere) || (edit && i === 0), zIndexOffset: checkpointsHere ? 300 : endpoint ? 200 : 0,
          bubblingMouseEvents: false }).addTo(handles);
        marker.getElement()?.setAttribute("aria-label", title);
        marker.bindTooltip(tooltip(title), { direction: "top", offset: [0, -9] });
        marker.on("dragend", () => {
          const moved = coordinate(marker.getLatLng());
          marker.setLatLng(latLng(point));
          actions.current.onMovePoint?.(i, moved);
        });
        marker.on("click", () => {
          setNotice("");
          if (place) actions.current.onPickPoint?.(i);
          else if (edit && i === 0 && points.length > 2 &&
              (point.lat !== points.at(-1)?.lat || point.lon !== points.at(-1)?.lon)) actions.current.onAddPoint?.({ lat: point.lat, lon: point.lon });
        });
      });
    }
    function onTap(event) {
      if (edit) {
        const point = coordinate(event.latlng);
        if (Math.abs(point.lat) > 85) { setNotice("Choose a point within the map."); return; }
        setNotice("");
        if (!samePoint(point, points.at(-1))) actions.current.onAddPoint?.(point);
      }
      else if (place) {
        const closest = nearestCourse(map, points, event.layerPoint);
        if (!closest) { setNotice("Tap on the course line to place a checkpoint."); return; }
        setNotice("");
        if (closest.insert && actions.current.onInsertCheckpointPoint) actions.current.onInsertCheckpointPoint(closest.insert.index, closest.insert.point);
        else actions.current.onPickPoint?.(closest.index);
      }
    }
    showHandles();
    if (!readOnly && points.length > 80) map.on("moveend", showHandles);
    map.on("click", onTap);
    return () => { map.off("click", onTap); map.off("moveend", showHandles); group.remove(); };
  }, [points, checkpoints, mode, readOnly, canDrag]);

  function locate() {
    const map = mapRef.current;
    if (!navigator.geolocation) { setNotice("Location is unavailable. Pan and zoom to your course."); return; }
    setLocating(true);
    setNotice("");
    navigator.geolocation.getCurrentPosition(position => {
      if (mapRef.current !== map) return;
      const here = [position.coords.latitude, position.coords.longitude];
      map.setView(here, 15, { animate: false });
      locationMarker.current?.remove();
      locationMarker.current = L.circleMarker(here, { radius: 7, color: "#fff", weight: 3, fillColor: "#1677cd",
        fillOpacity: 1, interactive: false }).addTo(map);
      setLocating(false);
    }, () => {
      if (mapRef.current !== map) return;
      setLocating(false);
      setNotice("Location is unavailable. Pan and zoom to your course.");
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }

  return <div className="course-map">
    <div ref={element} className="course-map-view" data-mode={readOnly ? "pan" : mode} role="region" aria-label="Race course map" />
    <div className="course-map-controls">
      <button type="button" className="btn btn-s btn-sm" onClick={locate} disabled={locating}>{locating ? "Locating…" : "Find my location"}</button>
      {points.length > 0 && <button type="button" className="btn btn-s btn-sm" onClick={() => frameCourse(mapRef.current, points)}>Fit course</button>}
    </div>
    {tileError && <p className="t-s c2" role="status">Map tiles unavailable. <button type="button" className="btn btn-g btn-sm" onClick={() => tiles.current?.redraw()}>Retry map tiles</button></p>}
    {notice && <p className="t-s c2" role="status">{notice}</p>}
  </div>;
}

export default CourseMap;
