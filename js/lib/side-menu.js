/* js/lib/side-menu.js — SINGLE SOURCE OF TRUTH for the slide-out drawer.
 * index.html #menu-btn opens this. Discover / Trending / Profile overlays
 * embed an identical clone so "top-left menu" shows the SAME items
 * everywhere: Home, Discover, Trending, Creators, Following feed,
 * Saved Videos, Liked Videos, Preferences, Install App (when not installed),
 * Live Cams + Terms/Privacy/Contact/DMCA/2257 footer. */

export function isAppInstalled() {
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch (e) {}
  if (window.navigator && window.navigator.standalone === true) return true;
  try {
    return localStorage.getItem("shortxx_pwa_installed") === "1";
  } catch (e) {
    return false;
  }
}

export function getMenuHTML() {
  const installRow = isAppInstalled()
    ? ""
    : '<button class="sidebar-link" data-act="install"><i class="fas fa-download"></i><span>Install App</span></button>';
  return (
    '<div class="sx-sidebar-backdrop" data-close></div>' +
    '<aside class="sx-sidebar" aria-label="Site navigation">' +
    '<div class="sx-sidebar-header"><div class="sx-sidebar-title">Shortxx</div>' +
    '<div class="sx-sidebar-actions">' +
    '<button class="sx-signup-btn" data-signup>Sign Up</button>' +
    '<button class="sx-close-btn" data-close aria-label="Close menu"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></div></div>' +
    '<nav>' +
    '<button class="sidebar-link" data-go="home"><i class="fas fa-home"></i><span>Home</span></button>' +
    '<button class="sidebar-link" data-go="discover"><i class="fas fa-compass"></i><span>Discover</span></button>' +
    '<button class="sidebar-link" data-go="trending"><i class="fas fa-fire"></i><span>Trending</span></button>' +
    '<button class="sidebar-link" data-go="creators"><i class="fas fa-users"></i><span>Creators</span></button>' +
    '<button class="sidebar-link" data-go="following"><i class="fas fa-user-check"></i><span>Following feed</span></button>' +
    '<button class="sidebar-link" data-go="saved"><i class="fas fa-bookmark"></i><span>Saved Videos</span></button>' +
    '<button class="sidebar-link" data-go="liked"><i class="fas fa-heart"></i><span>Liked Videos</span></button>' +
    '<button class="sidebar-link" data-act="preferences"><i class="fas fa-sliders-h"></i><span>Preferences</span></button>' +
    '<button class="sidebar-link" data-login aria-label="Log in"><i class="fas fa-sign-in-alt"></i><span data-auth-label>Log In</span></button>' +
    installRow +
    "</nav>" +
    '<div class="sx-div"></div><nav>' +
    '<a class="sidebar-link" href="https://go.whitetrafsa.com?userId=dd571e000ae6f07ef31fa3fb50db3d7353ab3ba1c6c501e61a894d69b80e96ae" target="_blank" rel="noopener"><i class="fas fa-video"></i><span>Live Cams</span></a>' +
    "</nav></aside>"
  );
}

/* Wire one drawer root. deps: { close(), toast() }.
 * Uses the same global pipeline as index: sxOpenDiscover / sxOpenTrending /
 * sxSwitchFeed, so items behave identically on every page. */
