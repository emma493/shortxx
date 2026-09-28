import { ensurePoolSize, formatCount, getAllVideos } from "../../vid.js";
import { store, writeJson } from "../store.js";
import { esc } from "../lib/dom.js";
import { saveUserProfile } from "../../vid.js";
import { thumbHTML, hydrateThumbVideos, registerVideos } from "../lib/thumb.js";
import { attachMenuClone } from "../lib/side-menu.js";

/* js/features/creator-page.js — 1:1 NudiTok profile page (refs/profile page).
 * In-feed overlay panel (opened programmatically); feed avatar + @username
 * are plain links to /creator/<name>/ static pages and navigate directly.
 * Overlay: ring avatar beside the handle, Share + Follow pills, display
 * name, 5-stat row (Posts/Followers/Following/Likes/Views), hashtag
 * pills, Videos header, 3-col 9/16 grid with play + heart counts. */

let root = null;
let panel = null;
let bodyEl = null;

function videosOf(name) {
  if (!name) return [];
  return getAllVideos().filter((v) => v.creator === name);
}

function paint(toast) {
  if (!bodyEl) return;
  const name = store.creator;
  const current = store.current;
  const list = videosOf(name).sort((a, b) => (b.createdAtMillis || 0) - (a.createdAtMillis || 0));
  const views = list.reduce((s, v) => s + (v.views || 0), 0);
  const likesSum = list.reduce((s, v) => s + (v.likes || 0), 0);
  const following = store.follows.includes(name);
  const avatar = current && current.avatarUrl ? current.avatarUrl : null;
  const initial = (name || "?").slice(0, 1).toUpperCase();

  // Reference order: Posts / Followers / Following / Likes / Views.
  const followers = current && typeof current.followers === "number" ? current.followers : likesSum;
  const followingCount = current && typeof current.following === "number" ? current.following : 0;
  const likesTotal = current && current.likesTotal != null ? current.likesTotal : likesSum;

  const tagCounts = new Map();
  list.forEach((v) =>
    (v.hashtags || []).forEach((t) => {
      const clean = String(t || "").trim().replace(/^#+/, "");
      const k = clean.toLowerCase();
      if (k) tagCounts.set(k, { tag: clean, n: (tagCounts.get(k) || { n: 0 }).n + 1 });
    }),
  );
  const topTags = [...tagCounts.values()].sort((a, b) => b.n - a.n).slice(0, 8).map((e) => e.tag);

  bodyEl.innerHTML =
    '<div class="cp-body">' +
    '<div class="cp-head">' +
    '<div class="cp-ring"><div class="cp-ring-inner">' +
    (avatar
      ? '<img src="' + esc(avatar) + '" alt="' + esc(name || "") + '" />'
      : '<div class="cp-avatar-fallback">' + esc(initial) + "</div>") +
    "</div></div>" +
    '<div class="cp-head-info">' +
    '<h1 class="cp-name">@' + esc(name || "shortxx") + "</h1>" +
    '<p class="cp-display">' + esc((current && current.displayName) || name || "Shortxx") + "</p>" +
    '<div class="cp-actions">' +
    '<button class="cp-share" data-share aria-label="Share"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg><span>Share</span></button>' +
    '<button class="cp-follow' + (following ? " following" : "") + '" aria-label="Follow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg><span>' + (following ? "Following" : "Follow") + "</span></button>" +
    "</div>" +
    "</div>" +
    "</div>" +
    '<div class="cp-stats">' +
    '<div class="cp-stat"><b>' + esc(formatCount(list.length)) + "</b><span>Posts</span></div>" +
    '<div class="cp-stat"><b>' + esc(formatCount(followers)) + "</b><span>Followers</span></div>" +
    '<div class="cp-stat"><b>' + esc(formatCount(followingCount)) + "</b><span>Following</span></div>" +
    '<div class="cp-stat"><b>' + esc(formatCount(likesTotal)) + "</b><span>Likes</span></div>" +
    '<div class="cp-stat"><b>' + esc(formatCount(views)) + "</b><span>Views</span></div>" +
    "</div>" +
    (current && current.bio ? '<div class="cp-bio">' + esc(current.bio) + "</div>" : "") +
    (topTags.length
      ? '<div class="cp-tags">' +
        topTags.map((t) => '<button class="cp-tagpill" data-tag="' + esc(t) + '">#' + esc(t) + "</button>").join("") +
        "</div>"
      : "") +
    "</div>" +
    '<div class="cp-videos"><div class="cp-videos-head"><div class="cp-videos-title">Videos</div></div>' +
    '<div class="cp-grid">' +
    (list.length
      ? list
          .map(
            (v) =>
              '<button class="cp-tile" data-vid="' + esc(v.id) + '" aria-label="Play video">' +
              thumbHTML(v, "") +
              '<span class="cp-tile-cap"><span><svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"></path></svg>' +
              esc(formatCount(v.views)) + "</span><span><svg viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5\"></path></svg>" +
              esc(formatCount(v.likes)) + "</span></span></button>",
          )
          .join("")
      : '<div class="cp-empty">No videos yet.</div>') +
    "</div></div>";

  const av = bodyEl.querySelector(".cp-ring-inner img");
  if (av) {
    av.onerror = () => {
      av.outerHTML = '<div class="cp-avatar-fallback">' + esc(initial) + "</div>";
    };
  }

  const fBtn = bodyEl.querySelector(".cp-follow");
  if (fBtn) {
    fBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const i = store.follows.indexOf(name);
      if (i >= 0) {
        store.follows.splice(i, 1);
        toast("Unfollowed @" + name);
      } else {
        store.follows.push(name);
        toast("Following @" + name);
      }
      writeJson("shortxx_follows", store.follows);
      if (store.authUser && store.authUser.uid) {
        saveUserProfile(store.authUser.uid, {
          liked: Object.keys(store.likedMap),
          saved: store.savedIds,
          follows: store.follows,
        });
      }
      window.dispatchEvent(new CustomEvent("sx:profile-synced"));
      paint(toast);
    });
  }

  const sBtn = bodyEl.querySelector("[data-share]");
  if (sBtn) {
    sBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const url = location.origin + "/creator/" + encodeURIComponent(name || "") + "/";
      try {
        if (navigator.share) {
          await navigator.share({ title: "@" + name, url });
          return;
        }
        await navigator.clipboard.writeText(url);
        toast("Profile link copied");
      } catch (err) {
        toast("Share @" + name);
      }
    });
  }

  bodyEl.querySelectorAll("[data-vid]").forEach((tile) => {
    tile.addEventListener("click", () => {
      try {
        sessionStorage.setItem("shortxx_pick", tile.getAttribute("data-vid"));
      } catch (e) {}
      location.reload();
    });
  });

  bodyEl.querySelectorAll("[data-tag]").forEach((pill) => {
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = pill.getAttribute("data-tag");
      close();
      if (window.sxOpenDiscover) {
        window.sxOpenDiscover("all");
        // Pre-fill happens on next frame once the sheet exists.
        requestAnimationFrame(() => {
          const q = document.querySelector(".sx-d-q");
          if (q) {
            q.value = "#" + String(t || "").trim().replace(/^#+/, "");
            q.dispatchEvent(new Event("input", { bubbles: true }));
          }
        });
      }
    });
  });

  // Paint real first-frames for videos lacking poster_url.
  try {
    registerVideos(getAllVideos());
    try { void ensurePoolSize(48); } catch (e) {}
  } catch (e) {}
  try {
    hydrateThumbVideos(bodyEl);
  } catch (e) {}
}

