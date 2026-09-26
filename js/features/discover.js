import { formatCount, getAllVideos } from "../../vid.js";
import { readJson } from "../store.js";
import { esc } from "../lib/dom.js";

/* js/features/discover.js — full Discover page (mirrors the reference):
 * tag/creator search bar, hashtag cards (cover + #name + count),
 * filter chips, 3-col video grid. Tapping a card or tile plays. */

let sheet = null;

export function openDiscover(filter) {
  if (!sheet) return;
  sheet._open(filter || "all");
}

function tagIndex() {
  const map = new Map();
  getAllVideos().forEach((v) => {
    (v.hashtags || []).forEach((t) => {
      const key = String(t).toLowerCase();
      if (!key) return;
      let e = map.get(key);
      if (!e) {
        e = { tag: String(t), count: 0, poster: null };
        map.set(key, e);
      }
      e.count++;
      if (!e.poster && v.posterUrl) e.poster = v.posterUrl;
    });
  });
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export async function init() {
  const searchBtns = document.querySelectorAll(".search-btn");
  const discoverLinks = document.querySelectorAll(".discover-link");
  if (!searchBtns.length && !discoverLinks.length) return;

  const wrap = document.createElement("div");
  wrap.className = "sx-discover";
  wrap.style.display = "none";
  wrap.innerHTML =
    '<div class="sx-discover-inner"><div class="sx-discover-bar">' +
    '<button data-close aria-label="Close discover" class="sx-discover-x">✕</button>' +
    '<input data-q placeholder="Search tags or creators…" autocomplete="off" class="sx-discover-q" /></div>' +
    '<div data-tags class="sx-tags"></div>' +
    '<div data-chips class="sx-discover-chips"></div>' +
    '<div data-grid class="sx-discover-grid"></div></div>';
  document.body.appendChild(wrap);
  sheet = wrap;
  let filter = "all";
  let activeTag = null;
  const tagsEl = wrap.querySelector("[data-tags]");
  const chipsEl = wrap.querySelector("[data-chips]");
  const gridEl = wrap.querySelector("[data-grid]");
  const qEl = wrap.querySelector("[data-q]");

  function paintTags() {
    const tags = tagIndex().slice(0, 20);
    tagsEl.style.display = tags.length ? "" : "none";
    tagsEl.innerHTML =
      '<div class="sx-tags-title">Hashtags</div><div class="sx-tags-row">' +
      tags
        .map(
          (t) =>
            '<button class="sx-tagcard' + (activeTag === t.tag.toLowerCase() ? " on" : "") + '" data-tag="' + esc(t.tag) + '">' +
            (t.poster
              ? '<img src="' + esc(t.poster) + '" alt="" loading="lazy" class="sx-tagcard-img" />'
              : '<div class="sx-tagcard-fallback">#</div>') +
            '<span class="sx-tagcard-name">#' + esc(t.tag) + "</span>" +
            '<span class="sx-tagcard-count">' + esc(formatCount(t.count)) + "</span></button>",
        )
        .join("") +
      "</div>";
    tagsEl.querySelectorAll("[data-tag]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const t = b.getAttribute("data-tag").toLowerCase();
        activeTag = activeTag === t ? null : t;
        qEl.value = activeTag ? "#" + activeTag : "";
        paintTags();
        paintGrid();
      }),
    );
  }

  function paintChips() {
    const defs = [
      ["all", "All"],
      ["following", "Following"],
      ["saved", "Saved"],
    ];
    const cats = Array.from(new Set(getAllVideos().map((v) => v.category).filter(Boolean))).slice(0, 4);
    cats.forEach((c) => defs.push(["cat:" + c, c[0].toUpperCase() + c.slice(1)]));
    chipsEl.innerHTML = "";
    defs.forEach(([key, label]) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.className = "sx-chip" + (filter === key ? " sx-chip-on" : "");
      b.addEventListener("click", () => {
        filter = key;
        paintChips();
        paintGrid();
      });
      chipsEl.appendChild(b);
    });
  }

  function matchTag(v, q) {
    const tags = (v.hashtags || []).map((t) => String(t).toLowerCase());
    if (activeTag && !tags.includes(activeTag)) return false;
    if (!q) return true;
    const needle = q.startsWith("#") ? q.slice(1) : q;
    if (!needle) return true;
    if (needle && tags.some((t) => t.includes(needle))) return true;
    if (q.startsWith("#")) return false;
    const hay = [v.creator, v.id, v.category, v.caption, tags.join(" ")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  }

  function paintGrid() {
    const q = (qEl.value || "").trim().toLowerCase();
    const pool = getAllVideos();
    const fols = readJson("shortxx_follows", []);
    const sav = readJson("shortxx_saved", []);
    gridEl.innerHTML = "";
    let shown = 0;
    pool.forEach((v) => {
      if (filter === "following" && !fols.includes(v.creator)) return;
      if (filter === "saved" && !sav.includes(v.id)) return;
      if (filter.startsWith("cat:") && v.category !== filter.slice(4)) return;
      if (!matchTag(v, q)) return;
      shown++;
      const cell = document.createElement("button");
      cell.className = "sx-tile";
      const cellName = v.creator || "Shortxx";
      cell.setAttribute("aria-label", "Play video by @" + cellName);
      cell.innerHTML =
        (v.posterUrl
          ? '<img src="' + esc(v.posterUrl) + '" alt="" loading="lazy" class="sx-tile-img" />'
          : '<div class="sx-tile-fallback">▶</div>') +
        '<span class="sx-tile-cap">@' +
        esc(cellName) +
        " · " +
        esc(formatCount(v.views)) +
        "</span>";
      cell.addEventListener("click", () => {
        try {
          sessionStorage.setItem("shortxx_pick", v.id);
        } catch (e) {}
        location.reload();
      });
      gridEl.appendChild(cell);
    });
    if (!shown) {
      gridEl.innerHTML =
        '<div class="sx-discover-empty">' +
        (filter === "following"
          ? "Follow creators to fill this feed."
          : filter === "saved"
            ? "Nothing saved yet — tap Save on any video."
            : "No videos match.") +
        "</div>";
    }
  }

  qEl.addEventListener("input", () => {
    const q = qEl.value.trim().toLowerCase();
    activeTag = q.startsWith("#") && q.length > 1 ? q.slice(1) : null;
    paintTags();
    paintGrid();
  });
  wrap.querySelector("[data-close]").addEventListener("click", () => {
    wrap.style.display = "none";
  });
  wrap._open = (f) => {
    if (f) filter = f;
    activeTag = null;
    qEl.value = "";
    paintTags();
    paintChips();
    paintGrid();
    wrap.style.display = "";
  };
  wrap._search = (text) => {
    qEl.value = text || "";
    paintGrid();
  };
  window.sxOpenDiscover = (f) => wrap._open(f || "all");

  const pending = window.__sxPendingSavedOverlay;
  if (pending) {
    window.__sxPendingSavedOverlay = false;
    wrap._open("saved");
  }

  searchBtns.forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      wrap._open("all");
      setTimeout(() => qEl.focus(), 50);
    }),
  );
  discoverLinks.forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      wrap._open("all");
    }),
  );
}
