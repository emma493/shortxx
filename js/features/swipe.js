import { getAllVideos } from "../../vid.js";
import { esc } from "../lib/dom.js";
import { getCachedThumb } from "../lib/thumb.js";
import { activateVideo, playVideoAt } from "./player.js";

/* js/features/swipe.js — no-reload swipe feed.
 * Builds a small recycled window of .snap-item sections inside .snap-feed
 * and moves the SINGLETON player (#player-region carries #main-video +
 * progress) and rail (#sx-overlay) nodes into the settled section, so all
 * feature modules keep working on their cached references with zero page
 * reloads. An IntersectionObserver picks the active section; views, store
 * and sx:video-changed flow through the same player.js choke point. */

const AHEAD = 3;
const BEHIND = 1;

let feedEl = null;
let playerRegion = null;
let overlay = null;
let mainVideo = null;
let observer = null;
let booted = false;
let activePoolIndex = 0;
// poolIdx -> section element for the current window
let windowMap = new Map();

function pool() {
  return getAllVideos();
}

function wrapIndex(i, n) {
  return ((i % n) + n) % n;
}

function posterHTML(v) {
  let thumb = null;
  try { thumb = getCachedThumb(v); } catch (e) {}
  if (thumb) {
    return '<img src="' + esc(thumb) + '" alt="" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;display:block;">';
  }
  // Plain black backdrop while the video loads — no letter avatars.
  return '<div aria-hidden="true" style="width:100%;height:100%;background:#000;"></div>';
}

function sectionEl(poolIdx, v) {
  const sec = document.createElement("div");
  sec.className = "snap-item relative w-full bg-black";
  sec.setAttribute("data-sec", String(poolIdx));
  sec.setAttribute("role", "article");
  sec.setAttribute("aria-label", "Video by @" + (v.creator || "Shortxx"));
  sec.innerHTML =
    '<div data-frame class="relative w-full h-full md:max-w-[480px] md:mx-auto md:rounded-lg md:overflow-hidden lg:max-w-[480px] lg:mx-auto lg:rounded-lg lg:overflow-hidden">' +
    '<div data-media class="absolute inset-0 overflow-hidden bg-black">' + posterHTML(v) + "</div>" +
    "</div>";
  return sec;
}

/* Incremental window: append/prepend at edges, drop far sections. Never
 * rebuilds the whole list mid-scroll (that would break snap position). */
function ensureWindow(center) {
  const list = pool();
  const n = list.length;
  if (!n || !feedEl) return;
  const want = new Set();
  const span = Math.min(n, BEHIND + 1 + AHEAD);
  // Unique pool indices centered on `center` (no duplicates on tiny pools).
  for (let k = 0; k < span; k++) {
    // Order: center, center+1..+AHEAD, center-1..-BEHIND
    const off = k === 0 ? 0 : k <= AHEAD ? k : -(k - AHEAD);
    want.add(wrapIndex(center + off, n));
  }
  // Drop sections outside the window (never the active one mid-settle).
  windowMap.forEach((el, idx) => {
    if (!want.has(idx) && idx !== activePoolIndex) {
      try { observer.unobserve(el); } catch (e) {}
      try { el.remove(); } catch (e) {}
      windowMap.delete(idx);
    }
  });
  // Insert missing sections in pool order.
  const ordered = [...want].sort((a, b) => {
    // Sort by distance forward from (center - BEHIND) for DOM order.
    const rel = (x) => (x - (center - BEHIND) + n * 2) % n;
    return rel(a) - rel(b);
  });
  ordered.forEach((idx) => {
    if (windowMap.has(idx)) return;
    const v = list[idx];
    if (!v) return;
    const el = sectionEl(idx, v);
    // Find the next already-mounted section after idx to insert before.
    let before = null;
    let probe = (idx + 1) % n;
    for (let k = 0; k < n; k++) {
      if (windowMap.has(probe)) { before = windowMap.get(probe); break; }
      probe = (probe + 1) % n;
    }
    try {
      if (before && before.parentNode === feedEl) feedEl.insertBefore(el, before);
      else feedEl.appendChild(el);
    } catch (e) { return; }
    windowMap.set(idx, el);
    try { observer.observe(el); } catch (e) {}
  });
}

function nodesPlaced(sec) {
  try {
    const media = sec && sec.querySelector("[data-media]");
    const frame = sec && sec.querySelector("[data-frame]");
    return !!(
      media && frame && playerRegion && playerRegion.parentNode === media &&
      overlay && overlay.parentNode === frame
    );
  } catch (e) {
    return false;
  }
}

function setActive(poolIdx) {
  const list = pool();
  if (!list.length) return;
  const idx = wrapIndex(poolIdx, list.length);
  const sec = windowMap.get(idx);
  const data = list[idx];
  if (!sec || !data) {
    // Target not mounted (stale IO event) — make sure it exists.
    ensureWindow(idx);
    return;
  }
  // Already active with nodes in place — just top up the window.
  if (idx === activePoolIndex && nodesPlaced(sec)) {
    ensureWindow(idx);
    return;
  }
  activePoolIndex = idx;
  try {
    const media = sec.querySelector("[data-media]");
    const frame = sec.querySelector("[data-frame]");
    if (media && playerRegion && playerRegion.parentNode !== media) media.appendChild(playerRegion);
    // Overlay belongs to the centered 480px frame (original geometry):
    // icons at the frame's right edge, captions bounded by the frame.
    if (frame && overlay && overlay.parentNode !== frame) frame.appendChild(overlay);
  } catch (e) {}
  try {
    if (mainVideo) playVideoAt(mainVideo, activePoolIndex);
  } catch (e) {}
  activateVideo(data);
  ensureWindow(activePoolIndex);
}

