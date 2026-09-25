import { getFeedMode, setFeedMode } from "../../vid.js";
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

  const switchFeed = (mode) => {
    if (mode === "following" && readJson("shortxx_follows", []).length === 0) {
      toast("Follow creators to fill this feed");
    }
    setFeedMode(mode);
    location.reload();
  };
  window.sxSwitchFeed = switchFeed;

  let menu = null;
  feedBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu) {
      menu.remove();
      menu = null;
      feedBtn.setAttribute("aria-expanded", "false");
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
    feedBtn.setAttribute("aria-expanded", "true");
    setTimeout(() => {
      document.addEventListener("click", function closer(ev) {
        if (menu && !menu.contains(ev.target)) {
          menu.remove();
          menu = null;
          feedBtn.setAttribute("aria-expanded", "false");
          document.removeEventListener("click", closer);
        }
      });
    }, 0);
  });
}
