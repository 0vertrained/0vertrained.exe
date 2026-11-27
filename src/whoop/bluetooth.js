import { useSyncExternalStore } from "react";
import { nativePlugin } from "../native";

let selected = null;
let bridge = null;
let lastBinding = Promise.resolve();
const observers = new Set();

function notify() {
  for (const observer of observers) observer();
}

function watchBinding(observer) {
  observers.add(observer);
  return () => observers.delete(observer);
}

export function getWhoopBluetooth() { return bridge; }

export function useWhoopBluetooth() {
  return useSyncExternalStore(watchBinding, getWhoopBluetooth, () => null);
}

function accountBridge(binding) {
  const { plugin, owner } = binding;
  const result = { owner };
  for (const method of ["getState", "scan", "stopScan", "connect", "disconnect", "startHistorySync", "readHistory"]) {
    if (typeof plugin[method] !== "function") continue;
    result[method] = async options => {
      if (selected !== binding) throw new Error("The strap account changed.");
      const next = await plugin[method]({ ...options, owner });
      if (selected !== binding || next?.owner !== owner) throw new Error("The strap account changed.");
      return next;
    };
  }
  result.addListener = (name, callback) => plugin.addListener(name, value => {
    if (selected === binding && value?.owner === owner) callback(value);
  });
  return result;
}

// Called from the auth transition, before React can render the next athlete.
// Invalidate old callbacks immediately, then serialize native changes: a late
// sign-out must never clear a strap that the next account just paired.
export function setWhoopBluetoothOwner(owner) {
  const plugin = import.meta.env.VITE_DEMO_MODE === "true" ? null : nativePlugin("WhoopBluetooth");
  if (!plugin || typeof plugin.setOwner !== "function") {
    selected = null;
    if (bridge) { bridge = null; notify(); }
    return Promise.resolve(null);
  }
  if (selected?.plugin === plugin && selected?.owner === owner) return selected.ready;
  const binding = { plugin, owner: owner || null };
  selected = binding;
  bridge = null;
  notify();
  binding.ready = lastBinding.then(async () => {
    await plugin.setOwner({ owner: binding.owner });
    if (selected === binding && binding.owner) {
      bridge = accountBridge(binding);
      notify();
      return bridge;
    }
    return null;
  }).catch(() => {
    if (selected === binding) selected = null;
    return null;
  });
  lastBinding = binding.ready;
  return binding.ready;
}

// Reading state is passive. Only an athlete action in Settings starts a scan
// or connection. Each subscriber owns its listeners, never the sensor itself.
export function subscribeWhoopBluetooth({ onState, onSample, onError } = {}) {
  const plugin = getWhoopBluetooth();
  if (!plugin) return () => {};

  let active = true;
  let receivedState = false;
  const handles = [];
  const remove = handle => Promise.resolve(handle.remove()).catch(() => {});

  async function listen(event, callback) {
    const handle = await plugin.addListener(event, value => {
      if (active) callback(value);
    });
    if (active) handles.push(handle);
    else await remove(handle);
  }

  async function start() {
    await Promise.all([
      onState && listen("state", state => {
        receivedState = true;
        onState(state);
      }),
      onSample && listen("sample", onSample),
    ]);
    if (active && onState && !receivedState) {
      const current = await plugin.getState();
      if (active && !receivedState) onState(current);
    }
  }
  start().catch(error => { if (active) onError?.(error); });

  return () => {
    active = false;
    for (const handle of handles) remove(handle);
    handles.length = 0;
  };
}
