import { ensurePoolSize, formatCount, getAllVideos, loadVideosFromFirestore } from "../../vid.js";
import { readJson, writeJson } from "../store.js";
import { esc } from "../lib/dom.js";
import { thumbHTML, hydrateThumbVideos } from "../lib/thumb.js";
import { bootAuth } from "../lib/auth-boot.js";

// Standalone route: inject shared auth modal + boot authed-only telemetry.
bootAuth();

/* js/pages/saved-page.js — standalone /saved/ folder page.
 * Same contract as js/features/saved-page.js but with folder-correct
 * links (../index.html). Private: noindex (see saved/index.html). */

function getSavedIds() {
  const v = readJson("shortxx_saved", []);
  return Array.isArray(v) ? v.filter((id) => typeof id === "string") : [];
}

function paint() {
  const grid = document.querySelector("[data-grid]");
  const empty = document.querySelector("[data-empty]");
  const count = document.querySelector("[data-count]");
  const clearBtn = document.querySelector("[data-clear]");
  if (!grid) return;
  const saved = getSavedIds();
  const byId = new Map(getAllVideos().map((v) => [v.id, v]));
  try { void ensurePoolSize(48); } catch (e) {}
  const ordered = [...saved].reverse().map((id) => byId.get(id)).filter(Boolean);
  grid.innerHTML = "";
  ordered.forEach((v) => {
    const wrap = document.createElement("div");
    wrap.className = "sx-saved-cell";
    const cell = document.createElement("button");
    cell.className = "sx-rank";
    cell.setAttribute("aria-label", "Play video by @" + (v.creator || "Shortxx"));
    cell.innerHTML = thumbHTML(v, "") +
      '<span class="sx-rank-cap"><div>' + esc(formatCount(v.views)) + "</div><div>" + esc(formatCount(v.likes)) + "</div></span>";
    cell.addEventListener("click", () => {
      try { sessionStorage.setItem("shortxx_pick", v.id); } catch (e) {}
      location.href = "../index.html";
    });
    const unsave = document.createElement("button");
    unsave.className = "sx-saved-unsave";
    unsave.setAttribute("aria-label", "Remove from Saved");
    unsave.textContent = "★";
    unsave.addEventListener("click", (e) => {
      e.stopPropagation();
      writeJson("shortxx_saved", getSavedIds().filter((id) => id !== v.id));
      paint();
    });
    wrap.appendChild(cell);
    wrap.appendChild(unsave);
    grid.appendChild(wrap);
  });
  try { hydrateThumbVideos(grid); } catch (e) {}
  const hasVideos = ordered.length > 0;
  if (empty) empty.hidden = hasVideos;
  if (count) count.textContent = hasVideos ? ordered.length + (ordered.length === 1 ? " video" : " videos") : "";
  if (clearBtn) {
    clearBtn.hidden = !saved.length;
    clearBtn.onclick = () => { writeJson("shortxx_saved", []); paint(); };
  }
  const title = empty ? empty.querySelector(".sx-saved-empty-title") : null;
  if (title) title.textContent = !hasVideos && saved.length ? "Loading saved videos…" : "Nothing saved yet";
}

document.addEventListener("DOMContentLoaded", async () => {
  paint();
  try { await loadVideosFromFirestore(); } catch (e) { console.warn("[shortxx] saved load failed:", e); }
  paint();
  window.addEventListener("storage", (e) => { if (!e.key || e.key === "shortxx_saved") paint(); });
  window.addEventListener("focus", paint);
});
