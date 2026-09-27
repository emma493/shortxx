/* js/lib/thumb.js — REAL thumbnails via canvas capture.
 * PERF RULES (mobile lag fix): capture uses preload="metadata" (never "auto",
 * never forced play) so only the moov + seek-range bytes are fetched; each
 * capture times out after 4s; concurrency is 1 on low-end/save-data and 2
 * otherwise; and hydrateThumbVideos() only captures tiles near the viewport
 * (IntersectionObserver) so a 60-tile grid no longer downloads 60 videos.
 * Firestore poster_url still wins when set (zero capture cost).
 */

import { esc } from "./dom.js";

const cache = new Map(); // videoId|url -> dataURL
const pending = new Map(); // key -> Promise<dataURL|null>
let queue = [];
let active = 0;

function isLowEnd() {
  try {
    const c = navigator.connection || {};
    if (c.saveData) return true;
    if (typeof c.effectiveType === "string" && /2g/.test(c.effectiveType)) return true;
  } catch (e) {}
  try {
    if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
      const cores = navigator.hardwareConcurrency || 8;
      if (cores <= 4) return true;
    }
  } catch (e) {}
  return false;
}

const MAX_CONCURRENT = isLowEnd() ? 1 : 2;
const CAPTURE_TIMEOUT_MS = 4000;
const MAX_CACHE_ENTRIES = 40;

function putThumb(key, url) {
  if (!key || !url) return;
  // LRU touch: re-insert existing keys so eviction drops the oldest.
  if (cache.has(key)) cache.delete(key);
  else if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, url);
}

function keyOf(v) {
  return String(v.id || v.url || "");
}

/* Sync read of an already-captured frame (no download). Lets the player and
 * swipe sections paint a real thumbnail instantly while the video loads. */
export function getCachedThumb(v) {
  try {
    if (!v) return null;
    if (v.posterUrl) return v.posterUrl;
    const k = keyOf(v);
    const hit = cache.get(k);
    // LRU touch so frequently shown tiles survive eviction.
    if (typeof hit === "string" && hit) {
      cache.delete(k);
      cache.set(k, hit);
      return hit;
    }
    return null;
  } catch (e) {
    return null;
  }
}

function captureFrame(v) {
  const key = keyOf(v);
  if (!key || !v.url) return Promise.resolve(null);
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (pending.has(key)) return pending.get(key);
  const p = new Promise((resolve) => {
    queue.push({ v, key, resolve });
    pump();
  });
  pending.set(key, p);
  return p;
}

function pump() {
  if (active >= MAX_CONCURRENT) return;
  const job = queue.shift();
  if (!job) return;
  active++;
  runCapture(job.v).then((url) => {
    active--;
    if (url) putThumb(job.key, url);
    pending.delete(job.key);
    job.resolve(url);
    pump();
  });
}

function runCapture(v) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (url) => {
      if (done) return;
      done = true;
      try { vid.removeAttribute("src"); vid.load(); } catch (e) {}
      try { vid.remove(); } catch (e) {}
      resolve(url || null);
    };
    const timer = setTimeout(() => finish(null), CAPTURE_TIMEOUT_MS);
    const vid = document.createElement("video");
    vid.crossOrigin = "anonymous";
    vid.muted = true;
    vid.playsInline = true;
    // Metadata only: seeking pulls just the moov + target range (when the
    // CDN supports ranges) instead of streaming the whole file.
    vid.preload = "metadata";
    try { vid.disableRemotePlayback = true; } catch (e) {}

    vid.addEventListener("error", () => { clearTimeout(timer); finish(null); });

    vid.addEventListener("loadedmetadata", () => {
      try {
        const d = vid.duration || 0;
        // Skip black head: 25% in, clamped 0.5s–3s.
        let t = 1.2;
        if (isFinite(d) && d > 0) t = Math.min(3, Math.max(0.5, d * 0.25));
        try {
          if (typeof vid.fastSeek === "function") vid.fastSeek(t);
          else vid.currentTime = t;
        } catch (e) {
          try { vid.currentTime = t; } catch (e2) {}
        }
      } catch (e) {}
    });

    vid.addEventListener("seeked", () => {
      // Wait 2 frames so the sought frame is actually painted.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            const w = vid.videoWidth || 360;
            const h = vid.videoHeight || 640;
            if (!w || !h) { clearTimeout(timer); finish(null); return; }
            const tw = 360;
            const th = Math.round((tw * h) / w);
            const canvas = document.createElement("canvas");
            canvas.width = tw;
            canvas.height = th;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(vid, 0, 0, tw, th);
            const url = canvas.toDataURL("image/jpeg", 0.72);
            // Guard: all-black captures (fade-in) — retry once further in.
            if (isMostlyBlack(ctx, tw, th) && (vid.duration || 0) > 4) {
              try { vid.currentTime = Math.min(vid.duration - 0.5, 2.5); } catch (e) {}
              setTimeout(() => {
                try {
                  ctx.drawImage(vid, 0, 0, tw, th);
                  const url2 = canvas.toDataURL("image/jpeg", 0.72);
                  clearTimeout(timer);
                  finish(url2);
                } catch (e) { clearTimeout(timer); finish(url); }
              }, 350);
              return;
            }
            clearTimeout(timer);
            finish(url);
          } catch (e) {
            // Canvas tainted (no CORS) — fall back to streaming <video> tile.
            clearTimeout(timer);
            finish(null);
          }
        });
      });
    });

    vid.src = v.url;
    try { vid.load(); } catch (e) {}
    // No programmatic play: metadata + seek is enough for a frame and
    // avoids downloading (and decoding) the full file per tile.
  });
}

