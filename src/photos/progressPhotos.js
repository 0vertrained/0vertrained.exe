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

// Only the account-aware bridge methods may touch the album. Previously
// installed iPhone builds expose unscoped list/read/remove methods.
const upgradeMessage = "Rebuild or update the iPhone app to open your private photo album.";
async function albumCall(owner, method, args = {}) {
  if (!owner) throw new Error("Open your athlete profile to use progress photos.");
  const bridge = plugin();
  try {
    if (!bridge || typeof bridge[method] !== "function") throw new Error(upgradeMessage);
    return await bridge[method]({ owner, ...args });
  } catch (error) {
    if (error?.code === "UNIMPLEMENTED" || /not implemented/i.test(error?.message || "")) throw new Error(upgradeMessage, { cause: error });
    throw error;
  }
}

export async function listPhotos(owner) {
  const result = await albumCall(owner, "albumList");
  if (result?.version !== 2 || !Array.isArray(result.photos)) throw new Error(upgradeMessage);
  return { photos: result.photos, hasLegacy: result.hasLegacy === true };
}

export function importLegacyPhotos(owner) {
  return albumCall(owner, "importLegacyAlbum");
}

export async function photoSource(owner, id, size = "thumb") {
  const result = await albumCall(owner, "albumRead", { id, size });
  return result?.data ? `data:image/jpeg;base64,${result.data}` : null;
}

export function removePhoto(owner, id) {
  return albumCall(owner, "albumRemove", { id });
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
export async function savePhoto(owner, file, { date, pose = "front" }) {
  const image = await loadImage(file);
  const full = jpeg(image, FULL_EDGE, 0.85);
  const thumb = jpeg(image, THUMB_EDGE, 0.8);
  return albumCall(owner, "albumSave", { id: newId(date, pose), date, pose, full, thumb });
}
