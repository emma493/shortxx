import { store } from "../store.js";

/* js/features/menu.js — slide-out sidebar drawer only. CSS lives in
 * css/features/menu.css (moved out of JS injection). */

let sheet = null;
let drawer = null;

function isInstalled() {
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch (e) {}
  if (window.navigator.standalone === true) return true;
  try {
    return localStorage.getItem("shortxx_pwa_installed") === "1";
  } catch (e) {
    return false;
  }
}

export async function init(ctx) {
  const menuBtn = document.getElementById("menu-btn");
  const moreBtn = document.getElementById("more-btn");
  const toast = ctx.toast || (() => {});
  if (!menuBtn && !moreBtn) return;

  function build() {
    if (sheet) return sheet;
    const wrap = document.createElement("div");
    wrap.className = "sx-menu-root";
    wrap.style.display = "none";
    wrap.innerHTML =
      '<div class="sx-sidebar-backdrop" data-close></div>' +
      '<aside class="sx-sidebar" aria-label="Site navigation">' +
      '<div class="sx-sidebar-header"><div class="sx-sidebar-title">Shortxx</div>' +
      '<div class="sx-sidebar-actions">' +
      '<button class="sx-login-btn" data-login><i class="fas fa-sign-in-alt"></i><span data-auth-label>Log In</span></button>' +
      '<button class="sx-close-btn" data-close aria-label="Close menu">✕</button></div></div>' +
      '<nav><button class="sidebar-link active-link" data-go="home"><i class="fas fa-home"></i><span>Home</span></button>' +
      '<button class="sidebar-link" data-go="discover"><i class="fas fa-compass"></i><span>Discover</span></button>' +
      '<button class="sidebar-link" data-go="following"><i class="fas fa-user-check"></i><span>Following feed</span></button>' +
      '<button class="sidebar-link" data-go="top"><i class="fas fa-fire"></i><span>Top videos</span></button>' +
      '<button class="sidebar-link" data-go="saved"><i class="fas fa-bookmark"></i><span>Saved Videos</span></button>' +
      (isInstalled() ? "" : '<button class="sidebar-link" data-act="install"><i class="fas fa-download"></i><span>Install App</span></button>') +
      "</nav>" +
      '<div class="sx-div"></div><nav>' +
      '<a class="sidebar-link" href="https://go.whitetrafsa.com?userId=dd571e000ae6f07ef31fa3fb50db3d7353ab3ba1c6c501e61a894d69b80e96ae" target="_blank" rel="noopener"><i class="fas fa-video"></i><span>Live Cams</span></a>' +
      "</nav>" +
      '<div class="sx-footer"><div><a href="#" data-dead>Terms of Service</a><a href="#" data-dead>Privacy Policy</a></div>' +
      '<a href="#" data-dead class="prefer">Prefer us on Google</a></div></aside>';
    document.body.appendChild(wrap);
    sheet = wrap;
    drawer = wrap.querySelector(".sx-sidebar");
    wrap.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeMenu));
    wrap.querySelector("[data-login]").addEventListener("click", async () => {
      if (store.authUser && !store.authUser.isAnonymous) {
        closeMenu();
        const ok = window.sxAuthSignOut ? await window.sxAuthSignOut() : false;
        toast(ok ? "Logged out" : "Log out failed");
      } else {
        closeMenu();
        if (window.sxOpenAuth) window.sxOpenAuth();
      }
    });
    wrap.querySelectorAll("[data-dead]").forEach((el) =>
      el.addEventListener("click", (e) => e.preventDefault()),
    );
    wrap.querySelectorAll("[data-go]").forEach((el) =>
      el.addEventListener("click", () => {
        const go = el.getAttribute("data-go");
        closeMenu();
        if (go === "home") location.href = "./index.html";
        else if (go === "discover") window.sxOpenDiscover && window.sxOpenDiscover("all");
        else if (go === "saved") window.sxOpenDiscover && window.sxOpenDiscover("saved");
        else if (go === "following" || go === "top") window.sxSwitchFeed && window.sxSwitchFeed(go);
      }),
    );
    const installEl = wrap.querySelector('[data-act="install"]');
    if (installEl) {
      installEl.addEventListener("click", async () => {
        closeMenu();
        const helper = window.ShortxxPWA;
        if (helper && helper.canPrompt()) {
          const outcome = await helper.promptInstall();
          if (outcome === "accepted") {
            try {
              localStorage.setItem("shortxx_pwa_installed", "1");
            } catch (e) {}
            toast("Shortxx installed");
          }
        } else if (/iphone|ipad|ipod/i.test(navigator.userAgent || "")) {
          toast("iPhone: tap Share, then Add to Home Screen");
        } else {
          toast("Use your browser menu: Add to Home Screen");
        }
      });
    }
    // Paint login label when auth state changes
    window.addEventListener("sx:auth-changed", paintAuth);
    return wrap;
  }

  function paintAuth() {
    if (!sheet) return;
    const label = sheet.querySelector("[data-login] [data-auth-label]");
    const btn = sheet.querySelector("[data-login]");
    if (!label || !btn) return;
    if (store.authUser && !store.authUser.isAnonymous) {
      label.textContent = "Log Out";
      btn.setAttribute("aria-label", "Log out");
    } else {
      label.textContent = "Log In";
      btn.setAttribute("aria-label", "Log in");
    }
  }

  function openMenu(from) {
    const wrap = build();
    if (drawer) drawer.classList.toggle("left", from === "left");
    paintAuth();
    wrap.style.display = "";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        wrap.querySelector(".sx-sidebar-backdrop").classList.add("active");
        drawer.classList.add("active");
      });
    });
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "true");
  }

  function closeMenu() {
    if (!sheet || sheet.style.display === "none") return;
    sheet.querySelector(".sx-sidebar-backdrop").classList.remove("active");
    if (drawer) drawer.classList.remove("active");
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
    setTimeout(() => {
      if (sheet) sheet.style.display = "none";
    }, 300);
  }
  window.sxCloseMenu = closeMenu;

  if (menuBtn) {
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (sheet && sheet.style.display !== "none") closeMenu();
      else openMenu("left");
    });
  }
  if (moreBtn) {
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openMenu("right");
    });
  }
}