export function wireMenu(root, deps) {
  const toast = (deps && deps.toast) || (() => {});
  const close = (deps && deps.close) || (() => {
    root.style.display = "none";
  });
  const signup = root.querySelector("[data-signup]");
  if (signup) {
    signup.addEventListener("click", () => {
      close();
      if (window.sxOpenAuth) window.sxOpenAuth();
    });
  }
  // Login/logout row: toggles via the shared entry so the drawer label
  // (painted by auth.js paintAuthButton) always matches session state.
  const login = root.querySelector("[data-login]");
  if (login) {
    login.addEventListener("click", async () => {
      close();
      if (window.sxAuthEntry) await window.sxAuthEntry();
      else if (window.sxOpenAuth) window.sxOpenAuth();
    });
  }
  // Freshly built drawer may postdate the last auth paint — repaint now.
  try {
    if (window.sxPaintAuth) window.sxPaintAuth();
  } catch (e) {}
  root.querySelectorAll("[data-dead]").forEach((el) =>
    el.addEventListener("click", (e) => e.preventDefault()),
  );
  root.querySelectorAll("[data-close]").forEach((el) =>
    el.addEventListener("click", close),
  );
  root.querySelectorAll("[data-go]").forEach((el) =>
    el.addEventListener("click", () => {
      const go = el.getAttribute("data-go");
      close();
      // Small delay so the drawer can animate out before overlay swaps.
      setTimeout(() => {
        if (go === "home") {
          if (window.sxCloseDiscover) { try { window.sxCloseDiscover(); } catch (e) {} }
          if (window.sxCloseTrending) { try { window.sxCloseTrending(); } catch (e) {} }
          if (window.sxCloseCreator) { try { window.sxCloseCreator(); } catch (e) {} }
          if (location.pathname.endsWith("index.html") || location.pathname === "/") {
            if (window.sxSwitchFeed && (go === "following")) return;
            // already home — nothing else to do
          } else {
            location.href = "./index.html";
          }
        }
        else if (go === "discover") window.sxOpenDiscover && window.sxOpenDiscover("all");
        else if (go === "saved") window.sxOpenDiscover && window.sxOpenDiscover("saved");
        else if (go === "trending") window.sxOpenTrending && window.sxOpenTrending("all");
        else if (go === "creators") location.href = "./creators/";
        else if (go === "liked") location.href = "./liked/";
        else if (go === "following" || go === "top") {
          if (window.sxSwitchFeed) window.sxSwitchFeed(go);
          else location.href = "./index.html";
        }
      }, 60);
    }),
  );
  const installEl = root.querySelector('[data-act="install"]');
  if (installEl) {
    installEl.addEventListener("click", async () => {
      close();
      const helper = window.ShortxxPWA;
      try {
        if (helper && helper.canPrompt()) {
          const outcome = await helper.promptInstall();
          if (outcome === "accepted") {
            try { localStorage.setItem("shortxx_pwa_installed", "1"); } catch (e) {}
            toast("Shortxx installed");
          }
        } else if (/iphone|ipad|ipod/i.test(navigator.userAgent || "")) {
          toast("iPhone: tap Share, then Add to Home Screen");
        } else {
          toast("Use your browser menu: Add to Home Screen");
        }
      } catch (e) {}
    });
  }
  // Preferences row: opens the content-preference popup on the feed; from
  // folder pages (no prefs module loaded) hop to the feed which opens it.
  const prefsEl = root.querySelector('[data-act="preferences"]');
  if (prefsEl) {
    prefsEl.addEventListener("click", () => {
      close();
      setTimeout(() => {
        try {
          if (window.sxOpenPrefs) window.sxOpenPrefs(true);
          else location.href = "/index.html?prefs=1";
        } catch (e) {}
      }, 60);
    });
  }
}

/* Build + attach a hidden drawer clone inside a given parent (overlay root
 * or document.body). Returns { root, open, close, isOpen }. */
export function attachMenuClone(parent, deps) {
  const wrap = document.createElement("div");
  wrap.className = "sx-menu-root sx-menu-clone";
  wrap.style.display = "none";
  wrap.innerHTML = getMenuHTML();
  parent.appendChild(wrap);
  const drawer = wrap.querySelector(".sx-sidebar");
  const backdrop = wrap.querySelector(".sx-sidebar-backdrop");

  function open() {
    wrap.style.display = "block";
    wrap.removeAttribute("hidden");
    try {
      if (window.sxPaintAuth) window.sxPaintAuth();
    } catch (e) {}
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (backdrop) backdrop.classList.add("active");
        if (drawer) drawer.classList.add("active");
      });
    });
  }
  function close() {
    if (backdrop) backdrop.classList.remove("active");
    if (drawer) drawer.classList.remove("active");
    setTimeout(() => { wrap.style.display = "none"; }, 300);
  }
  function isOpen() {
    return wrap.style.display !== "none";
  }
  wireMenu(wrap, { close, toast: (deps && deps.toast) || (() => {}) });
  return { root: wrap, open, close, isOpen };
}
