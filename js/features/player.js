import { getNextVideo, getVideoAt } from "../../vid.js";
import { store } from "../store.js";
import { getCachedThumb } from "../lib/thumb.js";
import { noteComplete, noteWatch } from "./telemetry.js";

/* js/features/player.js — video playback only (HLS + mp4 fallback).
 * Owns one persistent #main-video element + its HLS instance; the swipe
 * feed moves that element between sections, so playback state, listeners
 * and rail wiring survive swipes with zero reloads. Emits window event
 * "sx:video-changed" so rail/comment/save modules can repaint. */

let activeHls = null;
let currentVideoDirectUrl = "";
let lastViewedId = null;
let loaderEl = null;

function showLoader() {
  if (!loaderEl) {
    try { loaderEl = document.getElementById("sx-loader"); } catch (e) {}
  }
  if (loaderEl) {
    try { loaderEl.style.display = "flex"; } catch (e) {}
  }
}

function hideLoader() {
  if (!loaderEl) {
    try { loaderEl = document.getElementById("sx-loader"); } catch (e) {}
  }
  if (loaderEl) {
    try { loaderEl.style.display = "none"; } catch (e) {}
  }
}

export function getShareSource(videoEl) {
  return currentVideoDirectUrl || (videoEl && videoEl.src) || location.href;
}

/* Publish a video as "current" for the whole rail. Single choke point so
 * both the legacy single-play path and the swipe feed repaint identically. */
export function activateVideo(videoData) {
  if (!videoData) return;
  store.current = videoData;
  store.videoId = videoData.id || null;
  store.creator = videoData.creator || null;
  store.linkedCreator = !!(videoData.creatorLinked && store.creator);
  window.dispatchEvent(new CustomEvent("sx:video-changed"));
  if (videoData.id && videoData.id !== lastViewedId) {
    lastViewedId = videoData.id;
    if (typeof window.trackVideoView === "function") {
      try { window.trackVideoView(videoData.id); } catch (e) {}
    }
  }
}

export function playVideoData(videoElement, videoData) {
  if (!videoData || !videoElement) return null;

  const isLegacyString = typeof videoData === "string";
  currentVideoDirectUrl = isLegacyString ? videoData : videoData.url;

  if (!isLegacyString && videoData.id) {
    try {
      sessionStorage.setItem("lastPlayedVideoId", videoData.id);
    } catch (e) {}
  }
  try {
    sessionStorage.setItem("lastPlayedVideoUrl", currentVideoDirectUrl);
  } catch (e) {}

  // Carry the user's mute choice across section moves (autoplay-safe).
  try {
    const saved = localStorage.getItem("videoMuted");
    if (saved === "false") videoElement.muted = false;
  } catch (e) {}

  videoElement.disableRemotePlayback = true;
  videoElement.setAttribute("disableremoteplayback", "true");
  videoElement.setAttribute("x-webkit-airplay", "deny");
  if ("webkitAllowsAirPlay" in videoElement) videoElement.webkitAllowsAirPlay = false;
  if (videoElement.remote) videoElement.remote.disableRemotePlayback = true;

  if (activeHls) {
    activeHls.destroy();
    activeHls = null;
  }

  const hlsUrl = !isLegacyString ? videoData.hlsUrl : null;
  // Poster first: poster_url wins when set, so the user sees a thumbnail
  // + loader instead of black while the video gets ready.
  let posterUrl = !isLegacyString ? videoData.posterUrl : null;
  if (!posterUrl && !isLegacyString) {
    try { posterUrl = getCachedThumb(videoData); } catch (e) {}
  }
  try {
    videoElement.poster = posterUrl || "";
  } catch (e) {}
  showLoader();
  // Fresh source, fresh watch-time base for telemetry.
  try { videoElement._sxLastT = undefined; } catch (e) {}

  const attemptPlay = () => {
    const playPromise = videoElement.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        videoElement.muted = true;
        videoElement.play().catch(() => {});
      });
    }
  };

  const canUseHlsJs = hlsUrl && window.Hls && window.Hls.isSupported();
  const canUseNativeHls = hlsUrl && videoElement.canPlayType("application/vnd.apple.mpegurl");

  if (canUseHlsJs) {
    activeHls = new window.Hls({ maxBufferLength: 15, startLevel: -1 });
    activeHls.loadSource(hlsUrl);
    activeHls.attachMedia(videoElement);
    activeHls.on(window.Hls.Events.MANIFEST_PARSED, attemptPlay);
    activeHls.on(window.Hls.Events.ERROR, (_evt, data) => {
      if (!data.fatal) return;
      console.warn("hls.js fatal error, falling back to direct_url:", data);
      if (activeHls) {
        activeHls.destroy();
        activeHls = null;
      }
      videoElement.src = currentVideoDirectUrl;
      videoElement.load();
      attemptPlay();
    });
  } else if (canUseNativeHls) {
    videoElement.src = hlsUrl;
    videoElement.load();
    attemptPlay();
  } else {
    videoElement.src = currentVideoDirectUrl;
    videoElement.load();
    attemptPlay();
  }
  return videoData;
}

