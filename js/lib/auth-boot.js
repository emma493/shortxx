import { store } from "../store.js";
import { makeToast } from "./dom.js";
import { init as initAuth } from "../features/auth.js";
import { init as initTelemetry } from "../features/telemetry.js";

/* js/lib/auth-boot.js — minimal auth+telemetry boot for standalone pages
 * (discover, trending, creators, liked, saved, creator). These pages load
 * js/pages/*.js instead of js/main.js, so without this the shared modal,
 * login/logout buttons and Users-tab presence would be dead off the feed. */

let booted = false;

export async function bootAuth() {
  if (booted) return;
  booted = true;
  try {
    const toast = makeToast();
    const ctx = { toast, getCurrentVideo: () => null, store };
    try {
      await initAuth(ctx);
    } catch (e) {
      console.warn("[shortxx] auth boot failed:", e);
    }
    try {
      await initTelemetry(ctx);
    } catch (e) {
      console.warn("[shortxx] telemetry boot failed:", e);
    }
  } catch (e) {}
}
