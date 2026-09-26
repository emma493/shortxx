import { formatCount, getAllVideos } from "../../vid.js";
import { esc } from "../lib/dom.js";

/* js/features/trending.js — full-page trending rank with
 * Today / This week / All time tabs (mirrors the reference).
 * All time ranks by total views; time tabs rank videos added in the
 * window (we track totals, not per-day views, so recency filters
 * the pool and views do the ranking). */

const TABS = [
  ["today", "Today", 24 * 3600 * 1000],
  ["week", "This week", 7 * 24 * 3600 * 1000],
  ["all", "All time", 0],
];

let root = null;
let gridEl = null;
let tab = "all";

function poolFor(key) {
  const all = getAllVideos();
  const def = TABS.find((t) => t[0] === key) || TABS[2];
  const windowMs = def[2];
  let pool = all;
  if (windowMs > 0) {
    const cutoff = Date.now() - windowMs;
    pool = all.filter((v) => (v.createdAtMillis || 0) >= cutoff);
  }
  return [...pool].sort((a, b) => (b.views || 0) - (a.views || 0));
}

function paintTabs() {
  root.querySelectorAll("[data-tab]").forEach((b) => {
    b.classList.toggle("on", b.getAttribute("data-tab") === tab);
  });
}

function paintGrid() {
  const pool = poolFor(tab);
  gridEl.innerHTML = "";
  if (!pool.length) {
    gridEl.innerHTML =
      '<div class="sx-trending-empty">' +
      (tab === "all"
        ? "No videos yet."
        : "No videos added " + (tab === "today" ? "today" : "this week") + " — check All time.") +
      "</div>";
    return;
  }
  pool.forEach((v, i) => {
    const cell = document.createElement("button");
    cell.className = "sx-rank";
    cell.setAttribute("aria-label", "Ranked #" + (i + 1) + " by @" + (v.creator || "Shortxx"));
    cell.innerHTML =
      (v.posterUrl
        ? '<img src="' + esc(v.posterUrl) + '" alt="" loading="lazy" />'
        : '<div class="sx-rank-fallback">▶</div>') +
      '<span class="sx-rank-num">' + (i + 1) + "</span>" +
      '<span class="sx-rank-cap">▶ ' +
      esc(formatCount(v.views)) +
      " · @" +
      esc(v.creator || "Shortxx") +
      "</span>";
    cell.addEventListener("click", () => {
      try {
        sessionStorage.setItem("shortxx_pick", v.id);
      } catch (e) {}
      location.reload();
    });
    gridEl.appendChild(cell);
  });
}

function open(which) {
  if (which) tab = which;
  paintTabs();
  paintGrid();
  root.style.display = "";
}

function close() {
  if (!root || root.style.display === "none") return;
  root.style.display = "none";
}

export async function init() {
  if (root) return;
  root = document.createElement("div");
  root.className = "sx-trending";
  root.style.display = "none";
  root.innerHTML =
    '<div class="sx-trending-inner">' +
    '<div class="sx-trending-bar"><button class="sx-trending-back" data-close aria-label="Back">←</button>' +
    '<div class="sx-trending-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="#fe2c55" stroke="none"><path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"></path></svg>Trending</div><div class="sx-trending-spacer"></div></div>' +
    '<div class="sx-trending-tabs">' +
    TABS.map(([k, label]) => '<button class="sx-ttab" data-tab="' + k + '">' + label + "</button>").join("") +
    "</div>" +
    '<div class="sx-trending-grid" data-grid></div></div>';
  document.body.appendChild(root);
  gridEl = root.querySelector("[data-grid]");
  root.querySelector("[data-close]").addEventListener("click", close);
  root.querySelectorAll("[data-tab]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      tab = b.getAttribute("data-tab");
      paintTabs();
      paintGrid();
    }),
  );
  window.sxOpenTrending = open;
  window.sxCloseTrending = close;
}
