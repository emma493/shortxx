import { formatCount, getAllVideos } from "../../vid.js";
import { store, writeJson } from "../store.js";
import { esc } from "../lib/dom.js";
import { saveUserProfile } from "../../vid.js";

/* js/features/creator-page.js — TikTok-style creator page.
 * Opens from the right when the avatar or @name is tapped. Shows
 * avatar, stats, follow button and the creator's video grid. */

let root = null;
let panel = null;
let backdrop = null;
let bodyEl = null;

function videosOf(name) {
  if (!name) return [];
  return getAllVideos().filter((v) => v.creator === name);
}

function paint(toast) {
  if (!bodyEl) return;
  const name = store.creator;
  const current = store.current;
  const list = videosOf(name);
  const views = list.reduce((s, v) => s + (v.views || 0), 0);
  const likes = list.reduce((s, v) => s + (v.likes || 0), 0);
  const following = store.follows.includes(name);
  const avatar = current && current.avatarUrl ? current.avatarUrl : null;

  bodyEl.innerHTML =
    '<div class="cp-id">' +
    (avatar
      ? '<img class="cp-avatar" src="' + esc(avatar) + '" alt="" />'
      : '<div class="cp-avatar-fallback">' + esc((name || "?").slice(0, 1).toUpperCase()) + "</div>") +
    '<div class="cp-name">' + esc(name || "Shortxx") + "</div>" +
    '<div class="cp-handle">@' + esc(name || "shortxx") + "</div>" +
    (current && current.bio ? '<div class="cp-bio">' + esc(current.bio) + "</div>" : "") +
    "</div>" +
    '<div class="cp-stats">' +
    '<div class="cp-stat"><b>' + esc(formatCount(list.length)) + "</b><span>Videos</span></div>" +
    '<div class="cp-stat"><b>' + esc(formatCount(likes)) + "</b><span>Likes</span></div>" +
    '<div class="cp-stat"><b>' + esc(formatCount(views)) + "</b><span>Views</span></div></div>" +
    '<button class="cp-follow' + (following ? " following" : "") + '">' +
    (following ? "Following" : "Follow") +
    "</button>" +
    '<div class="cp-tabs"><button class="cp-tab">Videos</button></div>' +
    '<div class="cp-grid">' +
    (list.length
      ? list
          .map(
            (v) =>
              '<button class="cp-tile" data-vid="' + esc(v.id) + '" aria-label="Play video">' +
              (v.posterUrl
                ? '<img src="' + esc(v.posterUrl) + '" alt="" loading="lazy" />'
                : '<div class="cp-tile-fallback">▶</div>') +
              '<span class="cp-tile-cap">▶ ' + esc(formatCount(v.views)) + "</span></button>",
          )
          .join("")
      : '<div class="cp-empty">No videos yet.</div>') +
    "</div>";

  const headName = root.querySelector("[data-cp-name]");
  if (headName) headName.textContent = "@" + (name || "shortxx");

  const av = bodyEl.querySelector(".cp-avatar");
  if (av) {
    av.onerror = () => {
      av.outerHTML =
        '<div class="cp-avatar-fallback">' + esc((name || "?").slice(0, 1).toUpperCase()) + "</div>";
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

  bodyEl.querySelectorAll("[data-vid]").forEach((tile) => {
    tile.addEventListener("click", () => {
      try {
        sessionStorage.setItem("shortxx_pick", tile.getAttribute("data-vid"));
      } catch (e) {}
      location.reload();
    });
  });
}

function open(toast) {
  if (!store.linkedCreator || !store.creator) return;
  paint(toast);
  root.style.display = "";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      backdrop.classList.add("active");
      panel.classList.add("active");
    });
  });
}

function close() {
  if (!root || root.style.display === "none") return;
  backdrop.classList.remove("active");
  panel.classList.remove("active");
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
    '<aside class="cp-panel" role="dialog" aria-label="Creator page">' +
    '<div class="cp-head"><button class="cp-back" data-close aria-label="Back">←</button>' +
    '<div class="cp-head-name" data-cp-name>@</div></div>' +
    '<div class="cp-body" data-body></div></aside>';
  document.body.appendChild(root);
  panel = root.querySelector(".cp-panel");
  backdrop = root.querySelector(".cp-backdrop");
  bodyEl = root.querySelector("[data-body]");
  root.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", close));
  window.sxCloseCreator = close;

  document.querySelectorAll("[data-creator]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      open(toast);
    });
  });
  window.addEventListener("sx:video-changed", () => {
    if (root.style.display !== "none") paint(toast);
  });
}
