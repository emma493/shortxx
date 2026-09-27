import { creatorFor, ensurePoolSize, formatCount, getAllVideos, loadVideosFromFirestore } from "../../vid.js";
import { readJson, writeJson } from "../store.js";
import { esc } from "../lib/dom.js";
import { thumbHTML, hydrateThumbVideos, registerVideos } from "../lib/thumb.js";
import { bootAuth } from "../lib/auth-boot.js";

// Standalone route (also served for /@name + 404 fallback): inject shared
// auth modal + boot authed-only telemetry.
bootAuth();

/* js/pages/creator-page.js — standalone creator profile route (NudiTok-style).
 * Primary URL is the real folder /creator/<name>/ (works on any static host,
 * no rewrites). Also served for legacy /@name via the /@* redirect splat and
 * the 404 fallback, plus ?u= / #@name for local dev.
 * Same paint model as the feed overlay (js/features/creator-page.js) but as a
 * real indexable route: H1 @name, stat row, bio, tag pills, video grid.
 * Head (title/meta/og/canonical/JSON-LD Person+Breadcrumb) is updated
 * client-side per creator; server/bot readers see the baked per-creator head
 * from tools/generate-creator-pages.mjs. */

function usernameFromLocation() {
  try {
    const path = location.pathname.replace(/\/+$/, "");
    const m = path.match(/^\/@(.+)$/);
    if (m) return decodeURIComponent(m[1]).trim();
    const c = path.match(/^\/creator\/([^/]+)$/i);
    if (c && c[1]) return decodeURIComponent(c[1]).trim();
    const q = new URLSearchParams(location.search).get("u");
    if (q) return q.trim().replace(/^@/, "");
    const h = (location.hash || "").match(/#@(.+)/);
    if (h) return decodeURIComponent(h[1]).trim();
  } catch (e) {}
  return "";
}

function videosOf(name) {
  if (!name) return [];
  const lower = name.toLowerCase();
  return getAllVideos().filter((v) => {
    const direct = (v.creator || "").toLowerCase();
    if (direct === lower) return true;
    // Unlinked-video fallback: same stable pseudonym grouping used by the
    // creators grid, so /@LilyGrace etc. never render empty when Firestore
    // has no creators-collection link yet.
    try {
      return (creatorFor(v.id) || "").toLowerCase() === lower;
    } catch (e) {
      return false;
    }
  });
}

function setHead(profile) {
  const { name, count, followers, avatar } = profile;
  const title = "@" + name + " - Nude TikTok Videos | Shortxx";
  const desc = name + " on Shortxx - " + followers + " followers, " + count + " videos";
  const url = "https://shortxx.live/creator/" + encodeURIComponent(name) + "/";
  document.title = title;
  const setMeta = (sel, attr, val) => {
    let el = document.querySelector(sel);
    if (!el) return;
    el.setAttribute(attr, val);
  };
  setMeta('link[rel="canonical"]', "href", url);
  setMeta('meta[name="description"]', "content", desc);
  setMeta('meta[property="og:title"]', "content", title);
  setMeta('meta[property="og:url"]', "content", url);
  setMeta('meta[property="og:description"]', "content", desc);
  setMeta('meta[name="twitter:title"]', "content", title);
  setMeta('meta[name="twitter:description"]', "content", desc);
  let ld = document.querySelector("[data-profile-json]");
  if (ld) {
    ld.textContent = JSON.stringify([
      {
        "@context": "https://schema.org",
        "@type": "Person",
        alternateName: "@" + name,
        description: desc,
        image: avatar || undefined,
        interactionStatistic: {
          "@type": "InteractionCounter",
          interactionType: "https://schema.org/FollowAction",
          userInteractionCount: followers,
        },
        name,
        url,
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", item: "https://shortxx.live/", name: "Home", position: 1 },
          { "@type": "ListItem", item: url, name: "@" + name, position: 2 },
        ],
      },
    ]);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const bodyEl = document.querySelector("[data-body]");
  if (!bodyEl) return;
  const raw = usernameFromLocation();
  const name = raw.replace(/^@/, "");
  if (!name) {
    // Served as 404.html for a genuinely unknown path (not /@user):
    // reveal the friendly not-found block if present, else inline fallback.
    document.title = "Page not found | Shortxx";
    const loading = bodyEl.querySelector("[data-loading]");
    if (loading) loading.hidden = true;
    const notFound = bodyEl.querySelector("[data-404]");
    if (notFound) notFound.hidden = false;
    else bodyEl.innerHTML = '<div class="cp-empty">Unknown creator. <a href="/creators/">Browse creators</a></div>';
    return;
  }

  function paint() {
    try {
    try { registerVideos(getAllVideos()); } catch (e) {}
    try { void ensurePoolSize(48); } catch (e) {}
    const list = videosOf(name).sort((a, b) => (b.createdAtMillis || 0) - (a.createdAtMillis || 0));
    const current = list[0] || null;
    const views = list.reduce((s, v) => s + (v.views || 0), 0);
    const likesSum = list.reduce((s, v) => s + (v.likes || 0), 0);
    const follows = readJson("shortxx_follows", []);
    const key = list[0] ? (list[0].creator || name) : name;
    const following = follows.includes(key);
    const avatar = current && current.avatarUrl ? current.avatarUrl : null;
    const initial = (name || "?").slice(0, 1).toUpperCase();
    const followers = current && typeof current.followers === "number" ? current.followers : likesSum;
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

    setHead({ name, count: list.length, followers, avatar });

    bodyEl.innerHTML =
      '<p style="padding:24px 16px 0;"><a href="/creators/" style="color:#8a8a8a;font-size:13px;text-decoration:none;">&#8592; All creators</a></p>' +
      '<div class="cp-body">' +
      '<div class="cp-head">' +
      '<div class="cp-ring"><div class="cp-ring-inner">' +
      (avatar
        ? '<img src="' + esc(avatar) + '" alt="' + esc(name) + '">'
        : '<div class="cp-avatar-fallback">' + esc(initial) + "</div>") +
      "</div></div>" +
      '<div class="cp-head-info">' +
      '<h1 class="cp-name">@' + esc(name) + "</h1>" +
      '<p class="cp-display">' + esc((current && current.displayName) || name) + "</p>" +
      '<div class="cp-actions">' +
      '<button class="cp-share" data-share aria-label="Share"><span>Share</span></button>' +
      '<button class="cp-follow' + (following ? " following" : "") + '" aria-label="Follow"><span>' + (following ? "Following" : "Follow") + "</span></button>" +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="cp-stats">' +
      '<div class="cp-stat"><b>' + esc(formatCount(list.length)) + "</b><span>Posts</span></div>" +
      '<div class="cp-stat"><b>' + esc(formatCount(followers)) + "</b><span>Followers</span></div>" +
      '<div class="cp-stat"><b>' + esc(formatCount(likesTotal)) + "</b><span>Likes</span></div>" +
      '<div class="cp-stat"><b>' + esc(formatCount(views)) + "</b><span>Views</span></div>" +
      "</div>" +
      (current && current.bio ? '<div class="cp-bio">' + esc(current.bio) + "</div>" : "") +
      (topTags.length
        ? '<div class="cp-tags">' +
          topTags.map((t) => '<a class="cp-tagpill" href="/discover/?q=' + encodeURIComponent("#" + t) + '">#' + esc(t) + "</a>").join("") +
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
                '<span class="cp-tile-cap"><span>' + esc(formatCount(v.views)) + "</span><span>" + esc(formatCount(v.likes)) + "</span></span></button>",
            )
            .join("")
        : '<div class="cp-empty">No videos yet.</div>') +
      "</div></div>";

    const followBtn = bodyEl.querySelector(".cp-follow");
    if (followBtn) followBtn.addEventListener("click", () => {
      const f = readJson("shortxx_follows", []);
      const key = list[0] ? (list[0].creator || creatorFor(list[0].id) || name) : name;
      const i = f.indexOf(key);
      if (i >= 0) f.splice(i, 1);
      else f.push(key);
      writeJson("shortxx_follows", f);
      paint();
    });
    const shareBtn = bodyEl.querySelector("[data-share]");
    if (shareBtn) shareBtn.addEventListener("click", async () => {
      const url = "https://shortxx.live/creator/" + encodeURIComponent(name) + "/";
      try {
        if (navigator.share) { await navigator.share({ title: "@" + name, url }); return; }
        await navigator.clipboard.writeText(url);
      } catch (e) {}
    });
    // Dead photo URL -> initial-letter circle (never a broken-image icon).
    const av = bodyEl.querySelector(".cp-ring-inner img");
    if (av) {
      const toFallback = () => {
        av.outerHTML = '<div class="cp-avatar-fallback">' + esc(initial) + "</div>";
      };
      av.onerror = toFallback;
      if (av.complete && av.naturalWidth === 0) toFallback();
    }
    bodyEl.querySelectorAll("[data-vid]").forEach((tile) =>
      tile.addEventListener("click", () => {
        try { sessionStorage.setItem("shortxx_pick", tile.getAttribute("data-vid")); } catch (e) {}
        location.href = "/index.html";
      }),
    );
    try { hydrateThumbVideos(bodyEl); } catch (e) {}
    } catch (err) {
      console.warn("[shortxx] creator paint failed:", err);
      try {
        bodyEl.innerHTML = '<div class="cp-empty">Could not load this creator. <a href="/creators/" style="color:#fe2c55;">Browse creators</a></div>';
      } catch (e) {}
    }
  }

  paint();
  try { await loadVideosFromFirestore(); } catch (e) {
    console.warn("[shortxx] creator videos load failed:", e);
  }
  paint();
});
