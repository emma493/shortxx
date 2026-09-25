import { store, writeJson } from "../store.js";
import { saveUserProfile } from "../../vid.js";

/* js/features/save.js — save/unsave only. */

export async function init(ctx) {
  const saveBtn = document.querySelector(".save-btn");
  const saveCountEl = document.querySelector(".save-count");
  if (!saveBtn) return;
  const toast = ctx.toast || (() => {});

  const pushProfile = () => {
    if (!store.authUser || !store.authUser.uid) return;
    saveUserProfile(store.authUser.uid, {
      liked: Object.keys(store.likedMap),
      saved: store.savedIds,
      follows: store.follows,
    });
  };

  const paintSave = () => {
    const saved = store.savedIds.includes(store.videoId);
    saveBtn.setAttribute("aria-label", saved ? "Unsave" : "Save");
    const svg = saveBtn.querySelector("svg");
    if (svg) svg.style.color = saved ? "#facc15" : "";
    if (saveCountEl) saveCountEl.textContent = saved ? "1" : "0";
  };
  paintSave();
  window.addEventListener("sx:video-changed", paintSave);
  window.addEventListener("sx:profile-synced", paintSave);

  saveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const i = store.savedIds.indexOf(store.videoId);
    if (i >= 0) {
      store.savedIds.splice(i, 1);
      toast("Removed from Saved");
    } else {
      store.savedIds.push(store.videoId);
      toast("Saved — find it in Menu > Saved");
    }
    writeJson("shortxx_saved", store.savedIds);
    paintSave();
    pushProfile();
  });
}