function isMostlyBlack(ctx, w, h) {
  try {
    const step = 16;
    const data = ctx.getImageData(0, 0, w, h).data;
    let dark = 0, total = 0;
    for (let i = 0; i < data.length; i += 4 * step) {
      total++;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r < 12 && g < 12 && b < 12) dark++;
    }
    return total > 0 && dark / total > 0.92;
  } catch (e) {
    return false;
  }
}

/* Tile HTML: poster_url wins. Otherwise an <img> placeholder that
 * hydrateThumbVideos() fills with the captured frame. data-vidkey lets
 * repeat paints reuse the cached frame instantly. */
export function thumbHTML(v, cls) {
  const c = cls || "";
  if (v.posterUrl) {
    return '<img class="' + c + '" src="' + esc(v.posterUrl) + '" alt="" loading="lazy" decoding="async" fetchpriority="low" />';
  }
  const key = esc(keyOf(v));
  // Tiny dark placeholder (never white/blank) until capture lands.
  return (
    '<img class="' + c + ' sx-thumbimg" data-vidkey="' + key + '" alt="" loading="lazy" decoding="async" fetchpriority="low" ' +
    'src="data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="640"><rect width="100%" height="100%" fill="#1e1e1e"/></svg>') + '" />'
  );
}

const videoByKey = new Map();
export function registerVideos(list) {
  videoByKey.clear();
  (list || []).forEach((v) => {
    const k = keyOf(v);
    if (k) videoByKey.set(k, v);
  });
}

/* Scan root for pending thumbs, fetch correct frames, swap them in.
 * Safe to call on every repaint — cached keys resolve synchronously.
 * Viewport-gated: offscreen tiles are only observed; capture starts when
 * they come within ~600px of the viewport, so initial load fetches frames
 * for visible tiles only. */
let viewportObserver = null;
const observedImgs = new Set();

function getViewportObserver() {
  if (viewportObserver || typeof IntersectionObserver === "undefined") return viewportObserver;
  viewportObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        const img = en.target;
        if (!en.isIntersecting) return;
        try { viewportObserver.unobserve(img); } catch (e) {}
        observedImgs.delete(img);
        // Release the observe-time hold so capture actually starts.
        delete img.dataset.queued;
        delete img.dataset.deferred;
        startCapture(img);
      });
    },
    { root: null, rootMargin: "600px 0px", threshold: 0 },
  );
  return viewportObserver;
}

function clearShimmer(img) {
  try {
    const btn = img.closest("button");
    const sh = btn && btn.querySelector(".sx-rank-shimmer");
    if (sh) sh.remove();
  } catch (e) {}
}

function startCapture(img) {
  const k = img.getAttribute("data-vidkey");
  if (!k) return;
  if (img.dataset.done === "1" || img.dataset.queued === "1") return;
  if (cache.has(k)) {
    if (document.contains(img)) {
      img.src = cache.get(k);
      img.dataset.done = "1";
    }
    clearShimmer(img);
    return;
  }
  const v = videoByKey.get(k);
  if (!v) return;
  img.dataset.queued = "1";
  captureFrame(v).then((url) => {
    if (url) {
      if (document.contains(img)) {
        img.src = url;
        img.dataset.done = "1";
      }
    } else if (v.url && document.contains(img)) {
      // CORS-blocked canvas: fall back to a single streaming <video>
      // tile (metadata only) so SOMETHING real shows instead of black.
      try {
        const vid = document.createElement("video");
        vid.className = img.className.replace("sx-thumbimg", "").trim() + " sx-thumbvid";
        vid.src = v.url + "#t=1.2";
        vid.muted = true;
        vid.playsInline = true;
        vid.preload = "metadata";
        vid.setAttribute("aria-hidden", "true");
        img.replaceWith(vid);
        vid.load();
        vid.addEventListener("loadeddata", () => {
          const btn = vid.closest("button");
          const sh = btn && btn.querySelector(".sx-rank-shimmer");
          if (sh) sh.remove();
        });
        return;
      } catch (e) {}
    }
    clearShimmer(img);
  });
}

export function hydrateThumbVideos(root) {
  if (!root || !root.querySelectorAll) return;
  const observer = getViewportObserver();
  // Repaints detach old tiles — release observer holds on dead nodes.
  if (observer && observedImgs.size) {
    observedImgs.forEach((img) => {
      if (!document.contains(img)) {
        try { observer.unobserve(img); } catch (e) {}
        observedImgs.delete(img);
      }
    });
  }
  const imgs = root.querySelectorAll("img.sx-thumbimg[data-vidkey]");
  imgs.forEach((img) => {
    const k = img.getAttribute("data-vidkey");
    if (!k) return;
    if (img.dataset.done === "1" || img.dataset.queued === "1") return;
    // Cached frames resolve instantly without waiting for scroll.
    if (cache.has(k)) {
      startCapture(img);
      return;
    }
    if (observer) {
      img.dataset.queued = "1";
      img.dataset.deferred = "1";
      try { observer.observe(img); observedImgs.add(img); } catch (e) {
        delete img.dataset.queued;
        delete img.dataset.deferred;
        startCapture(img);
      }
      return;
    }
    startCapture(img);
  });
}