/* Legacy single-play path (kept for compat): advance the rotation pointer
 * and play on the given element. */
export function playNextVideo(videoElement) {
  const videoData = getNextVideo();
  if (!videoData) return null;
  return playVideoData(videoElement, videoData);
}

/* Swipe-feed path: random access without advancing any pointer. The pool
 * index is persisted by getVideoAt for resume-across-visits. */
export function playVideoAt(videoElement, i) {
  const videoData = getVideoAt(i);
  if (!videoData) return null;
  return playVideoData(videoElement, videoData);
}

export async function init(ctx) {
  const video = document.getElementById("main-video");
  if (!video) return;
  // Authed-only engagement counters (telemetry.js no-ops for guests):
  // every 10 s of real playback + each completed play.
  let watchAccum = 0;
  video.addEventListener("timeupdate", () => {
    if (video.paused) return;
    // Positive sub-second diffs only — source swaps/seeks reset the base.
    if (typeof video._sxLastT === "number") {
      const dt = video.currentTime - video._sxLastT;
      if (dt > 0 && dt < 5) watchAccum += dt;
    }
    video._sxLastT = video.currentTime;
    if (watchAccum >= 10) {
      watchAccum = 0;
      noteWatch(10);
    }
  });
  video.addEventListener("seeked", () => {
    video._sxLastT = video.currentTime;
  });
  video.addEventListener("ended", () => {
    noteComplete();
  });
  // Dead-URL resilience: a video whose source fails (socket error, 404,
  // expired CDN link) must never strand the feed on black. Skip to the
  // next video; give up with a message after several consecutive failures.
  let errSkips = 0;
  const toast = (ctx && ctx.toast) || (() => {});
  video.addEventListener("playing", () => { errSkips = 0; hideLoader(); });
  video.addEventListener("error", () => {
    try {
      errSkips++;
      if (errSkips > 5) {
        errSkips = 0;
        hideLoader();
        toast("Videos won't load — check your connection");
        return;
      }
      const next = playNextVideo(video);
      if (next) activateVideo(next);
      else { hideLoader(); toast("Videos won't load — check your connection"); }
    } catch (e) {}
  });
  video.addEventListener("canplay", hideLoader);
  video.addEventListener("waiting", showLoader);
  video.addEventListener("loadstart", showLoader);
  // Single-shot boot play is owned by swipe.js now (it needs the pool
  // first). Fallback: if swipe never boots (no pool), play rotation head.
  window.addEventListener("sx:videos-ready", () => {
    try {
      if (window.sxSwipeBooted) return;
      const data = playNextVideo(video);
      if (!data) return;
      activateVideo(ctx.getCurrentVideo ? ctx.getCurrentVideo() : data);
    } catch (e) {}
  }, { once: true });
}
