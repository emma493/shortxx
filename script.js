import { loadVideosFromFirestore, getNextVideo } from "./vid.js";

// Tracks the hls.js instance currently attached to the player to prevent memory leaks
let activeHls = null;

// The original, directly-playable source for whatever video is currently loaded
let currentVideoDirectUrl = "";

/**
 * Plays the next available video stream fetched from Firestore.
 */
function playNextVideo(videoElement) {
  const videoData = getNextVideo();
  if (!videoData || !videoElement) return;

  const isLegacyString = typeof videoData === "string";
  currentVideoDirectUrl = isLegacyString ? videoData : videoData.url;

  if (!isLegacyString && videoData.id) {
    sessionStorage.setItem("lastPlayedVideoId", videoData.id);
  }
  sessionStorage.setItem("lastPlayedVideoUrl", currentVideoDirectUrl);

  // Disable native remote playback (AirPlay, Cast)
  videoElement.disableRemotePlayback = true;
  videoElement.setAttribute("disableremoteplayback", "true");
  videoElement.setAttribute("x-webkit-airplay", "deny");
  if ("webkitAllowsAirPlay" in videoElement)
    videoElement.webkitAllowsAirPlay = false;
  if (videoElement.remote) videoElement.remote.disableRemotePlayback = true;

  if (activeHls) {
    activeHls.destroy();
    activeHls = null;
  }

  const hlsUrl = !isLegacyString ? videoData.hlsUrl : null;
  const posterUrl = !isLegacyString ? videoData.posterUrl : null;
  videoElement.poster = posterUrl || "";

  const canUseHlsJs = hlsUrl && window.Hls && window.Hls.isSupported();
  const canUseNativeHls =
    hlsUrl && videoElement.canPlayType("application/vnd.apple.mpegurl");

  const attemptPlay = () => {
    const playPromise = videoElement.play();
    if (playPromise !== undefined) {
      playPromise.catch((error) => {
        console.warn(
          "Autoplay fallback triggered due to browser policy:",
          error,
        );
        videoElement.muted = true;
        videoElement.play().catch(() => {});
      });
    }
  };

  if (canUseHlsJs) {
    activeHls = new window.Hls({
      maxBufferLength: 15,
      startLevel: -1,
    });
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

document.addEventListener("DOMContentLoaded", async () => {
  // --- 1. Firestore Video Fetching & Preload ---
  await loadVideosFromFirestore();

  const video = document.getElementById("main-video");
  const playerRegion = document.getElementById("player-region");

  if (video) {
    playNextVideo(video);
  }

  // --- 2. Element Selectors (NudiTok DOM hooks) ---
  const likeBtn = document.querySelector(".like-btn");
  const likeHeart = document.querySelector(".like-heart");
  const muteBtns = document.querySelectorAll(".mute-btn");
  const unmuteHint = document.getElementById("unmute-hint");
  const unmuteDismiss = document.getElementById("unmute-dismiss");
  const shareBtn = document.getElementById("share-btn");
  const fsBtn = document.getElementById("fs-btn");
  const progressWrap = document.getElementById("ntok-progress");
  const progressFill = document.getElementById("ntok-progress-fill");

  // --- 3. Display Random Username ---
  const usernames = [
    "LilyGrace",
    "AvaRose",
    "EmmaBelle",
    "SophiaMae",
    "IsabellaJoy",
    "MiaHope",
    "CharlotteSky",
    "AmeliaDawn",
    "HarperLee",
    "EvelynRose",
    "AbigailStar",
    "EmilyBloom",
    "EllaJune",
    "ScarlettRay",
    "GraceLynn",
    "ChloeKate",
    "PenelopeSue",
    "LaylaJo",
    "RileyQuinn",
    "ZoeyAnn",
    "NoraJane",
    "LilyPearl",
  ];
  const userNameElement = document.querySelector(".dynamic-username");
  if (userNameElement) {
    const randomName = usernames[Math.floor(Math.random() * usernames.length)];
    userNameElement.textContent = randomName;
  }

  // --- 4. Display Random Counts (likes / views / watching) ---
  const likeCountElement = document.querySelector(".like-count");
  if (likeCountElement) {
    const randomLikes = (Math.random() * 98 + 1).toFixed(1) + "K";
    likeCountElement.textContent = randomLikes;
  }
  const viewsElement = document.querySelector(".views-count");
  if (viewsElement) {
    const views = (Math.random() * 9 + 1).toFixed(1) + "K";
    viewsElement.textContent = "· " + views + " views";
  }
  const watchingElement = document.querySelector(".watching-num");
  if (watchingElement) {
    watchingElement.textContent = String(
      Math.floor(Math.random() * 45) + 12,
    );
  }

  // --- 5. Double Tap & Like Logic ---
  let lastTap = 0;

  const toggleLike = () => {
    if (!likeBtn) return;
    const pressed = likeBtn.getAttribute("aria-pressed") === "true";
    likeBtn.setAttribute("aria-pressed", String(!pressed));
    likeBtn.setAttribute(
      "aria-label",
      !pressed ? "Unlike" : "Like",
    );
    if (likeHeart) {
      likeHeart.classList.toggle("text-white", pressed);
      likeHeart.classList.toggle("text-primary", !pressed);
    }
  };

  const showBigHeart = (x, y) => {
    const heart = document.createElement("div");
    heart.setAttribute("aria-hidden", "true");
    heart.innerHTML =
      '<svg width="96" height="96" viewBox="0 0 24 24" fill="#fe2c55" stroke="none" style="filter:drop-shadow(0 4px 12px rgba(0,0,0,0.5))"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>';
    heart.style.cssText =
      "position:fixed;left:" +
      x +
      "px;top:" +
      y +
      "px;transform:translate(-50%,-50%) scale(0);opacity:0;z-index:80;pointer-events:none;transition:transform 0.25s ease-out,opacity 0.4s ease-out;";
    document.body.appendChild(heart);
    requestAnimationFrame(() => {
      heart.style.transform = "translate(-50%,-50%) scale(1.2)";
      heart.style.opacity = "1";
    });
    setTimeout(() => {
      heart.style.transform = "translate(-50%,-50%) scale(1)";
      heart.style.opacity = "0";
    }, 450);
    setTimeout(() => heart.remove(), 900);
    if (likeBtn && likeBtn.getAttribute("aria-pressed") !== "true") {
      toggleLike();
    }
  };

  if (likeBtn) {
    likeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleLike();
    });
  }

  // --- 6. Mute / Unmute Logic ---
  function updateMuteUI(muted) {
    if (!video) return;
    video.muted = muted;
    if (unmuteHint) {
      unmuteHint.style.display = muted ? "" : "none";
    }
  }

  function toggleAudio() {
    if (!video) return;
    const nextState = !video.muted;
    localStorage.setItem("videoMuted", nextState.toString());
    updateMuteUI(nextState);
  }

  muteBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleAudio();
    });
  });

  if (unmuteDismiss && unmuteHint) {
    unmuteDismiss.addEventListener("click", (e) => {
      e.stopPropagation();
      unmuteHint.style.display = "none";
    });
  }

  const savedAudioPreference = localStorage.getItem("videoMuted");
  if (savedAudioPreference === null) {
    localStorage.setItem("videoMuted", "true");
    updateMuteUI(true);
  } else {
    updateMuteUI(savedAudioPreference === "true");
  }

  // --- 7. Tap Video Interaction (single tap = play, double tap = like) ---
  if (playerRegion && video) {
    playerRegion.addEventListener("click", (e) => {
      if (e.target.closest("button,a,[role=progressbar]")) {
        return;
      }

      const currentTime = new Date().getTime();
      const tapLength = currentTime - lastTap;
      if (tapLength < 300 && tapLength > 0) {
        showBigHeart(e.clientX, e.clientY);
        lastTap = currentTime;
        return;
      }
      lastTap = currentTime;

      if (video.paused) {
        video.play().catch(() => {});
      }
    });
  }

  // --- 8. Share (Web Share API with download fallback) ---
  if (shareBtn) {
    shareBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const shareSource = currentVideoDirectUrl || (video && video.src) || location.href;
      if (navigator.share) {
        try {
          await navigator.share({ url: shareSource, title: document.title });
          return;
        } catch (err) {
          if (err && err.name === "AbortError") return;
        }
      }
      try {
        const response = await fetch(shareSource);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = "video_" + new Date().getTime() + ".mp4";
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
      } catch (error) {
        console.error("Share failed:", error);
        window.open(shareSource, "_blank");
      }
    });
  }

  // --- 9. Fullscreen Toggle ---
  if (fsBtn) {
    fsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        document.documentElement.requestFullscreen().catch(() => {});
      }
      fsBtn.setAttribute(
        "aria-pressed",
        String(!document.fullscreenElement),
      );
    });
  }

  // --- 10. Dead (visual-only) Controls ---
  document.querySelectorAll("[data-dead]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  // --- 11. Navigation & Swipe Handling (index.html <-> vid2.html) ---
  const nextPage = document.body.dataset.next;
  const prevPage = document.body.dataset.prev;

  const navigateToNext = () => {
    if (nextPage) window.location.href = nextPage;
  };

  const navigateToPrev = () => {
    if (prevPage) window.location.href = prevPage;
  };

  const handleScrollAction = (isNext) => {
    if (isNext) {
      navigateToNext();
    } else {
      navigateToPrev();
    }
  };

  // Mobile Touch Swipe Handling
  let touchstartY = 0;
  window.addEventListener("touchstart", (e) => {
    touchstartY = e.changedTouches[0].screenY;
  });

  window.addEventListener("touchend", (e) => {
    const touchendY = e.changedTouches[0].screenY;
    if (touchstartY - touchendY > 50) handleScrollAction(true);
    if (touchendY - touchstartY > 50) navigateToPrev();
  });

  // Desktop Mouse Wheel Navigation
  let isScrolling = false;
  window.addEventListener("wheel", (e) => {
    if (isScrolling) return;
    if (e.deltaY > 30) {
      isScrolling = true;
      handleScrollAction(true);
    } else if (e.deltaY < -30) {
      isScrolling = true;
      navigateToPrev();
    }
  });

  // Keyboard Arrow Key Navigation (Desktop)
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      handleScrollAction(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      navigateToPrev();
    }
  });

  // --- 12. Video Progress Bar (seek + fill) ---
  if (video && progressWrap && progressFill) {
    const setFill = () => {
      if (!video.duration) return;
      const ratio = video.currentTime / video.duration;
      progressFill.style.transform = "scaleX(" + ratio + ")";
      progressWrap.setAttribute(
        "aria-valuenow",
        String(Math.round(ratio * 100)),
      );
    };

    video.addEventListener("timeupdate", setFill);
    video.addEventListener("loadedmetadata", setFill);

    const seekFromEvent = (e) => {
      const rect = progressWrap.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const ratio = Math.min(Math.max(x / rect.width, 0), 1);
      if (video.duration) {
        video.currentTime = ratio * video.duration;
        setFill();
      }
    };

    let seeking = false;
    progressWrap.addEventListener("pointerdown", (e) => {
      seeking = true;
      progressWrap.setPointerCapture(e.pointerId);
      seekFromEvent(e);
    });
    progressWrap.addEventListener("pointermove", (e) => {
      if (seeking) seekFromEvent(e);
    });
    progressWrap.addEventListener("pointerup", () => {
      seeking = false;
    });
    progressWrap.addEventListener("pointercancel", () => {
      seeking = false;
    });
  }
});
