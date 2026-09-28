// Cloudflare Pages middleware: guest-only site has no creator profiles.
// Pass everything through; removed routes (/creator/*, /@*, /creators,
// /liked, /saved) fall through to 404.html via _redirects.
export async function onRequest(context) {
  return context.next();
}