function open(toast) {
  if (!panel || !store.linkedCreator || !store.creator) return;
  paint(toast);
  root.style.display = "";
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      panel.classList.add("active");
    });
  });
}

function close() {
  if (!root || root.style.display === "none") return;
  panel.classList.remove("active");
  document.body.style.overflow = "";
  setTimeout(() => {
    if (root) root.style.display = "none";
  }, 300);
}

export async function init(ctx) {
  const toast = ctx.toast || (() => {});
  if (root) return;

  root = document.createElement("div");
  root.style.display = "none";
  root.innerHTML =
    '<div class="cp-backdrop" data-close></div>' +
    '<div class="cp-panel" role="dialog" aria-label="Creator profile"><div class="cp-centered">' +
    '<button class="cp-back" data-close aria-label="Go back"><span class="sx-back-arrow" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg></span><span>Back to feed</span></button>' +
    '<button class="cp-menu" data-menu aria-label="Open menu" title="Menu"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg></button>' +
    '<div class="cp-body-wrap" data-body></div></div></div>';
  document.body.appendChild(root);
  panel = root.querySelector(".cp-panel");
  bodyEl = root.querySelector("[data-body]");
  root.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", close));
  // FIXED side menu clone: IDENTICAL items to index.html drawer.
  // NOTE: attached to document.body (not inside .cp-panel) because the
  // panel uses transform:translateX — fixed children would misposition.
  let cloneMenu = null;
  try {
    cloneMenu = attachMenuClone(document.body, { toast });
    cloneMenu.root.style.zIndex = "1200";
  } catch (e) { cloneMenu = null; }
  const cpMenuBtn = root.querySelector("[data-menu]");
  if (cpMenuBtn) {
    cpMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (cloneMenu) { cloneMenu.open(); return; }
      if (window.sxOpenMenu) window.sxOpenMenu();
      else if (window.sxToggleMenu) window.sxToggleMenu();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  window.sxCloseCreator = close;

  // NOTE: feed avatar + @username are plain <a href="/creator/<name>/">
  // links (set per video in js/features/creator.js) pointing at static
  // profile folders — no JS navigation here, so taps can never hit a
  // redirect loop. This delegated listener is intentionally gone.
  window.addEventListener("sx:video-changed", () => {
    if (root.style.display !== "none") paint(toast);
  });
  // Real-data pipeline: if profile opened before Firestore pool arrived,
  // repaint with real videos + counts as soon as they land.
  window.addEventListener("sx:videos-ready", () => {
    try {
      if (root.style.display !== "none") paint(toast);
    } catch (e) {}
  });
}
