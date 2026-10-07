// Cloudflare Pages middleware.
//
// Two jobs:
// 1. Link-preview bots (X/Twitter, Facebook, Telegram, WhatsApp, …) fetching
//    the homepage get OG HTML whose og:image / twitter:image point directly
//    at the baked thumbnail on Cloudinary CDN (managed on the Admin Photo
//    page). Each publish is a brand-new Cloudinary asset, so crawler caches
//    bust themselves — no version param needed. Humans are passed through
//    untouched (zero perf impact).
// 2. Everything else falls through; removed routes (/creator/*, /@*, …) are
//    handled by _redirects → 404.html as before.

const BOT_RE =
  /twitterbot|facebookexternalhit|facebookcatalog|facebot|linkedinbot|slackbot|telegrambot|whatsapp|discordbot|applebot|googlebot|bingbot|bytespider|embedly|quora link preview|showyoubot|outbrain|pinterest|tumblr/i;

const PROJECT_ID = 'shortxx-live';
// Public browser API key (same as Admin bundle). Rules-gated, not secret.
const FIRESTORE_KEY = 'AIzaSyBQoIKWaWPKg8luwCjpN8LPaTd-43A1Vqo';
const META_URL =
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)` +
  `/documents/site_config/og_preview?key=${FIRESTORE_KEY}&mask.fieldPaths=imageUrl`;
const FALLBACK_IMG = 'https://shortxx.live/og-preview.png';

async function previewImageUrl() {
  try {
    const res = await fetch(META_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return FALLBACK_IMG;
    const doc = await res.json();
    const u = doc?.fields?.imageUrl?.stringValue || '';
    // Only trust Cloudinary CDN URLs; anything else falls back to the
    // redirect shim (which also serves legacy inline-byte docs + logo).
    return /^https:\/\/res\.cloudinary\.com\//.test(u.trim()) ? u.trim() : FALLBACK_IMG;
  } catch {
    return FALLBACK_IMG;
  }
}

function rewriteOgImages(html, imgUrl) {
  // Order-independent: find each og:image / twitter:image meta tag, then swap
  // only its content attribute. Leaves image_src links + preloads alone.
  return html.replace(
    /<meta[^>]*?(?:property="og:image(?::secure_url)?"|name="twitter:image")[^>]*?>/gi,
    (tag) => tag.replace(/content="[^"]*"/i, `content="${imgUrl}"`)
  );
}

export async function onRequest(context) {
  const { request } = context;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return context.next();
  }

  const isHome = url.pathname === '/' || url.pathname === '/index.html';
  if (request.method !== 'GET' || !isHome) return context.next();

  const ua = request.headers.get('user-agent') || '';
  if (!BOT_RE.test(ua)) return context.next();

  try {
    const res = await context.next();
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return res;

    const html = await res.text();
    const imgUrl = await previewImageUrl();
    const out = rewriteOgImages(html, imgUrl);

    const headers = new Headers(res.headers);
    headers.set('Content-Type', 'text/html;charset=UTF-8');
    // Short edge cache: each publish is a new Cloudinary URL, so crawlers
    // pick up the new image on next scrape while repeats stay fast.
    headers.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    headers.set('Vary', 'User-Agent');
    return new Response(out, { status: res.status, headers });
  } catch {
    return context.next();
  }
}
