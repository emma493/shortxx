import { getContentPreference, setContentPreference } from "../../vid.js";

/* js/features/feed.js — guest category switcher: Girls / Couples / All.
 * Top-center button; choosing a category persists + reloads the feed. */

const NAMES = { girls: "Girls", couples: "Couples", all: "All" };
const ORDER = ["girls", "couples", "all"];

export async function init(ctx) {
  const feedBtn = document.getElementById("feed-btn");
  const feedLabel = document.getElementById("feed-label");
  const toast = ctx.toast || (() => {});
  if (!feedBtn) return;

  const paint = () => {
    const cur = getContentPreference();
    if (feedLabel) feedLabel.textContent = NAMES[cur] || "All";
    feedBtn.setAttribute("aria-label", "Change category, currently " + (NAMES[cur] || "All"));
  };
  paint();
  window.addEventListener("sx:prefs-chosen", paint);

  const switchFeed = async (mode) => {
    const cur = getContentPreference();
    if (mode === cur) return;
    const ok = setContentPreference(mode);
    try {
      toast(ok ? "Showing " + (NAMES[mode] || mode) + " videos" : "No videos in this category yet — showing all");
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
    ORDER.forEach((mode) => {
      const b = document.createElement("button");
      b.setAttribute("role", "menuitemradio");
      b.setAttribute("aria-checked", String(getContentPreference() === mode));
      b.className = "sx-feed-item";
      b.innerHTML = "<span>" + NAMES[mode] + "</span><span>" + (getContentPreference() === mode ? "✓" : "") + "</span>";
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        switchFeed(mode);
      });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
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
