import {
  loadVideosFromFirestore,
  getCurrentVideo,
  getFeedMode,
  setFeedMode,
} from "../vid.js";
import { store, publishIdentity } from "./store.js";
import { makeToast } from "./lib/dom.js";

/* js/main.js — isolated bootstrap. Each feature loads via dynamic
 * import() IN PARALLEL with its own timeout + try/catch, so one slow
 * CDN (e.g. firebase-auth) or broken feature never blocks the rest —
 * every button wires up even on a bad network. */

const FEATURES = [
  "player",
  "creator",
  "creator-page",
  "auth",
  "likes",
  "follow",
  "save",
  "comments",
  "discover",
  "menu",
  "feed",
  "trending",
  "mute",
  "share",
  "chrome",
  "nav",
  "progress",
];

// Slow networks must not serialize-block the UI: cap each feature.
const FEATURE_TIMEOUT_MS = 10000;

function report(feature, err) {
  console.warn("[shortxx] feature failed: " + feature, err);
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout: " + label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const toast = makeToast();
  const ctx = { toast, getCurrentVideo, store };

  // 0. PWA shortcut deep links (?feed=...) — same behavior as before split
  try {
    const deepFeed = new URLSearchParams(location.search).get("feed");
    if (deepFeed === "foryou" || deepFeed === "trending") {
      setFeedMode(deepFeed === "trending" ? "top" : "foryou");
      const u = new URL(location.href);
      u.searchParams.delete("feed");
      location.href = u.toString();
      return;
    }
    if (deepFeed === "live") {
      location.href =
        "https://go.whitetrafsa.com?userId=dd571e000ae6f07ef31fa3fb50db3d7353ab3ba1c6c501e61a894d69b80e96ae";
      return;
    }
    if (deepFeed === "saved") {
      window.__sxPendingSavedOverlay = true;
      try {
        history.replaceState(null, "", location.pathname);
      } catch (e) {}
    }
  } catch (e) {
    report("deeplink", e);
  }

  // 1. Wire up the UI FIRST so every button is clickable instantly,
  // then fill in the videos in the background.
  publishIdentity();

  const videosReady = () => window.dispatchEvent(new CustomEvent("sx:videos-ready"));
  const load = (async () => {
    try {
      await loadVideosFromFirestore();
    } catch (e) {
      report("videos", e);
    }
    videosReady();
  })();
  // Safety net: if the network hangs, unblock the player attempt anyway.
  setTimeout(videosReady, 12000);

  // 2. Load ALL features in parallel — order-independent by design
  // (they sync via store + sx:* window events, never direct imports).
  const results = await Promise.allSettled(
    FEATURES.map(async (name) => {
      const mod = await withTimeout(
        import("./features/" + name + ".js"),
        FEATURE_TIMEOUT_MS,
        name,
      );
      if (mod && typeof mod.init === "function") {
        await withTimeout(Promise.resolve().then(() => mod.init(ctx)), FEATURE_TIMEOUT_MS, name + ":init");
      }
    }),
  );
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      report(FEATURES[i], r.reason);
      try {
        toast("Feature unavailable: " + FEATURES[i]);
      } catch (err) {}
    }
  });
  await load;

  // Keep feed mode import referenced (deep links above use it)
  void getFeedMode;
});
