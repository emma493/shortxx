import { formatCount, getAllVideos } from "../../vid.js";
import { store, readJson } from "../store.js";
import { esc } from "../lib/dom.js";

/* js/features/discover.js — Discover overlay grid + search + filters only. */

let sheet = null;

export function openDiscover(filter) {
  if (!sheet) return;
  sheet._open(filter || "all");
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
    '<input data-q placeholder="Search creators…" autocomplete="off" class="sx-discover-q" /></div>' +
    '<div data-chips class="sx-discover-chips"></div>' +
    '<div data-grid class="sx-discover-grid"></div></div>';
  document.body.appendChild(wrap);
  sheet = wrap;
  let filter = "all";
  const chipsEl = wrap.querySelector("[data-chips]");
  const gridEl = wrap.querySelector("[data-grid]");
  const qEl = wrap.querySelector("[data-q]");

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
      if (q) {
        const hay = [v.creator, v.id, v.category, v.caption, (v.hashtags || []).join(" ")]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return;
      }
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

  qEl.addEventListener("input", paintGrid);
  wrap.querySelector("[data-close]").addEventListener("click", () => {
    wrap.style.display = "none";
  });
  wrap._open = (f) => {
    if (f) filter = f;
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
