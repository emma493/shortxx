import { getFeedMode, setFeedMode, loadVideosFromFirestore } from "../../vid.js";
import { store, readJson } from "../store.js";

/* js/features/feed.js — For You / Following / Top switcher only. */

const NAMES = { foryou: "For You", following: "Following", top: "Top" };

export async function init(ctx) {
  const feedBtn = document.getElementById("feed-btn");
  const feedLabel = document.getElementById("feed-label");
  const toast = ctx.toast || (() => {});
  if (!feedBtn) return;

  const paint = () => {
    if (feedLabel) feedLabel.textContent = NAMES[getFeedMode()] || "For You";
    feedBtn.setAttribute("aria-label", "Change feed, currently " + (NAMES[getFeedMode()] || "For You"));
  };
  paint();

  const switchFeed = async (mode) => {
    if (mode === "following" && readJson("shortxx_follows", []).length === 0) {
      toast("Follow creators to fill this feed");
    }
    setFeedMode(mode);
    // No-reload reseed: refill the pool, rebuild the swipe window in place.
    try {
      await loadVideosFromFirestore();
      if (window.sxReseedFeed) {
        window.sxReseedFeed();
        return;
      }
    } catch (e) {}
    location.reload();
  };
  window.sxSwitchFeed = switchFeed;

  let menu = null;
  let closer = null;

  const closeMenu = () => {
    if (!menu) return;
    menu.classList.remove("open");
    feedBtn.setAttribute("aria-expanded", "false");
    if (closer) {
      document.removeEventListener("click", closer);
      closer = null;
    }
    setTimeout(() => {
      if (menu && !menu.classList.contains("open")) {
        menu.remove();
        menu = null;
      }
    }, 300);
  };

  const openMenu = () => {
    if (menu) {
      menu.classList.add("open");
      feedBtn.setAttribute("aria-expanded", "true");
      return;
    }
    menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.className = "sx-feed-menu";
    ["foryou", "following", "top"].forEach((mode) => {
      const b = document.createElement("button");
      b.setAttribute("role", "menuitemradio");
      b.setAttribute("aria-checked", String(getFeedMode() === mode));
      b.className = "sx-feed-item";
      b.innerHTML = "<span>" + NAMES[mode] + "</span><span>" + (getFeedMode() === mode ? "✓" : "") + "</span>";
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        switchFeed(mode);
      });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    // Slide from below on the next frame.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (menu) menu.classList.add("open");
      });
    });
    feedBtn.setAttribute("aria-expanded", "true");
    setTimeout(() => {
      closer = function (ev) {
        if (menu && !menu.contains(ev.target)) closeMenu();
      };
      document.addEventListener("click", closer);
    }, 0);
  };

  // Feed menu opens only on manual tap of the feed button (For You is
  // already the default — nothing auto-opens on first visit).
  window.sxOpenFeedMenu = openMenu;
  window.sxCloseFeedMenu = closeMenu;

  feedBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu && menu.classList.contains("open")) closeMenu();
    else openMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
}
