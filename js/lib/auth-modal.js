/* js/lib/auth-modal.js — SINGLE SOURCE OF TRUTH for the auth modal markup.
 * index.html carries the modal inline; every standalone sub-page
 * (discover, trending, creators, liked, saved, creator) gets it injected by
 * ensureAuthModal() so login/signup/Google/guest work everywhere with the
 * exact same element IDs that js/features/auth.js wires up. */

const MODAL_HTML =
  '<div class="auth-card">' +
  '<button id="close-auth-btn" class="auth-close-btn" aria-label="Close"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>' +
  '<div class="auth-avatar-wrapper">' +
  '<svg class="auth-avatar-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
  '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>' +
  '<circle cx="12" cy="7" r="4"></circle>' +
  "</svg>" +
  "</div>" +
  '<h2 id="auth-title" class="auth-title">Sign Up</h2>' +
  '<p class="auth-subtitle">Free forever · saves sync everywhere · feed learns your taste</p>' +
  '<form id="auth-form">' +
  '<div class="input-group">' +
  '<input type="email" id="auth-email" placeholder="Email address" required autocomplete="email">' +
  "</div>" +
  '<div class="input-group">' +
  '<input type="password" id="auth-password" placeholder="Password" required autocomplete="current-password">' +
  "</div>" +
  '<div class="auth-btn-row">' +
  '<button type="button" id="submit-login-btn" class="btn-secondary">Log In</button>' +
  '<button type="submit" id="submit-signup-btn" class="btn-primary">Sign Up</button>' +
  "</div>" +
  "</form>" +
  '<div class="auth-divider"><span>OR</span></div>' +
  '<button id="google-auth-btn" class="btn-google">' +
  '<svg class="google-icon" viewBox="0 0 24 24">' +
  '<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>' +
  '<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>' +
  '<path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>' +
  '<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>' +
  "</svg>" +
  "Continue with Google" +
  "</button>" +
  '<p class="privacy-note">Private: Google shares only your email with us. Nothing ever appears on your Google account.</p>' +
  '<button id="quick-login-btn" class="btn-quick-login">⚡ Quick Login (Guest Session)</button>' +
  "</div>";

/* Inject the shared modal when the page has no inline copy (sub-pages).
 * Returns the overlay element. Safe to call repeatedly. */
export function ensureAuthModal() {
  let overlay = document.getElementById("auth-modal-overlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "auth-modal-overlay";
  overlay.className = "auth-overlay hidden";
  overlay.innerHTML = MODAL_HTML;
  document.body.appendChild(overlay);
  return overlay;
}
