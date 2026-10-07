// Redirect shim for the global link-preview thumbnail (Admin Photo page).
//
// Source of truth is Firestore `site_config/og_preview.imageUrl` — the baked
// 1200x630 thumbnail (photo + play button + duration pill) hosted on
// Cloudinary CDN. This route 302-redirects there so the static index.html
// default (`/og-preview.png`) and any old shares keep working with no
// redeploy after each publish. Every publish is a brand-new Cloudinary
// asset, so crawler caches bust themselves.
//
// Legacy: docs published before the Cloudinary switch carry baked bytes
// inline (`imageData` dataURL) — those are still served directly.
// Fallback: if the doc is missing/unreadable, serve the static logo.png.

const PROJECT_ID = 'shortxx-live';
// Public browser API key (same one shipped in the Admin bundle + readable by
// anyone). Access is gated by firestore.rules, not by key secrecy.
const FIRESTORE_KEY = 'AIzaSyBQoIKWaWPKg8luwCjpN8LPaTd-43A1Vqo';
const DOC_URL =
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)` +
  `/documents/site_config/og_preview?key=${FIRESTORE_KEY}`;

function dataUrlToBytes(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const b64 = m[2];
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1], bytes };
}

async function fallbackLogo(url) {
  try {
    const res = await fetch(new URL('/logo.png', url));
    if (!res.ok) return new Response('preview unavailable', { status: 503 });
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return new Response('preview unavailable', { status: 503 });
  }
}

export async function onRequest(context) {
  const { request } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }
  try {
    const apiRes = await fetch(DOC_URL, {
      headers: { Accept: 'application/json' },
      // Don't let a slow Firestore read hang the crawler long.
      signal: AbortSignal.timeout(6000),
    });
    if (!apiRes.ok) return fallbackLogo(request.url);
    const doc = await apiRes.json();
    const fields = doc?.fields || {};

    // Primary (Cloudinary era): redirect to the CDN URL.
    const imageUrl = fields?.imageUrl?.stringValue || '';
    if (/^https:\/\/res\.cloudinary\.com\//.test(imageUrl.trim())) {
      const headers = {
        Location: imageUrl.trim(),
        // Short cache: each publish is a new URL, so the redirect target
        // changes — crawlers re-resolve quickly while repeats stay fast.
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'Access-Control-Allow-Origin': '*',
      };
      return new Response(null, { status: 302, headers });
    }

    // Legacy (pre-Cloudinary) docs: serve the inline baked bytes.
    const dataUrl = fields?.imageData?.stringValue || '';
    if (dataUrl) {
      const parsed = dataUrlToBytes(dataUrl.trim());
      if (parsed) {
        const headers = {
          'Content-Type': parsed.mime,
          'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
          'Access-Control-Allow-Origin': '*',
          'X-Content-Type-Options': 'nosniff',
        };
        if (request.method === 'HEAD') return new Response(null, { headers });
        return new Response(parsed.bytes, { headers });
      }
    }
    return fallbackLogo(request.url);
  } catch {
    return fallbackLogo(request.url);
  }
}
