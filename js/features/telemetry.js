import {
  authProviderLabel,
  upsertUserTelemetry,
  incrementUserCounters,
  markUserOffline,
  resolveCountry,
} from "../../vid.js";
import { store, publishIdentity } from "../store.js";

/* js/features/telemetry.js — Users-tab presence + engagement counters.
 *
 * AUTHED USERS ONLY (per product decision): guests stay local-only and no
 * `guest_*` docs are ever written. Every export below no-ops when there is
 * no signed-in, non-anonymous Firebase user.
 *
 * Listens to `sx:auth-changed` (dispatched by js/features/auth.js) so
 * sign-in/out flips writes immediately. */

const HEARTBEAT_MS = 25000;

let uid = null;
let heartbeat = null;

function authedUid() {
  const u = store.authUser;
  return u && !u.isAnonymous && u.uid ? u.uid : null;
}

export function getTelemetryUid() {
  return uid;
}

/* (Re)publish identity and — when authed — upsert the users/{uid} presence
 * doc. On uid change the previous doc is marked offline first. */
export async function refreshTelemetry() {
  const next = authedUid();
  const prev = uid;
  uid = next;
  publishIdentity();
  if (prev && prev !== next) {
    try {
      await markUserOffline(prev);
    } catch (e) {}
  }
  if (!uid) return;
  try {
    const geo = await resolveCountry();
    window.shortxxCountry = geo.code;
  } catch (e) {}
  upsertUserTelemetry(uid, { authProvider: authProviderLabel(store.authUser) });
}

async function goOffline() {
  if (!uid) return;
  try {
    await markUserOffline(uid);
  } catch (e) {}
}

/* Engagement counters — each silently ignored for signed-out guests. */
export function countSave(delta) {
  const id = authedUid();
  if (!id || !delta) return;
  incrementUserCounters(id, { saveDelta: delta });
}

export function countDownload() {
  const id = authedUid();
  if (!id) return;
  incrementUserCounters(id, { downloadDelta: 1 });
}

export function noteWatch(seconds) {
  const id = authedUid();
  if (!id || !seconds) return;
  incrementUserCounters(id, { watchSeconds: seconds });
}

export function noteComplete() {
  const id = authedUid();
  if (!id) return;
  incrementUserCounters(id, { completed: true });
}

export async function init() {
  window.addEventListener("sx:auth-changed", refreshTelemetry);
  window.addEventListener("pagehide", goOffline);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") goOffline();
    else refreshTelemetry();
  });
  if (!heartbeat) {
    heartbeat = setInterval(() => {
      const id = authedUid();
      if (!id) return;
      uid = id;
      upsertUserTelemetry(id, { authProvider: authProviderLabel(store.authUser) });
    }, HEARTBEAT_MS);
  }
  await refreshTelemetry();
}
