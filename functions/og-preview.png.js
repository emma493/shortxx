// Serves the baked global link-preview thumbnail (Admin Photo page).
//
// Source of truth is Firestore `site_config/og_preview.imageData` — a
// 1200x630 JPEG dataURL composited in the Admin browser (photo + play
// button + duration pill). No Firebase Storage involved (Spark-plan safe).
// og:image / twitter:image point here; crawlers download these bytes.
//
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
    const dataUrl = doc?.fields?.imageData?.stringValue || '';
    if (!dataUrl) return fallbackLogo(request.url);
    const parsed = dataUrlToBytes(dataUrl.trim());
    if (!parsed) return fallbackLogo(request.url);

    const headers = {
      'Content-Type': parsed.mime,
      // Crawlers cache aggressively; the og:image URL carries ?v=<timestamp>
      // so each publish busts the cache while repeats stay CDN-hot.
      'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    };
    if (request.method === 'HEAD') return new Response(null, { headers });
    return new Response(parsed.bytes, { headers });
  } catch {
    return fallbackLogo(request.url);
  }
}
