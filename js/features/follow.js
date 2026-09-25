import { store, writeJson } from "../store.js";
/* js/features/follow.js — follow/unfollow only. */
import { saveUserProfile } from "../../vid.js";

export async function init(ctx) {
  const followBtn = document.querySelector(".follow-btn");
  if (!followBtn) return;
  const toast = ctx.toast || (() => {});

  const pushProfile = () => {
    if (!store.authUser || !store.authUser.uid) return;
    saveUserProfile(store.authUser.uid, {
      liked: Object.keys(store.likedMap),
      saved: store.savedIds,
      follows: store.follows,
    });
  };

  const paintFollow = () => {
    const following = store.follows.includes(store.creator);
    followBtn.setAttribute("aria-label", following ? "Following" : "Follow");
    followBtn.innerHTML = following
      ? '<span class="sx-follow-on"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>'
      : '<span class="follow-badge-pulse w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow-md shadow-primary/40"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"><line x1="12" y1="6" x2="12" y2="18"></line><line x1="6" y1="12" x2="18" y2="12"></line></svg></span>';
  };
  paintFollow();
  window.addEventListener("sx:video-changed", paintFollow);
  window.addEventListener("sx:profile-synced", paintFollow);

  followBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!store.linkedCreator || !store.creator) return;
    const i = store.follows.indexOf(store.creator);
    if (i >= 0) {
      store.follows.splice(i, 1);
      toast("Unfollowed @" + store.creator);
    } else {
      store.follows.push(store.creator);
      toast("Following @" + store.creator);
    }
    writeJson("shortxx_follows", store.follows);
    paintFollow();
    pushProfile();
  });
}
