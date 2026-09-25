import { formatCount } from "../../vid.js";
import { store } from "../store.js";

/* js/features/creator.js — linked-creator profile only.
 * Shows real picture + name when creatorLinked, else hides block. */

function showInitial(avatarEl, initialEl, letter) {
  if (avatarEl) avatarEl.style.display = "none";
  if (initialEl) {
    initialEl.textContent = (letter || "?").slice(0, 1).toUpperCase();
    initialEl.style.display = "flex";
  }
}

export async function init() {
  const profileBlock = document.querySelector(".creator-profile");
  const userLink = document.querySelector(".creator-link");
  const userNameElement = document.querySelector(".dynamic-username");
  const avatarEl = document.querySelector(".creator-avatar");
  const avatarInitial = document.querySelector(".creator-initial");
  const likeCountEl = document.querySelector(".like-count");

  const paint = () => {
    const { current, creator, linkedCreator } = store;
    if (profileBlock) profileBlock.style.display = linkedCreator ? "" : "none";
    if (userLink) userLink.style.display = linkedCreator ? "" : "none";
    if (linkedCreator) {
      if (userNameElement) userNameElement.textContent = creator;
      if (current && current.avatarUrl && avatarEl) {
        avatarEl.onerror = () => showInitial(avatarEl, avatarInitial, creator);
        avatarEl.src = current.avatarUrl;
        avatarEl.style.display = "";
        if (avatarInitial) avatarInitial.style.display = "none";
      } else {
        showInitial(avatarEl, avatarInitial, creator);
      }
    }
    if (likeCountEl) likeCountEl.textContent = formatCount(current ? current.likes : 0);
  };

  paint();
  window.addEventListener("sx:video-changed", paint);
}
