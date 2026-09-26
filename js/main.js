import {
  loadVideosFromFirestore,
  getCurrentVideo,
  getFeedMode,
  setFeedMode,
} from "../vid.js";
import { store, publishIdentity } from "./store.js";
import { makeToast } from "./lib/dom.js";

/* js/main.js — isolated bootstrap. Each feature loads via dynamic
 * import() with its own try/catch so one broken feature never takes
 * down the whole feed (micro-frontend style fault isolation). */

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
  "mute",
  "share",
  "chrome",
  "nav",
  "progress",
];

function report(feature, err) {
  console.warn("[shortxx] feature failed: " + feature, err);
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

  // 1. Load videos first — feed is useless without data
  try {
    await loadVideosFromFirestore();
  } catch (e) {
    report("videos", e);
  }
  publishIdentity();

  // 2. Load each feature in dependency order, isolated
  for (const name of FEATURES) {
    try {
      const mod = await import("./features/" + name + ".js");
      if (mod && typeof mod.init === "function") {
        await mod.init(ctx);
      }
    } catch (e) {
      report(name, e);
      try {
        toast("Feature unavailable: " + name);
      } catch (err) {}
    }
  }

  // Keep feed mode import referenced (deep links above use it)
  void getFeedMode;
});
