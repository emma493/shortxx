import { publishIdentity } from "../store.js";

/* js/features/telemetry.js — guest-only stub.
 * No signed-in users exist, so presence/counters are no-ops.
 * Kept as a module so player.js (noteWatch/noteComplete) and share.js
 * (countDownload) imports never break. */

export function getTelemetryUid() {
  return null;
}

export async function refreshTelemetry() {
  try { publishIdentity(); } catch (e) {}
}

export function countSave() {}
export function countDownload() {}
export function noteWatch() {}
export function noteComplete() {}

export async function init() {
  await refreshTelemetry();
}
