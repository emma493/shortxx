/* js/features/prefs.js — first-visit content-preference popup + side-menu
 * re-entry. Options: Girls (girls creators only), Couples (couples creators
 * only), All (mix). Persists as shortxx_pref via vid.js; the pool, grids
 * and player all follow through sx:videos-ready. Dismissing without choosing
 * re-prompts next visit; a choice ends it forever. Opened programmatically
 * via window.sxOpenPrefs (side menu, ?prefs=1 deep link). */

import { getContentPreference, setContentPreference } from "../../vid.js";

const OPTIONS = [
  { value: "girls", label: "Girls" },
  { value: "couples", label: "Couples" },
  { value: "all", label: "All" },
];

let root = null;
let toast = () => {};

function hasChosen() {
  try {
    const p = localStorage.getItem("shortxx_pref");
    return p === "girls" || p === "couples" || p === "all";
  } catch (e) {
    return false;
  }
}

function paint() {
  if (!root) return;
  const current = getContentPreference();
  root.querySelectorAll("[data-pref]").forEach((btn) => {
    const on = btn.getAttribute("data-pref") === current;
    btn.classList.toggle("picked", on);
    btn.setAttribute("aria-checked", String(on));
  });
}

function choose(value) {
  const ok = setContentPreference(value);
  paint();
  try {
    toast(
      ok
        ? value === "all"
          ? "Showing all videos"
          : `Showing ${value} videos`
        : "No videos in this category yet — showing all"
    );
  } catch (e) {}
  close();
  try {
    window.dispatchEvent(new CustomEvent("sx:prefs-chosen"));
  } catch (e) {}
  // Preference change always refreshes into the freshly filtered feed.
  location.reload();
}

function open() {
  if (!root) return;
  paint();
  root.style.display = "";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.add("open"));
  });
}

function close() {
  if (!root || root.style.display === "none") return;
  root.classList.remove("open");
  setTimeout(() => {
    if (root) root.style.display = "none";
  }, 260);
  // First-visit sequence: prefs -> tutorial (guide.js) -> For You feed.
  try {
    window.dispatchEvent(new CustomEvent("sx:prefs-closed"));
  } catch (e) {}
}

function build() {
  root = document.createElement("div");
  root.className = "sx-prefs-backdrop";
  root.style.display = "none";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Choose your preferences");
  root.innerHTML =
    '<div class="sx-prefs-card" role="radiogroup" aria-label="Content preference">' +
    '<h2 class="sx-prefs-title">What to watch?</h2>' +
    '<div class="sx-prefs-options">' +
    OPTIONS.map(
      (o) =>
        '<button type="button" class="sx-prefs-option" role="radio" data-pref="' +
        o.value +
        '"><span>' +
        o.label +
        "</span></button>"
    ).join("") +
    "</div>" +
    "</div>";
  document.body.appendChild(root);
  root.addEventListener("click", (e) => {
    if (e.target === root) close();
    const btn = e.target && e.target.closest ? e.target.closest("[data-pref]") : null;
    if (btn) {
      e.stopPropagation();
      choose(btn.getAttribute("data-pref"), root.dataset.viaMenu === "1");
      delete root.dataset.viaMenu;
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

export async function init(ctx) {
  toast = (ctx && ctx.toast) || (() => {});
  if (root) return;
  build();
  window.sxOpenPrefs = (viaMenu) => {
    if (viaMenu) root.dataset.viaMenu = "1";
    open();
  };
  // First visit: open once the feed has content, so the choice applies to
  // something real instead of an empty pool.
  window.addEventListener("sx:videos-ready", () => {
    try {
      if (!hasChosen()) open();
    } catch (e) {}
  });
}
