import { getAllVideos, getPromoPool } from "../../vid.js";
import { LIVE_CAMS_URL } from "../lib/links.js";

/* js/features/videoad.js — skippable Girls video-ad interstitial
 * (xvideos-style). A muted-or-sounding promo (mirrors the viewer's mute
 * choice) plays over paused content with a 5 s locked countdown, then
 * Skip ▸ jumps the feed to the next video. CTA (button or video tap)
 * opens the Live Cams link in a new tab. Re-shows every random 3–5 video
 * changes with a 30 s global floor. Silent by design: dead creatives,
 * empty pools and stalls close back to content with no toast, no event.
 * Funnel events (impression/click/skip) ride window.trackPromoEvent. */

const SKIP_AFTER_S = 5;
const FIRST_THRESHOLD = 3;
const WATCH_FALLBACK_S = 60;
const MIN_GAP_MS = 30000;
const STALL_TIMEOUT_MS = 8000;
const TICK_MS = 5000;

let storeRef = null;
let started = false;
let changesSinceAd = 0;
let watchAccum = 0;
let nextThreshold = FIRST_THRESHOLD;
let lastShowAt = 0;
let overlay = null;
let promoEl = null;
let countdownTimer = null;
let stallTimer = null;
let volumeMirror = null;
let currentPromo = null;
let shownIds = [];

function mainVideo() {
  try {
    return document.getElementById("main-video");
  } catch (e) {
    return null;
  }
}

function mainPlaying() {
  try {
    const v = mainVideo();
    if (!v || v.paused) return false;
    if (document.hidden) return false;
    return v.readyState >= 2;
  } catch (e) {
    return false;
  }
}

function promoEvent(type) {
  try {
    if (typeof window.trackPromoEvent === "function") window.trackPromoEvent(type, currentPromo ? currentPromo.id : "");
  } catch (e) {}
}

function floorOpen() {
  try {
    return Date.now() - lastShowAt >= MIN_GAP_MS;
  } catch (e) {
    return true;
  }
}

function pickCreative() {
  let pool = [];
  try {
    pool = getPromoPool() || [];
  } catch (e) {
    pool = [];
  }
  if (!pool.length) return null;
  const fresh = pool.filter((v) => v && v.id && shownIds.indexOf(v.id) < 0);
  const list = fresh.length ? fresh : pool;
  const pick = list[Math.floor(Math.random() * list.length)];
  if (!pick) return null;
  shownIds = fresh.length ? shownIds.concat([pick.id]) : [pick.id];
  if (shownIds.length > 200) shownIds = shownIds.slice(-100);
  return pick;
}

function closeOverlay(resume) {
  try {
    if (countdownTimer) clearInterval(countdownTimer);
  } catch (e) {}
  try {
    if (stallTimer) clearTimeout(stallTimer);
  } catch (e) {}
  countdownTimer = null;
  stallTimer = null;
  try {
    const main = mainVideo();
    if (main && volumeMirror) main.removeEventListener("volumechange", volumeMirror);
  } catch (e) {}
  volumeMirror = null;
  try {
    if (promoEl) {
      promoEl.pause();
      promoEl.removeAttribute("src");
      promoEl.load();
    }
  } catch (e) {}
  promoEl = null;
  try {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  } catch (e) {}
  overlay = null;
  currentPromo = null;
  try {
    const host = document.getElementById("player-region");
    if (host) host.classList.remove("sx-videoad-host");
  } catch (e) {}
  if (resume !== false) {
    try {
      const main = mainVideo();
      if (main && main.paused) {
        const p = main.play();
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) {}
  }
}

function advanceFeed() {
  try {
    if (typeof window.sxSwipeTo !== "function") return;
    const cur = storeRef && storeRef.current ? storeRef.current.id : null;
    const list = getAllVideos() || [];
    let idx = -1;
    if (cur) {
      for (let i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === cur) {
          idx = i;
          break;
        }
      }
    }
    window.sxSwipeTo(idx >= 0 ? idx + 1 : 1);
  } catch (e) {}
}

function openCta() {
  try {
    window.open(LIVE_CAMS_URL, "_blank", "noopener");
  } catch (e) {
    try {
      location.href = LIVE_CAMS_URL;
    } catch (err) {}
  }
}

