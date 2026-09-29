import { formatCount } from "../../vid.js";
import { store } from "../store.js";

/* Smartlink opened by the "See more" sponsor pill beside the @username.
 * Single constant so rotating the link later is a one-line change. */
const SMARTLINK_URL = "https://www.profitableratecpmnetwork.com/hdw3m5up?key=5bddf30019234b583460ad791a8a095d";

/* js/features/creator.js — guest mode: no profiles, no follow, no captions.
 * Paints like-count + hashtags only. @name is a plain non-clickable span. */

export async function init() {
  const profileBlock = document.querySelector(".creator-profile");
  if (profileBlock) profileBlock.style.display = "none";
  const userNameElement = document.querySelector(".dynamic-username");
  const likeCountEl = document.querySelector(".like-count");
  const hashtagsEl = document.querySelector("[data-hashtags]");

  // Sponsor pill: opens the smartlink in a new tab. stopPropagation keeps
  // player tap gestures (pause/like) out.
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

  const paint = () => {
    const { current } = store;
    if (userNameElement) {
      const name =
        (current && typeof current.creator === "string" && current.creator.trim()) ||
        (typeof store.creator === "string" && store.creator.trim()) ||
        "Shortxx";
      userNameElement.textContent = name;
    }
    const tags =
      current && Array.isArray(current.hashtags)
        ? current.hashtags.filter((t) => typeof t === "string" && t.trim())
        : [];
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
    if (likeCountEl) likeCountEl.textContent = formatCount(current ? current.likes : 0);
  };

  paint();
  window.addEventListener("sx:video-changed", paint);
}
