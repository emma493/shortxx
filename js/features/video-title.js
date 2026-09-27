import { store } from "../store.js";

/* js/features/video-title.js — mirror the current video's AI caption into
 * the browser tab (TikTok-style): "<caption> | Shortxx".
 * Videos without a caption keep the static SEO <title> from the HTML.
 * Title failures must never break playback, so everything is guarded. */

const SUFFIX = " | Shortxx";
const MAX_LEN = 70;

function toTitle(caption) {
  const clean = typeof caption === "string" ? caption.trim().replace(/\s+/g, " ") : "";
  if (!clean) return null;
  const short = clean.length > MAX_LEN ? clean.slice(0, MAX_LEN - 1).trimEnd() + "…" : clean;
  return short + SUFFIX;
}

export async function init() {
  let fallback = "";
  try {
    fallback = document.title || "Shortxx";
  } catch (e) {
    return;
  }

  const paint = () => {
    try {
      const next = toTitle(store.current && store.current.caption);
      const wanted = next || fallback;
      if (document.title !== wanted) document.title = wanted;
    } catch (e) {}
  };

  paint();
  window.addEventListener("sx:video-changed", paint);
}