function showOverlay(promo) {
  const main = mainVideo();
  const host = document.getElementById("player-region");
  if (!main || !host || !promo || !promo.url) return false;

  currentPromo = promo;
  lastShowAt = Date.now();
  changesSinceAd = 0;
  watchAccum = 0;
  nextThreshold = FIRST_THRESHOLD + Math.floor(Math.random() * 3);

  try {
    main.pause();
  } catch (e) {}

  overlay = document.createElement("div");
  overlay.className = "sx-videoad";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Advertisement");
  const poster = promo.posterUrl ? ' poster="' + promo.posterUrl.replace(/"/g, "") + '"' : "";
  const ctaLabel = promo.creator ? "Watch @" + promo.creator + " live" : "Watch live now";
  overlay.innerHTML =
    '<video class="sx-videoad-media" src="' + promo.url.replace(/"/g, "") + '"' +
    poster +
    ' playsinline disablepictureinpicture preload="auto" aria-hidden="true"></video>' +
    '<div class="sx-videoad-top"><span class="sx-videoad-pill">Ad</span>' +
    '<button type="button" class="sx-videoad-skip" disabled>Skip in ' + SKIP_AFTER_S + '</button></div>' +
    '<button type="button" class="sx-videoad-cta"><span class="sx-videoad-cta-dot"></span>' +
    '<span>' + ctaLabel.replace(/</g, "&lt;") + " ▸</span></button>";

  try {
    host.classList.add("sx-videoad-host");
    host.appendChild(overlay);
  } catch (e) {
    closeOverlay(false);
    return false;
  }

  promoEl = overlay.querySelector(".sx-videoad-media");
  const skipBtn = overlay.querySelector(".sx-videoad-skip");
  const ctaBtn = overlay.querySelector(".sx-videoad-cta");
  if (!promoEl || !skipBtn || !ctaBtn) {
    closeOverlay(true);
    return false;
  }

  // Sound mirrors the viewer's choice: muted feed → muted ad; sounding
  // feed (explicit gesture happened) → ad with audio. Follows live toggles.
  try {
    promoEl.muted = !!main.muted;
  } catch (e) {
    promoEl.muted = true;
  }
  volumeMirror = () => {
    try {
      if (promoEl) promoEl.muted = !!main.muted;
    } catch (e) {}
  };
  try {
    main.addEventListener("volumechange", volumeMirror);
  } catch (e) {}

  let skipIn = SKIP_AFTER_S;
  countdownTimer = setInterval(() => {
    skipIn -= 1;
    if (skipIn <= 0) {
      try {
        if (countdownTimer) clearInterval(countdownTimer);
      } catch (e) {}
      countdownTimer = null;
      try {
        skipBtn.disabled = false;
        skipBtn.textContent = "Skip ▸";
        skipBtn.classList.add("ready");
      } catch (e) {}
    } else {
      try {
        skipBtn.textContent = "Skip in " + skipIn;
      } catch (e) {}
    }
  }, 1000);

  // Stall guard: promo that never paints must never strand the viewer.
  stallTimer = setTimeout(() => {
    try {
      if (promoEl && promoEl.readyState < 2) closeOverlay(true);
    } catch (e) {
      closeOverlay(true);
    }
  }, STALL_TIMEOUT_MS);

  skipBtn.addEventListener("click", (e) => {
    try {
      e.stopPropagation();
    } catch (err) {}
    if (skipBtn.disabled) return;
    promoEvent("promo_skip");
    closeOverlay(true);
    advanceFeed();
  });

  const fireCta = (e) => {
    try {
      if (e) e.stopPropagation();
    } catch (err) {}
    promoEvent("promo_click");
    openCta();
    closeOverlay(true);
  };
  ctaBtn.addEventListener("click", fireCta);
  promoEl.addEventListener("click", fireCta);

  promoEl.addEventListener("ended", () => {
    closeOverlay(true);
  });
  promoEl.addEventListener("error", () => {
    closeOverlay(true);
  });

  try {
    const p = promoEl.play();
    if (p && p.catch) {
      p.catch(() => {
        try {
          promoEl.muted = true;
          promoEl.play().catch(() => {
            closeOverlay(true);
          });
        } catch (err) {
          closeOverlay(true);
        }
      });
    }
  } catch (e) {
    closeOverlay(true);
    return false;
  }

  promoEvent("promo_impression");
  return true;
}

function maybeShow() {
  if (overlay) return;
  if (!floorOpen()) return;
  if (!mainPlaying()) return;
  if (changesSinceAd < nextThreshold && watchAccum < WATCH_FALLBACK_S) return;
  const promo = pickCreative();
  if (!promo) {
    // No girls creatives (yet — pool backfills as you scroll): retry quietly
    // on the next cycle instead of spinning every change.
    changesSinceAd = 0;
    watchAccum = 0;
    return;
  }
  showOverlay(promo);
}

export async function init(ctx) {
  if (started) return;
  started = true;
  storeRef = (ctx && ctx.store) || null;
  window.addEventListener("sx:video-changed", () => {
    try {
      changesSinceAd++;
      maybeShow();
    } catch (e) {}
  });
  setInterval(() => {
    try {
      if (overlay || !mainPlaying()) return;
      watchAccum += TICK_MS / 1000;
      maybeShow();
    } catch (e) {}
  }, TICK_MS);
  // Manual trigger (console/debug): window.sxPromoShow().
  window.sxPromoShow = () => {
    changesSinceAd = nextThreshold;
    maybeShow();
    return !!overlay;
  };
  window.sxPromoStats = () => ({ changesSinceAd, nextThreshold, watchAccum, open: !!overlay });
}
