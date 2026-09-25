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

  const video = document.querySelector("video");
  const videoContainer = document.querySelector(".video-container");

  if (video) {
    playNextVideo(video);
  }

  // --- 2. Element Selectors ---
  const likeBtn = document.querySelector(".like-btn");
  const muteBtn = document.querySelector(".mute-btn");
  const downloadBtn = document.querySelector(".download-btn");
  const loader = document.querySelector(".loader");

  // --- 3. Display Random Usernames ---
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

  // --- 4. Display Random Likes Count ---
  const likeCountElement = document.querySelector(".like-count");
  if (likeCountElement) {
    const randomLikes = (Math.random() * 98 + 1).toFixed(1) + "K";
    likeCountElement.textContent = randomLikes;
  }

  // --- 5. Video Loader Handling ---
  if (video && loader) {
    video.addEventListener("waiting", () => (loader.style.display = "block"));
    video.addEventListener("playing", () => (loader.style.display = "none"));
    video.addEventListener("canplay", () => (loader.style.display = "none"));
    if (video.readyState >= 3) loader.style.display = "none";
  }

  // --- 6. Double Tap & Like Logic ---
  let lastTap = 0;
  const bigHeart = document.createElement("i");
  bigHeart.className = "fas fa-heart big-heart";
  if (videoContainer) videoContainer.appendChild(bigHeart);

  const toggleLike = () => {
    if (!likeBtn) return;
    likeBtn.classList.toggle("liked");
    const icon = likeBtn.querySelector("i");
    if (icon) {
      icon.classList.remove("animate-pop");
      void icon.offsetWidth;
      icon.classList.add("animate-pop");
    }
  };

  const showBigHeart = (x, y) => {
    bigHeart.style.left = `${x}px`;
    bigHeart.style.top = `${y}px`;
    bigHeart.classList.remove("active");
    void bigHeart.offsetWidth;
    bigHeart.classList.add("active");
    if (likeBtn && !likeBtn.classList.contains("liked")) {
      toggleLike();
    }
  };

  if (likeBtn) {
    likeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleLike();
    });
  }

  // --- 7. Mute / Unmute Logic ---
  function updateMuteUI(muted) {
    if (!video) return;
    video.muted = muted;
    if (muteBtn) {
      const icon = muteBtn.querySelector("i");
      if (muted) {
        if (icon) icon.className = "fas fa-volume-mute animate-pop";
        muteBtn.style.opacity = "0.5";
      } else {
        if (icon) icon.className = "fas fa-volume-up animate-pop";
        muteBtn.style.opacity = "1";
      }
    }
  }

  function toggleAudio() {
    if (!video) return;
    const nextState = !video.muted;
    localStorage.setItem("videoMuted", nextState.toString());
    updateMuteUI(nextState);
  }

  if (muteBtn) {
    muteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleAudio();
    });
  }

  const savedAudioPreference = localStorage.getItem("videoMuted");
  if (savedAudioPreference === null) {
    localStorage.setItem("videoMuted", "true");
    updateMuteUI(true);
  } else {
    updateMuteUI(savedAudioPreference === "true");
  }

  // --- 8. Click Video Interaction ---
  if (videoContainer && video) {
    videoContainer.addEventListener("click", (e) => {
      if (
        e.target.closest(".side-bar") ||
        e.target.closest(".video-player-controls") ||
        e.target.closest(".top-nav") ||
        e.target.closest(".bottom-info") ||
        e.target.closest(".wa-overlay")
      ) {
        return;
      }

      let currentTime = new Date().getTime();
      let tapLength = currentTime - lastTap;
      if (tapLength < 300 && tapLength > 0) {
        showBigHeart(e.clientX, e.clientY);
        lastTap = currentTime;
        return;
      }
      lastTap = currentTime;

      if (video.paused) {
        video.play();
        spawnFeedbackIcon("fa-play");
      }
    });
  }

  function spawnFeedbackIcon(iconClass) {
    if (!videoContainer) return;
    const icon = document.createElement("div");
    icon.className = "feedback-icon";
    icon.innerHTML = `<i class="fas ${iconClass}"></i>`;
    videoContainer.appendChild(icon);
    setTimeout(() => icon.remove(), 600);
  }

  // --- 9. Pure Video Download Feature ---
  if (downloadBtn) {
    downloadBtn.addEventListener("click", async (e) => {
      e.stopPropagation();

      const icon = downloadBtn.querySelector("i");
      if (icon) {
        icon.classList.add("animate-pop");
        setTimeout(() => icon.classList.remove("animate-pop"), 400);
      }

      const downloadSource = currentVideoDirectUrl || video.src;

      try {
        const response = await fetch(downloadSource);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = `video_${new Date().getTime()}.mp4`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
      } catch (error) {
        console.error("Download failed:", error);
        window.open(downloadSource, "_blank");
      }
    });
  }

  // --- 10. Navigation & Swipe Handling ---
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
    let touchendY = e.changedTouches[0].screenY;
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

  // --- 11. Video Progress Bar Controls ---
  const progressBar = document.querySelector(".video-progress-bar");
  const progressFill = document.querySelector(".progress-fill");

  if (video && progressBar && progressFill) {
    video.addEventListener("loadedmetadata", () => {
      progressBar.max = video.duration;
    });

    video.addEventListener("timeupdate", () => {
      if (!video.duration) return;
      const percent = (video.currentTime / video.duration) * 100;
      progressBar.value = video.currentTime;
      progressFill.style.width = percent + "%";
    });

    progressBar.addEventListener("input", () => {
      video.currentTime = progressBar.value;
      const percent = (progressBar.value / progressBar.max) * 100;
      progressFill.style.width = percent + "%";
    });
  }

  // --- 12. WhatsApp Overlay Tracker ---
  const markWhatsAppJoined = () => {
    localStorage.setItem("whatsappJoined", "true");
  };

  const sidebarWhatsAppBtn = document.querySelector(".whatsapp-btn");
  if (sidebarWhatsAppBtn) {
    sidebarWhatsAppBtn.addEventListener("click", markWhatsAppJoined);
  }

  const hasJoined = localStorage.getItem("whatsappJoined") === "true";

  if (!hasJoined) {
    const today = new Date().toDateString();
    const lastDate = localStorage.getItem("waLastDate");
    if (lastDate !== today) {
      localStorage.setItem("waLastDate", today);
      localStorage.setItem("waDailyIgnores", "0");
    }

    let dailyIgnores = parseInt(
      localStorage.getItem("waDailyIgnores") || "0",
      10,
    );
    let maxDailyLimit = parseInt(
      sessionStorage.getItem("waMaxLimit") || "0",
      10,
    );

    if (!maxDailyLimit) {
      maxDailyLimit = Math.floor(Math.random() * 4) + 3;
      sessionStorage.setItem("waMaxLimit", maxDailyLimit.toString());
    }

    let waPageViews =
      parseInt(sessionStorage.getItem("waPageViews") || "0", 10) + 1;
    sessionStorage.setItem("waPageViews", waPageViews.toString());

    let waTargetViews = parseInt(
      sessionStorage.getItem("waTargetViews") || "0",
      10,
    );
    if (!waTargetViews) {
      waTargetViews = Math.floor(Math.random() * 3) + 3;
      sessionStorage.setItem("waTargetViews", waTargetViews.toString());
    }

    if (dailyIgnores < maxDailyLimit && waPageViews >= waTargetViews) {
      const overlay = document.getElementById("wa-popup-overlay");
      const modalBtn = document.getElementById("wa-modal-join-btn");
      const progressFill = document.getElementById("wa-progress-bar-fill");

      if (overlay && modalBtn && progressFill) {
        const durationSec = Math.floor(Math.random() * 8) + 5;
        const durationMs = durationSec * 1000;

        overlay.classList.add("active");

        let startTime = null;
        let animationFrame = null;

        const updateProgress = (timestamp) => {
          if (!startTime) startTime = timestamp;
          const elapsed = timestamp - startTime;
          const remainingPercent = Math.max(
            0,
            100 - (elapsed / durationMs) * 100,
          );

          progressFill.style.width = remainingPercent + "%";

          if (elapsed < durationMs) {
            animationFrame = requestAnimationFrame(updateProgress);
          } else {
            overlay.classList.remove("active");
            dailyIgnores++;
            localStorage.setItem("waDailyIgnores", dailyIgnores.toString());
            sessionStorage.setItem("waPageViews", "0");
            sessionStorage.setItem(
              "waTargetViews",
              (Math.floor(Math.random() * 3) + 3).toString(),
            );
          }
        };

        animationFrame = requestAnimationFrame(updateProgress);

        modalBtn.addEventListener("click", () => {
          if (animationFrame) cancelAnimationFrame(animationFrame);
          markWhatsAppJoined();
          overlay.classList.remove("active");
        });
      }
    }
  }

  // --- 13. Notification Opt-In Bottom Banner Card ---
  const notifyBanner = document.getElementById("notify-banner");
  const notifyClose = document.getElementById("notify-banner-close");
  const notifyCta = document.getElementById("notify-banner-cta");

  if (notifyBanner) {
    const dismissed =
      localStorage.getItem("notificationBannerDismissed") === "true";

    const dismissBanner = () => {
      notifyBanner.classList.remove("show");
      notifyBanner.classList.add("hide");
      localStorage.setItem("notificationBannerDismissed", "true");
      setTimeout(() => notifyBanner.remove(), 500);
    };

    if (!dismissed) {
      setTimeout(() => {
        if (document.body.contains(notifyBanner)) {
          notifyBanner.classList.add("show");
        }
      }, 1200);
    }

    if (notifyClose) {
      notifyClose.addEventListener("click", (e) => {
        e.stopPropagation();
        dismissBanner();
      });
    }

    if (notifyCta) {
      notifyCta.addEventListener("click", (e) => {
        e.stopPropagation();
        dismissBanner();
      });
    }
  }
});