import { creatorFor, ensurePoolSize, formatCount, getAllVideos, loadVideosFromFirestore } from "../../vid.js";
import { esc } from "../lib/dom.js";
import { bootAuth } from "../lib/auth-boot.js";

// Standalone route: inject shared auth modal + boot authed-only telemetry.
bootAuth();

/* js/pages/creators-page.js — standalone /creators/ folder page.
 * NudiTok-style cards: avatar -> display name -> @username -> followers
 * -> videos, each linking to /creator/<name>/. Ranked by followers desc. */

function num(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

function paintSeoList(list) {
  try {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    const el = scripts[0];
    if (!el) return;
    const data = JSON.parse(el.textContent || "{}");
    data.mainEntity = {
      "@type": "ItemList",
      itemListElement: list.slice(0, 15).map((c, i) => ({
        "@type": "ListItem",
        name: c.display,
        position: i + 1,
        url: "https://shortxx.live/creator/" + encodeURIComponent(c.name) + "/",
      })),
    };
    el.textContent = JSON.stringify(data);
  } catch (e) {}
}

document.addEventListener("DOMContentLoaded", async () => {
  const grid = document.querySelector("[data-grid]");
  if (!grid) return;

  function paint() {
    // Bulk-fill in the background: loadVideosFromFirestore() only fetches
    // the first video (FIRST_PAGE_SIZE=1), so without this the grid can only
    // ever show 1 creator. Grids repaint via sx:videos-ready as pages land.
    try { void ensurePoolSize(300); } catch (e) {}
    const map = new Map();
    getAllVideos().forEach((v) => {
      // Fall back to stable pseudonym so unlinked videos still group
      // under a real profile name instead of collapsing into one "Shortxx" card
      // whose profile would then render empty.
      const name = v.creator || creatorFor(v.id) || "Shortxx";
      let e = map.get(name);
      if (!e) {
        e = { name, display: null, avatar: null, followers: null, count: 0, likes: 0 };
        map.set(name, e);
      }
      if (!e.display && v.displayName) e.display = v.displayName;
      if (!e.avatar && v.avatarUrl) e.avatar = v.avatarUrl;
      if (e.followers == null && num(v.followers) != null) e.followers = v.followers;
      e.count++;
      e.likes += v.likes || 0;
    });
    const list = [...map.values()].map((c) => ({
      ...c,
      display: c.display || c.name,
      followers: c.followers != null ? c.followers : c.likes,
    }));
    // NudiTok ranks by follower count (only creators with videos appear).
    list.sort((a, b) => b.followers - a.followers);
    grid.innerHTML = "";
    if (!list.length) { grid.innerHTML = '<div class="sx-trending-empty">No creators yet.</div>'; return; }
    list.slice(0, 60).forEach((c) => {
      const initial = (c.display || c.name || "?").slice(0, 1).toUpperCase();
      const card = document.createElement("a");
      card.className = "sx-cr-card";
      // /@ alias: resolves every Firestore username (folders exist only
      // for sitemap creators).
      card.href = "/@" + encodeURIComponent(c.name);
      card.setAttribute("aria-label", "@" + c.name + " - " + c.count + " videos");
      card.innerHTML =
        '<span class="sx-cr-avatar">' +
        (c.avatar
          ? '<img src="' + esc(c.avatar) + '" alt="' + esc(c.display) + '" loading="lazy" decoding="async">'
          : '<span class="sx-cr-avatar-fallback" aria-hidden="true">' + esc(initial) + "</span>") +
        "</span>" +
        '<span class="sx-cr-name">' + esc(c.display) + "</span>" +
        '<span class="sx-cr-handle">@' + esc(c.name) + "</span>" +
        '<span class="sx-cr-stats"><span><b>' + esc(formatCount(c.followers)) + "</b> followers</span>" +
        "<span><b>" + esc(formatCount(c.count)) + "</b> videos</span></span>";
      const img = card.querySelector("img");
      if (img) {
        img.addEventListener("error", () => {
          const av = card.querySelector(".sx-cr-avatar");
          if (av) av.innerHTML = '<span class="sx-cr-avatar-fallback" aria-hidden="true">' + esc(initial) + "</span>";
        });
      }
      grid.appendChild(card);
    });
    paintSeoList(list);
  }

  paint();
  window.addEventListener("sx:videos-ready", paint);
  try { await loadVideosFromFirestore(); } catch (e) {}
  paint();
  try { await ensurePoolSize(300); } catch (e) {}
  paint();
});
