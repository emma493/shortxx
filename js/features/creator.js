import { formatCount } from "../../vid.js";
import { store } from "../store.js";

/* Smartlink opened by the "See more" sponsor pill beside the @username.
 * Single constant so rotating the link later is a one-line change. */
const SMARTLINK_URL = "https://www.profitableratecpmnetwork.com/hdw3m5up?key=5bddf30019234b583460ad791a8a095d";

/* js/features/creator.js — linked-creator profile + per-video caption/hashtags.
 * Shows real picture + name when creatorLinked, else hides block.
 * Caption/hashtags come from Firestore (vid.js) and show for every video,
 * even unlinked ones — they describe the video, not the creator. */

function showInitial(avatarEl, initialEl) {
  if (avatarEl) avatarEl.style.display = "none";
  // Neutral dark dot while the avatar loads — no letter avatars.
  if (initialEl) {
    initialEl.textContent = "";
    initialEl.style.background = "#1e1e1e";
    initialEl.style.display = "flex";
  }
}

export async function init() {
  const profileBlock = document.querySelector(".creator-profile");
  const avatarLink = document.querySelector(".creator-profile a[data-creator]");
  const userLink = document.querySelector(".creator-link");
  const userNameElement = document.querySelector(".dynamic-username");
  const avatarEl = document.querySelector(".creator-avatar");
  const avatarInitial = document.querySelector(".creator-initial");
  const likeCountEl = document.querySelector(".like-count");
  const captionEl = document.querySelector("[data-caption]");
  const hashtagsEl = document.querySelector("[data-hashtags]");

  // TikTok-style: clamped to 2 lines, tap to expand/collapse full text.
  if (captionEl && !captionEl.dataset.wired) {
    captionEl.dataset.wired = "1";
    captionEl.style.cursor = "pointer";
    captionEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const expanded = captionEl.dataset.expanded === "1";
      captionEl.dataset.expanded = expanded ? "0" : "1";
      captionEl.style.display = "block";
      captionEl.style.webkitLineClamp = expanded ? "2" : "unset";
      captionEl.style.overflow = expanded ? "hidden" : "visible";
    });
  }

  // Sponsor pill: opens the smartlink in a new tab. stopPropagation keeps
  // player tap gestures (pause/like) out; shown regardless of link state.
  const seeMoreBtn = document.getElementById("sx-see-more");
  if (seeMoreBtn && !seeMoreBtn.dataset.wired) {
    seeMoreBtn.dataset.wired = "1";
    seeMoreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      try {
        window.open(SMARTLINK_URL, "_blank", "noopener");
      } catch (err) {}
    });
  }

  const paintCaption = () => {    const { current } = store;
    const caption =
      current && typeof current.caption === "string" ? current.caption.trim() : "";
    const tags =
      current && Array.isArray(current.hashtags)
        ? current.hashtags.filter((t) => typeof t === "string" && t.trim())
        : [];
    if (captionEl) {
      delete captionEl.dataset.expanded;
      if (caption) {
        captionEl.textContent = caption;
        captionEl.style.display = "-webkit-box";
        captionEl.style.webkitLineClamp = "2";
        captionEl.style.overflow = "hidden";
      } else {
        captionEl.textContent = "";
        captionEl.style.display = "none";
      }
    }
    if (hashtagsEl) {
      if (tags.length) {
        hashtagsEl.textContent = tags
          .map((t) => (t.trim().startsWith("#") ? t.trim() : "#" + t.trim()))
          .join(" ");
        hashtagsEl.style.display = "-webkit-box";
      } else {
        hashtagsEl.textContent = "";
        hashtagsEl.style.display = "none";
      }
    }
  };

  const paint = () => {
    const { current, creator, linkedCreator } = store;
    if (profileBlock) profileBlock.style.display = linkedCreator ? "" : "none";
    if (userLink) userLink.style.display = linkedCreator ? "" : "none";
    if (linkedCreator) {
      if (userNameElement) userNameElement.textContent = creator;
      // Plain hrefs to the static profile page — no JS navigation, so the
      // tap can never land in a redirect loop. Folders are generated per
      // creator by tools/generate-creator-pages.mjs.
      try {
        const url = "/creator/" + encodeURIComponent(creator) + "/";
        if (avatarLink) avatarLink.setAttribute("href", url);
        if (userLink) userLink.setAttribute("href", url);
      } catch (e) {}
      if (current && current.avatarUrl && avatarEl) {
        avatarEl.onerror = () => showInitial(avatarEl, avatarInitial);
        avatarEl.src = current.avatarUrl;
        avatarEl.style.display = "";
        if (avatarInitial) avatarInitial.style.display = "none";
      } else {
        showInitial(avatarEl, avatarInitial);
      }
    }
    if (likeCountEl) likeCountEl.textContent = formatCount(current ? current.likes : 0);
    paintCaption();
  };

  paint();
  window.addEventListener("sx:video-changed", paint);
}
