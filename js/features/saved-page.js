import { ensurePoolSize, formatCount, getAllVideos, loadVideosFromFirestore } from "../../vid.js";
import { readJson, writeJson } from "../store.js";
import { esc } from "../lib/dom.js";
import { thumbHTML, hydrateThumbVideos } from "../lib/thumb.js";
import { bootAuth } from "../lib/auth-boot.js";

// Standalone route (saved.html): inject shared auth modal + boot
// authed-only telemetry.
bootAuth();

/* js/features/saved-page.js — standalone /saved page (saved.html only).
 * NOT loaded by js/main.js. Reads `shortxx_saved` (array of video ids,
 * same key the feed's save-btn writes), resolves against the Firestore
 * pool, newest-saved-first, 9/16 tiles. Tap plays via shortxx_pick +
 * index.html (same contract as Discover/Trending). Bookmark button
 * unsaves in place. Repaints on storage/focus so unsaving in the feed
 * tab reflects here. */

const PLAY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"></path></svg>';
const HEART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"></path></svg>';

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
  // Newest-saved-first: savedIds is append-ordered, so reverse it.
  // Ids with no matching video (deleted/offline) are dropped from view
  // but KEPT in storage — they may resolve once Firestore loads.
  const ordered = [...saved].reverse().map((id) => byId.get(id)).filter(Boolean);

  grid.innerHTML = "";
  ordered.forEach((v) => {
    const wrap = document.createElement("div");
    wrap.className = "sx-saved-cell";

    const cell = document.createElement("button");
    cell.className = "sx-rank";
    cell.setAttribute("aria-label", "Play video by @" + (v.creator || "Shortxx"));
    cell.innerHTML =
      '<span class="sx-rank-shimmer" aria-hidden="true"></span>' +
      thumbHTML(v, "") +
      '<span class="sx-rank-hover" aria-hidden="true"></span>' +
      '<span class="sx-rank-cap"><div>' + PLAY + esc(formatCount(v.views)) + "</div><div>" + HEART + esc(formatCount(v.likes)) + "</div></span>";
    cell.addEventListener("click", () => {
      try { sessionStorage.setItem("shortxx_pick", v.id); } catch (e) {}
      location.href = "./index.html";
    });

    const unsave = document.createElement("button");
    unsave.className = "sx-saved-unsave";
    unsave.setAttribute("aria-label", "Remove from Saved");
    unsave.textContent = "\u2605"; // ★ saved state (matches feed's #facc15 paint)
    unsave.addEventListener("click", (e) => {
      e.stopPropagation();
      writeJson("shortxx_saved", getSavedIds().filter((id) => id !== v.id));
      paint();
    });

    const img = cell.querySelector("img,video");
    if (img) {
      const clear = () => { const s = cell.querySelector(".sx-rank-shimmer"); if (s) s.remove(); };
      if (img.tagName === "VIDEO") {
        try { img.muted = true; img.load(); } catch (e) {}
        img.addEventListener("loadeddata", clear);
        img.addEventListener("error", clear);
        setTimeout(clear, 4000);
      } else if (img.complete) clear();
      else { img.addEventListener("load", clear); img.addEventListener("error", clear); }
    } else {
      const s = cell.querySelector(".sx-rank-shimmer");
      if (s) s.remove();
    }

    wrap.appendChild(cell);
    wrap.appendChild(unsave);
    grid.appendChild(wrap);
  });

  try { hydrateThumbVideos(grid); } catch (e) {}

  const hasVideos = ordered.length > 0;
  const hasAnySaved = saved.length > 0;
  if (empty) empty.hidden = hasVideos;
  if (count) count.textContent = hasVideos ? ordered.length + (ordered.length === 1 ? " video" : " videos") : "";
  if (clearBtn) {
    clearBtn.hidden = !hasAnySaved;
    clearBtn.onclick = () => {
      writeJson("shortxx_saved", []);
      paint();
    };
  }
  // Saved ids that don't resolve yet (Firestore still loading): keep the
  // grid's empty state honest — show loading only before first load.
  const title = empty ? empty.querySelector(".sx-saved-empty-title") : null;
  if (title) title.textContent = !hasVideos && hasAnySaved ? "Loading saved videos…" : "Nothing saved yet";
}

document.addEventListener("DOMContentLoaded", async () => {
  paint();
  try { await loadVideosFromFirestore(); } catch (e) { console.warn("[shortxx] saved load failed:", e); }
  paint();
  window.addEventListener("storage", (e) => { if (!e.key || e.key === "shortxx_saved") paint(); });
  window.addEventListener("focus", paint);
});
