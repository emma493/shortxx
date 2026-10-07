/* js/features/ads.js — banner refresh controller for the no-reload feed.
 *
 * The old index<->vid2 page-flip re-ran every ad script per video. The swipe
 * feed never reloads, so without this each banner would earn exactly one
 * impression per session. This module replays each ad CODE individually on a
 * dual trigger:
 *   - EVERY video change (publisher directive 2026-10-07: max volume), OR
 *   - every 60 s of continuous playing-and-visible watch time (covers users
 *     who sit on one video),
 * with a 10 s global floor between batches (anti-overlap: swipe-spam cannot
 * stack batches). NOTE: aggressive auto-refresh elevates invalid-traffic
 * flag risk with the ad network — watch its dashboard for warnings.
 *
 * Serialized queue: all banner slots share the global `atOptions`, so slots
 * re-inject strictly one at a time — never overlapping, never mixed keys.
 * Social Bar / pop / tab-guard scripts are NEVER touched (persistent formats).
 * First impression always comes from the static index.html markup. */

const VIDEOS_PER_BATCH = 1;
const WATCH_SECONDS_PER_BATCH = 60;
const MIN_BATCH_GAP_MS = 10000;
const TICK_MS = 5000;

let slots = [];
let queue = Promise.resolve();
let videosSinceBatch = 0;
let watchAccum = 0;
let lastBatchAt = 0;
let batches = 0;
let lastTime = -1;
// Recent batch log for verification (window.sxAdsStats): last 30 entries.
let batchLog = [];

function collectSlots() {
  const found = [];
  try {
    document.querySelectorAll("[data-ad-slot]").forEach((el) => {
      const type = el.getAttribute("data-ad-type") || "atoptions";
      if (type === "container") {
        const src = el.getAttribute("data-ad-src") || "";
        const container = el.getAttribute("data-ad-container") || "";
        if (!src || !container) return;
        found.push({ el, type, src, container, async: el.getAttribute("data-ad-async") === "1" });
      } else {
        const key = el.getAttribute("data-ad-key") || "";
        const host = el.getAttribute("data-ad-host") || "https://www.highperformanceformat.com";
        const w = parseInt(el.getAttribute("data-ad-w") || "0", 10) || 0;
        const h = parseInt(el.getAttribute("data-ad-h") || "0", 10) || 0;
        if (!key) return;
        found.push({ el, type: "atoptions", key, host, w, h });
      }
    });
  } catch (e) {}
  return found;
}

function injectScript(container, src, isAsync) {
  return new Promise((resolve) => {
    try {
      const s = document.createElement("script");
      s.type = "text/javascript";
      if (isAsync) s.async = true;
      try { s.setAttribute("data-cfasync", "false"); } catch (e) {}
      s.src = src;
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      s.onload = () => setTimeout(finish, 250);
      s.onerror = finish;
      setTimeout(finish, 8000);
      container.appendChild(s);
    } catch (e) {
      resolve();
    }
  });
}

/* Re-run ONE slot's code. DOM injection only — never document.write
 * (post-load document.write would wipe the page). */
function refreshSlot(s) {
  return (async () => {
    try {
      if (!document.contains(s.el)) return;
      s.el.innerHTML = "";
      if (s.type === "container") {
        const box = document.createElement("div");
        box.id = s.container;
        s.el.appendChild(box);
        await injectScript(s.el, s.src, s.async);
      } else {
        try {
          window.atOptions = { key: s.key, format: "iframe", height: s.h, width: s.w, params: {} };
        } catch (e) {}
        await injectScript(s.el, s.host + "/" + s.key + "/invoke.js", false);
      }
    } catch (e) {}
  })();
}

function floorOpen() {
  try {
    return Date.now() - lastBatchAt >= MIN_BATCH_GAP_MS;
  } catch (e) {
    return true;
  }
}

function runBatch(reason) {
  lastBatchAt = Date.now();
  videosSinceBatch = 0;
  watchAccum = 0;
  batches++;
  try {
    batchLog.push({ t: lastBatchAt, reason });
    if (batchLog.length > 30) batchLog.splice(0, batchLog.length - 30);
  } catch (e) {}
  slots.forEach((s) => {
    queue = queue.then(() => refreshSlot(s));
  });
  queue = queue.catch(() => {});
}

function maybeBatch() {
  if (!slots.length) return false;
  if (!floorOpen()) return false;
  return true;
}

function onVideoChanged() {
  videosSinceBatch++;
  if (videosSinceBatch >= VIDEOS_PER_BATCH && maybeBatch()) {
    runBatch("videos");
  }
}

function mainVideoPlaying() {
  try {
    if (document.hidden) return false;
    const v = document.getElementById("main-video");
    if (!v || v.paused) { lastTime = -1; return false; }
    if (v.readyState < 3) return false;
    // Count only real advancement (stalls/buffering don't earn time).
    if (lastTime >= 0 && v.currentTime <= lastTime) return false;
    lastTime = v.currentTime;
    return true;
  } catch (e) {
    return false;
  }
}

export async function init() {
  slots = collectSlots();
  if (!slots.length) return;
  // The static markup is the first impression — the floor counts from here.
  lastBatchAt = Date.now();
  window.addEventListener("sx:video-changed", () => {
    try { onVideoChanged(); } catch (e) {}
  });
  setInterval(() => {
    try {
      if (!mainVideoPlaying()) return;
      watchAccum += TICK_MS / 1000;
      if (watchAccum >= WATCH_SECONDS_PER_BATCH && maybeBatch()) {
        runBatch("watch");
      }
    } catch (e) {}
  }, TICK_MS);
  // Manual trigger (console/debug): window.sxAdsRefresh().
  window.sxAdsRefresh = () => {
    if (maybeBatch()) runBatch("manual");
    return batches;
  };
  window.sxAdsStats = () => ({ batches, slots: slots.length, videosSinceBatch, watchAccum, recentBatches: batchLog.slice() });
}
