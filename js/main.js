import {
  loadVideosFromFirestore,
  getCurrentVideo,
  getFeedMode,
  setFeedMode,
  didVideosLoad,
  getLastLoadError,
  getVideoCount,
} from "../vid.js";
import { store, publishIdentity } from "./store.js";
import { makeToast } from "./lib/dom.js";
// Critical path is static (like the old single-script app): player + swipe
// wire FIRST and play even if every other feature stalls below.
import { init as initPlayer } from "./features/player.js";
import { init as initSwipe } from "./features/swipe.js";

/* js/main.js — isolated bootstrap. Player + swipe (the critical path) are
 * static imports wired FIRST so video plays even on a bad network; every
 * other feature loads via dynamic import() IN PARALLEL with its own
 * timeout + try/catch, so one slow CDN or broken feature never blocks
 * the rest. */

const FEATURES = [
  "ads",
  "creator",
  "creator-page",
  "guide",
  "prefs",
  "auth",
  "telemetry",
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
  "video-title",
  "chrome",
  "nav",
  "progress",
];

// Slow networks must not serialize-block the UI: cap each feature.
const FEATURE_TIMEOUT_MS = 30000;

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

  // 0. PWA shortcut deep links (?feed=...) — same behavior as before split.
  // Declared outside try: read again after features boot below.
  let wantsPrefs = false;
  try {
    const params = new URLSearchParams(location.search);
    const deepFeed = params.get("feed");
    const deepPrefs = params.get("prefs");
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
    // Side-menu Preferences from folder pages (?prefs=1): strip the param
    // now, open the popup after features boot below.
    if (deepPrefs === "1") {
      wantsPrefs = true;
      try {
        const u = new URL(location.href);
        u.searchParams.delete("prefs");
        history.replaceState(null, "", u.pathname + u.search + u.hash);
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
  // Manual retry (feed button / error UI): reload pool, rebuild on success.
  window.sxRetryVideos = async () => {
    try {
      await loadVideosFromFirestore();
    } catch (e) {
      report("videos-retry", e);
    }
    videosReady();
  };
  // Surface load failures in plain language instead of a silent black feed.
  window.addEventListener("sx:videos-error", (ev) => {
    try {
      const msg = String((ev && ev.detail && ev.detail.message) || "");
      if (/permission|denied/i.test(msg)) {
        toast("Database blocked access — check Firestore rules");
      } else if (/unavailable|network|failed to get|failed to fetch|timeout/i.test(msg)) {
        toast("Can't reach database — check connection or adblocker");
      } else {
        toast("Video load failed — reopen the app to retry");
      }
    } catch (e) {}
  });
  // Safety net: if the network hangs, retry once instead of stranding the
  // feed. Late success self-heals via sx:videos-ready (swipe rebuilds).
  setTimeout(async () => {
    try {
      if (didVideosLoad() && getVideoCount() > 0) return;
      const err = getLastLoadError();
      if (!didVideosLoad() || (err && getVideoCount() === 0)) {
        toast("Still connecting to database…");
        await window.sxRetryVideos();
      }
    } catch (e) {}
  }, 12000);

  // 2. Critical path FIRST: player + swipe wire synchronously so video
  // plays even if the parallel fan-out below stalls (slow CDN/radio).
  try {
    await initPlayer(ctx);
  } catch (e) {
    report("player", e);
  }
  try {
    await initSwipe();
  } catch (e) {
    report("swipe", e);
  }

  // 3. Load ALL remaining features in parallel — order-independent by design
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
  if (wantsPrefs) {
    try {
      if (window.sxOpenPrefs) window.sxOpenPrefs(true);
    } catch (e) {}
  }
  await load;

  // Keep feed mode import referenced (deep links above use it)
  void getFeedMode;
});
