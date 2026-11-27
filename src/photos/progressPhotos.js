// src/photos/progressPhotos.js
// Progress photos in the iPhone app, kept on the phone only
// (ios/App/App/PhotosPlugin.swift): never uploaded, never in the synced
// log. A photo is chosen or taken with the system picker, shrunk here to a
// full size and a thumbnail, and handed to the phone to keep.

import { nativePlugin } from "../native";

export const POSES = [
  { value: "front", label: "Front" },
  { value: "side", label: "Side" },
  { value: "back", label: "Back" },
];
const FULL_EDGE = 1600;
const THUMB_EDGE = 360;

const plugin = () => nativePlugin("OTPhotos");

/** This app build keeps progress photos. */
export function hasProgressPhotos() {
  return Boolean(plugin());
}

/** [{ id, date, pose }], oldest first. */
export async function listPhotos() {
  const result = await plugin()?.list();
  return Array.isArray(result?.photos) ? result.photos : [];
}

const shown = new Map();

/** A photo as a data URL to show: "thumb" or "full". */
export async function photoSource(id, size = "thumb") {
  const key = `${id}|${size}`;
  if (shown.has(key)) return shown.get(key);
  const result = await plugin()?.read({ id, size });
  if (!result?.data) return null;
  const source = `data:image/jpeg;base64,${result.data}`;
  if (size === "thumb") shown.set(key, source);
  return source;
}

export async function removePhoto(id) {
  shown.delete(`${id}|thumb`);
  await plugin()?.remove({ id });
}

/** The longer edge brought down to `edge`, the shape kept. */
export function fitWithin(width, height, edge) {
  const scale = Math.min(1, edge / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't a photo this phone can read.")); };
    image.src = url;
  });
}

function jpeg(image, edge, quality) {
  const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight, edge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality).replace(/^data:image\/jpeg;base64,/, "");
}

function newId(date, pose) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${date}-${pose}-${random}`.replace(/[^A-Za-z0-9-]/g, "");
}

/** Shrinks a chosen photo and keeps it on the phone. Resolves { id, date, pose }. */
export async function savePhoto(file, { date, pose = "front" }) {
  const image = await loadImage(file);
  const full = jpeg(image, FULL_EDGE, 0.85);
  const thumb = jpeg(image, THUMB_EDGE, 0.8);
  return plugin()?.save({ id: newId(date, pose), date, pose, full, thumb });
}
