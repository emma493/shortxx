import { creatorFor, ensurePoolSize, formatCount, getAllVideos, loadVideosFromFirestore } from "../../vid.js";
import { esc } from "../lib/dom.js";
import { bootAuth } from "../lib/auth-boot.js";

// Standalone route: inject shared auth modal + boot authed-only telemetry.
bootAuth();

/* js/pages/creators-page.js — standalone /creators/ folder page.
 * NudiTok-style cards: avatar -> display name -> @username -> followers
 * -> videos, each linking to /creator/<name>/. Ranked by followers desc.
 *
 * Data strategy: the swipe pool (vid.js) pages one video at a time and its
 * cursor pages can stall at 1 video, which used to leave this grid stuck on
 * a single creator. So this page ALSO loads the directory straight from the
 * public Firestore REST API (same key vid.js already ships) and renders the
 * full list from that. Pool paint stays as the instant first paint. */

const FIREBASE_API_KEY = "AIzaSyBQoIKWaWPKg8luwCjpN8LPaTd-43A1Vqo";
const FIREBASE_PROJECT = "shortxx-live";
const REST_BASE =
  "https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT + "/databases/(default)/documents";

function num(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

// --- REST unwrappers (same envelope decoding as vid.js) ---
const rs = (f) => (f && typeof f.stringValue === "string" ? f.stringValue : null);
const rb = (f) => !!(f && (f.booleanValue === true || f.booleanValue === "true"));
const rn = (f) => {
  if (!f) return 0;
  if (typeof f.integerValue !== "undefined") {
    const n = parseInt(f.integerValue, 10);
    return isNaN(n) ? 0 : n;
  }
  if (typeof f.doubleValue !== "undefined") return Number(f.doubleValue) || 0;
  return 0;
};

async function restGet(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    try {
      ctrl.abort();
    } catch (e) {}
  }, 25000);
  try {
    const res = await fetch(REST_BASE + path + (path.includes("?") ? "&" : "?") + "key=" + FIREBASE_API_KEY, {
      signal: ctrl.signal,
    });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* Creator directory: id -> { username, avatarUrl }. Single page is plenty
 * (30 docs), but follow nextPageToken anyway so it never truncates. */
async function loadCreatorsMap() {
  const map = new Map();
  let token = "";
  for (let page = 0; page < 5; page++) {
    const q =
      "/creators?pageSize=200" + (token ? "&pageToken=" + encodeURIComponent(token) : "");
    const json = await restGet(q);
    if (!json) break;
    (json.documents || []).forEach((d) => {
      try {
        const f = d.fields || {};
        if (!rb(f.is_active) && f.is_active) return;
        const id = String((d.name || "").split("/").pop() || "");
        const username = rs(f.username);
        if (!id || !username) return;
        map.set(id, { username, avatarUrl: rs(f.avatarUrl) || null });
      } catch (e) {}
    });
    token = json.nextPageToken || "";
    if (!token) break;
  }
  return map;
}

/* All active videos (id + creatorId + likes only — everything the grid
 * needs, kept small). Paginates until exhausted (cap: 20 x 200 = 4000). */
async function loadAllVideosRest() {
  const out = [];
  let token = "";
  for (let page = 0; page < 20; page++) {
    const q =
      "/videos?pageSize=200" + (token ? "&pageToken=" + encodeURIComponent(token) : "");
    const json = await restGet(q);
    if (!json) break;
    (json.documents || []).forEach((d) => {
      try {
        const f = d.fields || {};
        if (!rb(f.is_active)) return;
        const id = String((d.name || "").split("/").pop() || "");
        if (!id) return;
        out.push({ id, creatorId: rs(f.creatorId), likes: rn(f.likes) });
      } catch (e) {}
    });
    token = json.nextPageToken || "";
    if (!token) break;
  }
  return out;
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

  function renderList(list) {
    // NudiTok ranks by follower count (only creators with videos appear).
    list.sort((a, b) => b.followers - a.followers);
    grid.innerHTML = "";
    if (!list.length) {
      grid.innerHTML = '<div class="sx-trending-empty">No creators yet.</div>';
      return;
    }
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

  // Fast path: whatever the swipe pool has (instant, may be partial).
  function paintFromPool() {
    try {
      void ensurePoolSize(300);
    } catch (e) {}
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
    if (list.length) renderList(list);
    else grid.innerHTML = '<div class="sx-trending-empty">Loading creators…</div>';
  }

  // Complete path: full directory via REST (bypasses pool paging stalls).
  async function paintFromRest() {
    const [creators, videos] = await Promise.all([loadCreatorsMap(), loadAllVideosRest()]);
    if (!videos.length) return false;
    const map = new Map();
    videos.forEach((v) => {
      const ref = (v.creatorId && creators.get(v.creatorId)) || null;
      const name = ref ? ref.username : creatorFor(v.id) || "Shortxx";
      let e = map.get(name);
      if (!e) {
        e = { name, display: name, avatar: ref ? ref.avatarUrl : null, count: 0, likes: 0 };
        map.set(name, e);
      }
      if (!e.avatar && ref && ref.avatarUrl) e.avatar = ref.avatarUrl;
      e.count++;
      e.likes += v.likes || 0;
    });
    const list = [...map.values()].map((c) => ({
      ...c,
      followers: c.likes,
    }));
    if (!list.length) return false;
    renderList(list);
    return true;
  }

  paintFromPool();
  window.addEventListener("sx:videos-ready", paintFromPool);
  try {
    await loadVideosFromFirestore();
  } catch (e) {}
  paintFromPool();
  try {
    await ensurePoolSize(300);
  } catch (e) {}
  paintFromPool();
  // Authoritative fill: replaces any partial pool render with the full list.
  try {
    await paintFromRest();
  } catch (e) {}
});
