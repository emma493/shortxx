// Cloudflare Pages middleware.
//
// Two jobs:
// 1. Link-preview bots (X/Twitter, Facebook, Telegram, WhatsApp, …) fetching
//    the homepage get OG HTML whose og:image / twitter:image point at the
//    baked thumbnail (/og-preview.png?v=<publish-time>) managed on the Admin
//    Photo page. Humans are passed through untouched (zero perf impact).
// 2. Everything else falls through; removed routes (/creator/*, /@*, …) are
//    handled by _redirects → 404.html as before.

const BOT_RE =
  /twitterbot|facebookexternalhit|facebookcatalog|facebot|linkedinbot|slackbot|telegrambot|whatsapp|discordbot|applebot|googlebot|bingbot|bytespider|embedly|quora link preview|showyoubot|outbrain|pinterest|tumblr/i;

const PROJECT_ID = 'shortxx-live';
// Public browser API key (same as Admin bundle). Rules-gated, not secret.
const FIRESTORE_KEY = 'AIzaSyBQoIKWaWPKg8luwCjpN8LPaTd-43A1Vqo';
const META_URL =
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)` +
  `/documents/site_config/og_preview?key=${FIRESTORE_KEY}&mask.fieldPaths=updatedAt`;

async function previewVersion() {
  try {
    const res = await fetch(META_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return '';
    const doc = await res.json();
    // Prefer doc.updateTime (always present); fall back to the field value.
    const raw = doc?.updateTime || doc?.fields?.updatedAt?.timestampValue || '';
    const ms = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(ms) ? String(ms) : '';
  } catch {
    return '';
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
    const v = await previewVersion();
    const imgUrl = `https://shortxx.live/og-preview.png${v ? `?v=${v}` : ''}`;
    const out = rewriteOgImages(html, imgUrl);

    const headers = new Headers(res.headers);
    headers.set('Content-Type', 'text/html;charset=UTF-8');
    // Short edge cache: each publish bumps ?v= so crawlers re-fetch the new
    // bytes, while repeat scrapes within minutes stay fast.
    headers.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    headers.set('Vary', 'User-Agent');
    return new Response(out, { status: res.status, headers });
  } catch {
    return context.next();
  }
}
