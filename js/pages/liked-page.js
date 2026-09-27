import { ensurePoolSize, formatCount, getAllVideos, loadVideosFromFirestore } from "../../vid.js";
import { readJson, writeJson } from "../store.js";
import { esc } from "../lib/dom.js";
import { thumbHTML, hydrateThumbVideos, registerVideos } from "../lib/thumb.js";
import { bootAuth } from "../lib/auth-boot.js";

// Standalone route: inject shared auth modal + boot authed-only telemetry.
bootAuth();

/* js/pages/liked-page.js — standalone /liked/ folder page.
 * Reads `shortxx_liked` map (same key the feed writes), resolves against
 * the Firestore pool. Private: noindex (see liked/index.html). */

function getLikedIds() {
  const m = readJson("shortxx_liked", {});
  if (Array.isArray(m)) return m.filter((id) => typeof id === "string");
  if (m && typeof m === "object") return Object.keys(m).filter(Boolean);
  return [];
}

function paint() {
  const grid = document.querySelector("[data-grid]");
  const empty = document.querySelector("[data-empty]");
  const count = document.querySelector("[data-count]");
  const clearBtn = document.querySelector("[data-clear]");
  if (!grid) return;
  try { registerVideos(getAllVideos()); } catch (e) {}
  try { void ensurePoolSize(48); } catch (e) {}
  const liked = getLikedIds();
  const byId = new Map(getAllVideos().map((v) => [v.id, v]));
  const ordered = [...liked].reverse().map((id) => byId.get(id)).filter(Boolean);
  grid.innerHTML = "";
  ordered.forEach((v) => {
    const cell = document.createElement("button");
    cell.className = "sx-rank";
    cell.setAttribute("aria-label", "Play video by @" + (v.creator || "Shortxx"));
    cell.innerHTML = thumbHTML(v, "") +
      '<span class="sx-rank-cap"><div>' + esc(formatCount(v.views)) + "</div><div>" + esc(formatCount(v.likes)) + "</div></span>";
    cell.addEventListener("click", () => {
      try { sessionStorage.setItem("shortxx_pick", v.id); } catch (e) {}
      location.href = "../index.html";
    });
    grid.appendChild(cell);
  });
  try { hydrateThumbVideos(grid); } catch (e) {}
  const hasVideos = ordered.length > 0;
  if (empty) empty.hidden = hasVideos;
  if (count) count.textContent = hasVideos ? ordered.length + (ordered.length === 1 ? " video" : " videos") : "";
  if (clearBtn) {
    clearBtn.hidden = !liked.length;
    clearBtn.onclick = () => { writeJson("shortxx_liked", {}); paint(); };
  }
  const title = empty ? empty.querySelector(".sx-saved-empty-title") : null;
  if (title) title.textContent = !hasVideos && liked.length ? "Loading liked videos…" : "Nothing liked yet";
}

document.addEventListener("DOMContentLoaded", async () => {
  paint();
  try { await loadVideosFromFirestore(); } catch (e) {}
  paint();
  window.addEventListener("storage", (e) => { if (!e.key || e.key === "shortxx_liked") paint(); });
  window.addEventListener("focus", paint);
});
