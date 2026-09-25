import { getNextVideo } from "../../vid.js";
import { store } from "../store.js";

/* js/features/player.js — video playback only (HLS + mp4 fallback).
 * Owns activeHls + currentVideoDirectUrl. Emits window event
 * "sx:video-changed" so rail/comment/save modules can repaint. */

let activeHls = null;
let currentVideoDirectUrl = "";

export function getShareSource(videoEl) {
  return currentVideoDirectUrl || (videoEl && videoEl.src) || location.href;
}

export function playNextVideo(videoElement) {
  const videoData = getNextVideo();
  if (!videoData || !videoElement) return;

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
  const posterUrl = !isLegacyString ? videoData.posterUrl : null;
  try {
    videoElement.poster = posterUrl || "";
  } catch (e) {}

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
}

export async function init(ctx) {
  const video = document.getElementById("main-video");
  if (!video) return;
  playNextVideo(video);
  store.current = ctx.getCurrentVideo ? ctx.getCurrentVideo() : null;
  store.videoId = store.current && store.current.id ? store.current.id : null;
  store.creator = store.current && store.current.creator ? store.current.creator : null;
  store.linkedCreator = !!(store.current && store.current.creatorLinked && store.creator);
  window.dispatchEvent(new CustomEvent("sx:video-changed"));
}
