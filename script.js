import { loadVideosFromFirestore, getNextVideo, getCurrentVideo, getAllVideos, jumpToIndex, persistLike, getComments, postComment, getFeedMode, setFeedMode, formatCount, USERNAMES } from "./vid.js";

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

// ---------- device-local helpers (no backend needed) ----------
function readJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    return v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function getDeviceName() {
  let name = localStorage.getItem("shortxx_name");
  if (!name) {
    name = USERNAMES[Math.floor(Math.random() * USERNAMES.length)] + Math.floor(Math.random() * 99);
    localStorage.setItem("shortxx_name", name);
  }
  return name;
}

document.addEventListener("DOMContentLoaded", async () => {
  // --- 1. Firestore Video Fetching & Preload ---
  await loadVideosFromFirestore();

  const video = document.getElementById("main-video");
  const playerRegion = document.getElementById("player-region");

  if (video) {
    playNextVideo(video);
  }
  const current = getCurrentVideo();
  const videoId = current && current.id ? current.id : null;
  const creator = current && current.creator ? current.creator : "User";

  // --- 2. Element Selectors (NudiTok DOM hooks) ---
  const likeBtn = document.querySelector(".like-btn");
  const likeHeart = document.querySelector(".like-heart");
  const likeCountEl = document.querySelector(".like-count");
  const muteBtns = document.querySelectorAll(".mute-btn");
  const unmuteHint = document.getElementById("unmute-hint");
  const unmuteDismiss = document.getElementById("unmute-dismiss");
  const shareBtn = document.getElementById("share-btn");
  const fsBtn = document.getElementById("fs-btn");
  const progressWrap = document.getElementById("ntok-progress");
  const progressFill = document.getElementById("ntok-progress-fill");
  const followBtn = document.querySelector(".follow-btn");
  const commentsBtn = document.querySelector(".comments-btn");
  const commentsCountEl = document.querySelector(".comments-count");
  const saveBtn = document.querySelector(".save-btn");
  const saveCountEl = document.querySelector(".save-count");
  const menuBtn = document.getElementById("menu-btn");
  const moreBtn = document.getElementById("more-btn");
  const feedBtn = document.getElementById("feed-btn");
  const feedLabel = document.getElementById("feed-label");
  const searchBtns = document.querySelectorAll(".search-btn");
  const discoverLinks = document.querySelectorAll(".discover-link");
  const toastList = document.querySelector('[role="region"][aria-label^="Notifications"] ol');

  // --- 3. Toast helper (uses the existing notification region) ---
  function toast(msg) {
    if (!toastList) return;
    const li = document.createElement("li");
    li.style.cssText = "pointer-events:auto;background:rgba(20,20,20,0.95);border:1px solid #2f2f2f;color:#fff;font-size:13px;font-weight:600;padding:10px 14px;border-radius:12px;margin-top:8px;box-shadow:0 8px 24px rgba(0,0,0,0.5);";
    li.textContent = msg;
    toastList.appendChild(li);
    setTimeout(() => {
      li.style.transition = "opacity 0.3s";
      li.style.opacity = "0";
      setTimeout(() => li.remove(), 320);
    }, 2200);
  }

  // --- 4. Creator / real counts ---
  const userNameElement = document.querySelector(".dynamic-username");
  if (userNameElement) userNameElement.textContent = creator;

  if (likeCountEl) likeCountEl.textContent = formatCount(current ? current.likes : 0);

  const likedMap = readJson("shortxx_liked", {});
  const savedIds = readJson("shortxx_saved", []);
  const follows = readJson("shortxx_follows", []);

  function paintLike() {
    const liked = !!likedMap[videoId];
    if (likeBtn) {
      likeBtn.setAttribute("aria-pressed", String(liked));
      likeBtn.setAttribute("aria-label", liked ? "Unlike" : "Like");
    }
    if (likeHeart) {
      likeHeart.classList.toggle("text-white", !liked);
      likeHeart.classList.toggle("text-primary", liked);
    }
  }
  paintLike();

  function paintFollow() {
    if (!followBtn) return;
    const following = follows.includes(creator);
    followBtn.setAttribute("aria-label", following ? "Following" : "Follow");
    const badge = followBtn.querySelector("span");
    if (badge) badge.style.background = following ? "#25f4ee" : "";
    followBtn.innerHTML = following
      ? '<span class="w-5 h-5 rounded-full flex items-center justify-center shadow-md" style="background:#25f4ee"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>'
      : '<span class="follow-badge-pulse w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow-md shadow-primary/40"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"><line x1="12" y1="6" x2="12" y2="18"></line><line x1="6" y1="12" x2="18" y2="12"></line></svg></span>';
  }
  paintFollow();

  function paintSave() {
    const saved = savedIds.includes(videoId);
    if (saveBtn) {
      saveBtn.setAttribute("aria-label", saved ? "Unsave" : "Save");
      const svg = saveBtn.querySelector("svg");
      if (svg) svg.style.color = saved ? "#facc15" : "";
    }
    if (saveCountEl) saveCountEl.textContent = saved ? "1" : "0";
  }
  paintSave();

  // --- 5. Like (persisted to Firestore) ---
  let lastTap = 0;

  const toggleLike = () => {
    if (!videoId) return;
    const liked = !likedMap[videoId];
    if (liked) likedMap[videoId] = true;
    else delete likedMap[videoId];
    localStorage.setItem("shortxx_liked", JSON.stringify(likedMap));
    if (current) current.likes = Math.max(0, (current.likes || 0) + (liked ? 1 : -1));
    if (likeCountEl) likeCountEl.textContent = formatCount(current ? current.likes : 0);
    paintLike();
    persistLike(videoId, liked);
  };

  const showBigHeart = (x, y) => {
    const heart = document.createElement("div");
    heart.setAttribute("aria-hidden", "true");
    heart.innerHTML =
      '<svg width="96" height="96" viewBox="0 0 24 24" fill="#fe2c55" stroke="none" style="filter:drop-shadow(0 4px 12px rgba(0,0,0,0.5))"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>';
    heart.style.cssText =
      "position:fixed;left:" + x + "px;top:" + y + "px;transform:translate(-50%,-50%) scale(0);opacity:0;z-index:80;pointer-events:none;transition:transform 0.25s ease-out,opacity 0.4s ease-out;";
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
    if (!likedMap[videoId]) toggleLike();
  };

  if (likeBtn) {
    likeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleLike();
    });
  }

  // --- 6. Follow (per-device) ---
  if (followBtn) {
    followBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const i = follows.indexOf(creator);
      if (i >= 0) {
        follows.splice(i, 1);
        toast("Unfollowed @" + creator);
      } else {
        follows.push(creator);
        toast("Following @" + creator);
      }
      localStorage.setItem("shortxx_follows", JSON.stringify(follows));
      paintFollow();
    });
  }

  // --- 7. Save (per-device) ---
  if (saveBtn) {
    saveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const i = savedIds.indexOf(videoId);
      if (i >= 0) {
        savedIds.splice(i, 1);
        toast("Removed from Saved");
      } else {
        savedIds.push(videoId);
        toast("Saved — find it in Menu > Saved");
      }
      localStorage.setItem("shortxx_saved", JSON.stringify(savedIds));
      paintSave();
    });
  }

  // --- 8. Comments drawer (shared via events collection) ---
  let commentsSheet = null;
  let commentsListEl = null;
  let commentsTitleEl = null;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function buildCommentsSheet() {
    if (commentsSheet) return commentsSheet;
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;inset:0;z-index:90;display:none;";
    wrap.innerHTML =
      '<div data-close style="position:absolute;inset:0;background:rgba(0,0,0,0.6);"></div>' +
      '<div role="dialog" aria-label="Comments" style="position:absolute;left:0;right:0;bottom:0;max-width:480px;margin:0 auto;background:#121212;border-top:1px solid #2f2f2f;border-radius:16px 16px 0 0;max-height:75vh;display:flex;flex-direction:column;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #2f2f2f;">' +
      '<div data-title style="color:#fff;font-size:15px;font-weight:700;">Comments (0)</div>' +
      '<button data-close aria-label="Close comments" style="color:#8a8a8a;font-size:20px;line-height:1;padding:4px 8px;">✕</button>' +
      "</div>" +
      '<div data-list style="overflow-y:auto;padding:12px 16px;flex:1;min-height:120px;"></div>' +
      '<form data-form style="display:flex;gap:8px;padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid #2f2f2f;">' +
      '<input data-input maxlength="300" placeholder="Add a comment…" autocomplete="off" style="flex:1;background:#1e1e1e;border:1px solid #2f2f2f;color:#fff;font-size:14px;border-radius:999px;padding:10px 14px;outline:none;" />' +
      '<button type="submit" style="background:#fe2c55;color:#fff;font-size:14px;font-weight:700;border-radius:999px;padding:10px 18px;">Post</button>' +
      "</form></div>";
    document.body.appendChild(wrap);
    commentsSheet = wrap;
    commentsListEl = wrap.querySelector("[data-list]");
    commentsTitleEl = wrap.querySelector("[data-title]");
    wrap.querySelectorAll("[data-close]").forEach((el) =>
      el.addEventListener("click", () => {
        wrap.style.display = "none";
      }),
    );
    wrap.querySelector("[data-form]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = wrap.querySelector("[data-input]");
      const id = await postComment(videoId, getDeviceName(), input.value);
      if (id) {
        input.value = "";
        await refreshComments();
      } else {
        toast("Could not post — check connection");
      }
    });
    return wrap;
  }

  async function refreshComments() {
    const list = await getComments(videoId);
    if (commentsTitleEl) commentsTitleEl.textContent = "Comments (" + list.length + ")";
    if (commentsCountEl) commentsCountEl.textContent = formatCount(list.length);
    if (commentsListEl) {
      commentsListEl.innerHTML = list.length
        ? list.map((c) =>
            '<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #1e1e1e;">' +
            '<div style="flex:none;width:32px;height:32px;border-radius:50%;background:#2a2a2a;color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;">' + esc((c.name || "?").slice(0, 1).toUpperCase()) + "</div>" +
            '<div style="min-width:0;"><div style="color:#fff;font-size:13px;font-weight:700;">' + esc(c.name) + "</div>" +
            '<div style="color:#e8e8e8;font-size:14px;line-height:20px;overflow-wrap:anywhere;">' + esc(c.text) + "</div></div></div>",
          ).join("")
        : '<div style="color:#8a8a8a;font-size:14px;text-align:center;padding:24px 0;">No comments yet — be the first.</div>';
      commentsListEl.scrollTop = commentsListEl.scrollHeight;
    }
  }

  if (commentsBtn) {
    commentsBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      buildCommentsSheet().style.display = "";
      if (commentsListEl) commentsListEl.innerHTML = '<div style="color:#8a8a8a;font-size:14px;text-align:center;padding:24px 0;">Loading…</div>';
      await refreshComments();
    });
  }
  // Paint rail comment count on load (sheet stays hidden).
  refreshComments();

  // --- 9. Discover overlay (grid + search + filters) ---
  let discoverSheet = null;
  function buildDiscoverSheet() {
    if (discoverSheet) return discoverSheet;
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;inset:0;z-index:90;display:none;background:#000;";
    wrap.innerHTML =
      '<div style="max-width:480px;margin:0 auto;height:100%;display:flex;flex-direction:column;">' +
      '<div style="display:flex;align-items:center;gap:8px;padding:calc(12px + env(safe-area-inset-top,0px)) 12px 12px;">' +
      '<button data-close aria-label="Close discover" style="color:#fff;font-size:20px;padding:4px 8px;">✕</button>' +
      '<input data-q placeholder="Search creators…" autocomplete="off" style="flex:1;background:#1e1e1e;border:1px solid #2f2f2f;color:#fff;font-size:14px;border-radius:999px;padding:10px 14px;outline:none;" />' +
      "</div>" +
      '<div data-chips style="display:flex;gap:8px;padding:0 12px 12px;"></div>' +
      '<div data-grid style="flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(3,1fr);gap:2px;padding:0 2px calc(12px + env(safe-area-inset-bottom,0px));align-content:start;"></div>' +
      "</div>";
    document.body.appendChild(wrap);
    discoverSheet = wrap;
    let filter = "all";
    const chipsEl = wrap.querySelector("[data-chips]");
    const gridEl = wrap.querySelector("[data-grid]");
    const qEl = wrap.querySelector("[data-q]");

    function paintChips() {
      const defs = [["all", "All"], ["following", "Following"], ["saved", "Saved"]];
      chipsEl.innerHTML = "";
      defs.forEach(([key, label]) => {
        const b = document.createElement("button");
        b.textContent = label;
        b.style.cssText = "font-size:13px;font-weight:700;border-radius:999px;padding:8px 16px;" + (filter === key ? "background:#fe2c55;color:#fff;" : "background:#1e1e1e;color:#a0a0a0;");
        b.addEventListener("click", () => {
          filter = key;
          paintChips();
          paintGrid();
        });
        chipsEl.appendChild(b);
      });
    }

    function paintGrid() {
      const q = (qEl.value || "").trim().toLowerCase();
      const pool = getAllVideos();
      const fols = readJson("shortxx_follows", []);
      const sav = readJson("shortxx_saved", []);
      gridEl.innerHTML = "";
      let shown = 0;
      pool.forEach((v, i) => {
        if (filter === "following" && !fols.includes(v.creator)) return;
        if (filter === "saved" && !sav.includes(v.id)) return;
        if (q && !(v.creator || "").toLowerCase().includes(q) && !(v.id || "").toLowerCase().includes(q)) return;
        shown++;
        const cell = document.createElement("button");
        cell.style.cssText = "position:relative;aspect-ratio:3/4;background:#121212;overflow:hidden;border:none;padding:0;";
        cell.setAttribute("aria-label", "Play video by @" + v.creator);
        const thumb = v.posterUrl
          ? '<img src="' + esc(v.posterUrl) + '" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;" />'
          : '<video src="' + esc(v.url) + '" muted playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover;"></video>';
        cell.innerHTML =
          thumb +
          '<span style="position:absolute;left:0;right:0;bottom:0;padding:14px 6px 6px;background:linear-gradient(transparent,rgba(0,0,0,0.8));color:#fff;font-size:11px;font-weight:700;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">@' + esc(v.creator) + " · " + esc(formatCount(v.views)) + "</span>";
        cell.addEventListener("click", () => {
          sessionStorage.setItem("shortxx_pick", v.id);
          location.reload();
        });
        gridEl.appendChild(cell);
      });
      if (!shown) {
        gridEl.innerHTML = '<div style="grid-column:1/-1;color:#8a8a8a;font-size:14px;text-align:center;padding:32px 0;">' +
          (filter === "following" ? "Follow creators to fill this feed." : filter === "saved" ? "Nothing saved yet — tap Save on any video." : "No videos match.") + "</div>";
      }
    }

    qEl.addEventListener("input", paintGrid);
    wrap.querySelector("[data-close]").addEventListener("click", () => {
      wrap.style.display = "none";
    });
    wrap._open = (f) => {
      if (f) filter = f;
      paintChips();
      paintGrid();
      wrap.style.display = "";
    };
    return wrap;
  }

  function openDiscover(filter) {
    buildDiscoverSheet()._open(filter || "all");
  }

  searchBtns.forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    openDiscover("all");
    const q = discoverSheet.querySelector("[data-q]");
    if (q) setTimeout(() => q.focus(), 50);
  }));
  discoverLinks.forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    openDiscover("all");
  }));

  // --- 10. Menu drawer + feed switcher ---
  let menuSheet = null;
  function buildMenuSheet() {
    if (menuSheet) return menuSheet;
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;inset:0;z-index:90;display:none;";
    const row = (label, hint) =>
      '<div style="display:flex;align-items:center;justify-content:space-between;width:100%;color:#fff;font-size:15px;font-weight:600;padding:14px 4px;">' + label +
      (hint ? '<span style="color:#8a8a8a;font-size:12px;">' + hint + "</span>" : "") + "</div>";
    wrap.innerHTML =
      '<div data-close style="position:absolute;inset:0;background:rgba(0,0,0,0.6);"></div>' +
      '<div role="dialog" aria-label="Menu" style="position:absolute;top:0;bottom:0;left:0;width:min(320px,85vw);background:#121212;border-right:1px solid #2f2f2f;padding:calc(16px + env(safe-area-inset-top,0px)) 16px 16px;overflow-y:auto;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
      '<div style="color:#fff;font-size:17px;font-weight:800;">Shortxx</div>' +
      '<button data-close aria-label="Close menu" style="color:#8a8a8a;font-size:20px;padding:4px 8px;">✕</button></div>' +
      '<button data-go="home" style="width:100%;text-align:left;background:none;border:none;">' + row("🏠 Home") + "</button>" +
      '<button data-go="discover" style="width:100%;text-align:left;background:none;border:none;">' + row("🔍 Discover") + "</button>" +
      '<button data-go="following" style="width:100%;text-align:left;background:none;border:none;">' + row("👥 Following feed") + "</button>" +
      '<button data-go="top" style="width:100%;text-align:left;background:none;border:none;">' + row("🔥 Top videos") + "</button>" +
      '<button data-go="saved" style="width:100%;text-align:left;background:none;border:none;">' + row("🔖 Saved videos") + "</button>" +
      '<div style="height:1px;background:#2f2f2f;margin:8px 0;"></div>' +
      '<a href="https://shrinkme.click/doodstreams" target="_blank" rel="noopener" style="display:block;text-decoration:none;">' + row("🚀 AI Porn") + "</a>" +
      '<a href="https://shrinkme.click/doodstreams" target="_blank" rel="noopener" style="display:block;text-decoration:none;">' + row("❤️‍🔥 Dating") + "</a>" +
      "</div>";
    document.body.appendChild(wrap);
    menuSheet = wrap;
    wrap.querySelectorAll("[data-close]").forEach((el) =>
      el.addEventListener("click", () => {
        wrap.style.display = "none";
        if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
      }),
    );
    wrap.querySelectorAll("[data-go]").forEach((el) =>
      el.addEventListener("click", () => {
        const go = el.getAttribute("data-go");
        wrap.style.display = "none";
        if (go === "home") location.href = "./index.html";
        else if (go === "discover") openDiscover("all");
        else if (go === "saved") openDiscover("saved");
        else if (go === "following" || go === "top") switchFeed(go);
      }),
    );
    return wrap;
  }

  function openMenu() {
    buildMenuSheet().style.display = "";
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "true");
  }

  if (menuBtn) menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menuSheet && menuSheet.style.display !== "none") {
      menuSheet.style.display = "none";
      menuBtn.setAttribute("aria-expanded", "false");
    } else openMenu();
  });
  if (moreBtn) moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openMenu();
  });

  const FEED_NAMES = { foryou: "For You", following: "Following", top: "Top" };
  function paintFeedLabel() {
    if (feedLabel) feedLabel.textContent = FEED_NAMES[getFeedMode()] || "For You";
    if (feedBtn) feedBtn.setAttribute("aria-label", "Change feed, currently " + (FEED_NAMES[getFeedMode()] || "For You"));
  }
  paintFeedLabel();

  function switchFeed(mode) {
    if (mode === "following" && readJson("shortxx_follows", []).length === 0) {
      toast("Follow creators to fill this feed");
    }
    setFeedMode(mode);
    location.reload();
  }

  let feedMenu = null;
  function toggleFeedMenu() {
    if (feedMenu) {
      feedMenu.remove();
      feedMenu = null;
      if (feedBtn) feedBtn.setAttribute("aria-expanded", "false");
      return;
    }
    feedMenu = document.createElement("div");
    feedMenu.setAttribute("role", "menu");
    feedMenu.style.cssText = "position:fixed;top:calc(3.5rem + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);z-index:95;background:#1e1e1e;border:1px solid #2f2f2f;border-radius:12px;overflow:hidden;min-width:180px;box-shadow:0 12px 32px rgba(0,0,0,0.6);";
    ["foryou", "following", "top"].forEach((mode) => {
      const b = document.createElement("button");
      b.setAttribute("role", "menuitemradio");
      b.setAttribute("aria-checked", String(getFeedMode() === mode));
      b.style.cssText = "display:flex;align-items:center;justify-content:space-between;width:100%;background:none;border:none;color:#fff;font-size:14px;font-weight:600;padding:12px 16px;";
      b.innerHTML = "<span>" + FEED_NAMES[mode] + "</span><span>" + (getFeedMode() === mode ? "✓" : "") + "</span>";
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        switchFeed(mode);
      });
      feedMenu.appendChild(b);
    });
    document.body.appendChild(feedMenu);
    if (feedBtn) feedBtn.setAttribute("aria-expanded", "true");
    setTimeout(() => {
      document.addEventListener("click", function closer(e) {
        if (feedMenu && !feedMenu.contains(e.target)) {
          feedMenu.remove();
          feedMenu = null;
          if (feedBtn) feedBtn.setAttribute("aria-expanded", "false");
          document.removeEventListener("click", closer);
        }
      });
    }, 0);
  }

  if (feedBtn) {
    feedBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFeedMenu();
    });
  }

  // --- 11. Mute / Unmute Logic ---
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

  // --- 12. Tap Video Interaction (single tap = play, double tap = like) ---
  if (playerRegion && video) {    playerRegion.addEventListener("click", (e) => {
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

  // --- 13. Share (Web Share API with download fallback) ---
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

  // --- 14. Fullscreen Toggle ---
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

  // --- 15. Dead (visual-only) Controls ---
  document.querySelectorAll("[data-dead]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  // --- 16. Navigation & Swipe Handling (index.html <-> vid2.html) ---
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

  // --- 17. Video Progress Bar (seek + fill) ---
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