function onIntersect(entries) {
  let best = null;
  let bestRatio = 0.6;
  entries.forEach((en) => {
    if (en.isIntersecting && en.intersectionRatio >= bestRatio) {
      bestRatio = en.intersectionRatio;
      best = en.target;
    }
  });
  if (!best) return;
  const idx = parseInt(best.getAttribute("data-sec") || "-1", 10);
  if (isNaN(idx) || idx < 0) return;
  setActive(idx);
}

function scrollToActive(instant) {
  const sec = windowMap.get(activePoolIndex);
  if (!sec || !feedEl) return;
  try {
    feedEl.scrollTo({ top: sec.offsetTop - feedEl.offsetTop, behavior: instant ? "auto" : "smooth" });
  } catch (e) {
    try { feedEl.scrollTop = sec.offsetTop - feedEl.offsetTop; } catch (e2) {}
  }
}

function startIndex() {
  const list = pool();
  if (!list.length) return 0;
  try {
    const pick = sessionStorage.getItem("shortxx_pick");
    if (pick) {
      const pi = list.findIndex((v) => v.id === pick);
      if (pi >= 0) {
        try { sessionStorage.removeItem("shortxx_pick"); } catch (e) {}
        return pi;
      }
      try { sessionStorage.removeItem("shortxx_pick"); } catch (e) {}
    }
  } catch (e) {}
  try {
    const saved = parseInt(localStorage.getItem("currentVideoIndex") || "0", 10);
    if (!isNaN(saved) && saved >= 0 && saved < list.length) return saved;
  } catch (e) {}
  return 0;
}

function boot() {
  if (booted) return;
  const list = pool();
  if (!list.length) return;
  booted = true;
  window.sxSwipeBooted = true;
  // Drop the static boot section (player + rail nodes were already
  // captured by reference in init, so moving them out is lossless).
  try {
    const bootSec = feedEl && feedEl.querySelector("[data-boot]");
    if (bootSec && !windowMap.size) bootSec.remove();
  } catch (e) {}
  activePoolIndex = startIndex();
  try {
    localStorage.setItem("currentVideoIndex", String(activePoolIndex));
  } catch (e) {}
  ensureWindow(activePoolIndex);
  scrollToActive(true);
  // Activate synchronously so first paint has video + rail even if the
  // observer hasn't fired yet; later IO events no-op via the setActive guard.
  setActive(activePoolIndex);
}

/* Feed-mode switch without reload: rebuild pool window around the same
 * video when it survives, else restart at 0. Called AFTER
 * loadVideosFromFirestore() resolves (see feed.js). */
window.sxReseedFeed = function () {
  const list = pool();
  if (!list.length || !feedEl) return;
  try {
    // Keep position when possible: match by video id.
    const prevId = window._sxLastVideoId || null;
    let idx = 0;
    if (prevId) {
      const pi = list.findIndex((v) => v.id === prevId);
      if (pi >= 0) idx = pi;
    }
    activePoolIndex = idx;
    try { localStorage.setItem("currentVideoIndex", String(idx)); } catch (e) {}
    windowMap.forEach((el) => {
      try { observer.unobserve(el); } catch (e) {}
      try { el.remove(); } catch (e) {}
    });
    windowMap = new Map();
    try { feedEl.scrollTop = 0; } catch (e) {}
    ensureWindow(activePoolIndex);
    scrollToActive(true);
    setActive(activePoolIndex);
  } catch (e) {}
};

window.sxSwipeTo = function (i) {
  const n = pool().length;
  if (!n) return;
  const idx = wrapIndex(i, n);
  // Make sure the target exists, then smooth-scroll; IO settles activation.
  ensureWindow(idx);
  const sec = windowMap.get(idx);
  if (sec && feedEl) {
    try { feedEl.scrollTo({ top: sec.offsetTop - feedEl.offsetTop, behavior: "smooth" }); } catch (e) {}
  }
};

export async function init() {
  feedEl = document.querySelector(".snap-feed");
  playerRegion = document.getElementById("player-region");
  overlay = document.getElementById("sx-overlay");
  mainVideo = document.getElementById("main-video");
  if (!feedEl || !playerRegion || !mainVideo) return;
  // Track current id for reseed continuity.
  window.addEventListener("sx:video-changed", () => {
    try {
      const list = pool();
      const v = list[activePoolIndex];
      if (v && v.id) window._sxLastVideoId = v.id;
    } catch (e) {}
  });
  observer = new IntersectionObserver(onIntersect, { root: feedEl, threshold: [0.6] });
  boot();
  window.addEventListener("sx:videos-ready", () => {
    try {
      if (!booted) boot();
      else {
        // Late-arriving pool (first load): rebuild around start.
        booted = false;
        window.sxSwipeBooted = false;
        windowMap.forEach((el) => {
          try { observer.unobserve(el); } catch (e) {}
          try { el.remove(); } catch (e) {}
        });
        windowMap = new Map();
        boot();
      }
    } catch (e) {}
  });
}
