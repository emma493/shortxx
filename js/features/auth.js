import { getFirebaseApp, loadUserProfile, saveUserProfile } from "../../vid.js";
import { store, publishIdentity, writeJson } from "../store.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signInAnonymously,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

/* js/features/auth.js — login/signup/Google/guest + profile sync only. */

function authErrorText(code) {
  switch (code) {
    case "auth/email-already-in-use":
      return "Email already registered — try Log In";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Wrong email or password";
    case "auth/weak-password":
      return "Password needs at least 6 characters";
    case "auth/invalid-email":
      return "That email address looks invalid";
    case "auth/operation-not-allowed":
      return "Enable this sign-in method in Firebase console";
    case "auth/unauthorized-domain":
      return "Add this domain under Firebase Auth settings";
    case "auth/popup-blocked":
      return "Popup blocked — allow popups and retry";
    case "auth/popup-closed-by-user":
      return "Google sign-in cancelled";
    case "auth/network-request-failed":
      return "Network error — check connection";
    default:
      return "Auth failed — try again";
  }
}

export async function init(ctx) {
  const toast = ctx.toast || (() => {});
  const overlay = document.getElementById("auth-modal-overlay");
  const form = document.getElementById("auth-form");
  const emailEl = document.getElementById("auth-email");
  const passEl = document.getElementById("auth-password");
  const loginBtn = document.getElementById("submit-login-btn");
  const signupBtn = document.getElementById("submit-signup-btn");
  const googleBtn = document.getElementById("google-auth-btn");
  const quickBtn = document.getElementById("quick-login-btn");

  let auth = null;
  try {
    auth = getAuth(getFirebaseApp());
  } catch (e) {
    console.warn("Auth init failed:", e);
  }
  store.auth = auth;
  publishIdentity();

  const openAuth = () => overlay && overlay.classList.remove("hidden");
  const closeAuth = () => overlay && overlay.classList.add("hidden");
  window.sxOpenAuth = openAuth;

  const setBusy = (b) => {
    [loginBtn, signupBtn, googleBtn, quickBtn].forEach((x) => {
      if (x) x.disabled = b;
    });
  };

  const pushProfile = () => {
    if (!store.authUser || !store.authUser.uid) return;
    saveUserProfile(store.authUser.uid, {
      liked: Object.keys(store.likedMap),
      saved: store.savedIds,
      follows: store.follows,
    });
  };
  window.sxPushProfile = pushProfile;

  const syncFromCloud = async () => {
    if (!store.authUser || !store.authUser.uid) return;
    const cloud = await loadUserProfile(store.authUser.uid);
    if (cloud) {
      const cloudLiked = Array.isArray(cloud.liked) ? cloud.liked : [];
      Object.keys(store.likedMap).forEach((id) => {
        if (!cloudLiked.includes(id)) cloudLiked.push(id);
      });
      cloudLiked.forEach((id) => {
        store.likedMap[id] = true;
      });
      const union = (a, b) => Array.from(new Set([...(a || []), ...(b || [])]));
      const mergedSaved = union(store.savedIds, cloud.saved);
      store.savedIds.length = 0;
      mergedSaved.forEach((id) => store.savedIds.push(id));
      const mergedFollows = union(store.follows, cloud.follows);
      store.follows.length = 0;
      mergedFollows.forEach((n) => store.follows.push(n));
      writeJson("shortxx_liked", store.likedMap);
      writeJson("shortxx_saved", store.savedIds);
      writeJson("shortxx_follows", store.follows);
      window.dispatchEvent(new CustomEvent("sx:profile-synced"));
    }
    pushProfile();
  };

  const paintAuthButton = () => {
    const label = document.querySelector("[data-login] [data-auth-label]");
    const btn = document.querySelector("[data-login]");
    if (!label || !btn) return;
    if (store.authUser && !store.authUser.isAnonymous) {
      label.textContent = "Log Out";
      btn.setAttribute("aria-label", "Log out");
    } else {
      label.textContent = "Log In";
      btn.setAttribute("aria-label", "Log in");
    }
  };

  const afterAuth = async (message) => {
    closeAuth();
    if (form) form.reset();
    await syncFromCloud();
    toast(message);
  };

  const emailFlow = async (mode) => {
    if (!auth) {
      toast("Auth unavailable — reload and retry");
      return;
    }
    const email = (emailEl.value || "").trim();
    const password = passEl.value || "";
    if (!email || !password) {
      toast("Enter email and password");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") await createUserWithEmailAndPassword(auth, email, password);
      else await signInWithEmailAndPassword(auth, email, password);
      await afterAuth(mode === "signup" ? "Account created — welcome" : "Logged in — welcome back");
    } catch (err) {
      toast(authErrorText(err && err.code));
    } finally {
      setBusy(false);
    }
  };

  if (overlay) {
    const closeBtn = document.getElementById("close-auth-btn");
    if (closeBtn) closeBtn.addEventListener("click", closeAuth);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeAuth();
    });
  }
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      emailFlow("signup");
    });
  }
  if (loginBtn) loginBtn.addEventListener("click", () => emailFlow("login"));
  if (googleBtn) {
    googleBtn.addEventListener("click", async () => {
      if (!auth) {
        toast("Auth unavailable — reload and retry");
        return;
      }
      setBusy(true);
      try {
        await signInWithPopup(auth, new GoogleAuthProvider());
        await afterAuth("Logged in with Google");
      } catch (err) {
        toast(authErrorText(err && err.code));
      } finally {
        setBusy(false);
      }
    });
  }
  if (quickBtn) {
    quickBtn.addEventListener("click", async () => {
      if (!auth) {
        toast("Auth unavailable — reload and retry");
        return;
      }
      setBusy(true);
      try {
        await signInAnonymously(auth);
        await afterAuth("Guest session started");
      } catch (err) {
        toast(authErrorText(err && err.code));
      } finally {
        setBusy(false);
      }
    });
  }
  if (auth) {
    onAuthStateChanged(auth, (user) => {
      store.authUser = user;
      paintAuthButton();
      publishIdentity();
      window.dispatchEvent(new CustomEvent("sx:auth-changed"));
      if (user) syncFromCloud();
    });
  }
  window.sxAuthSignOut = async () => {
    if (auth) {
      try {
        await signOut(auth);
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  };
}
