// Cloudflare Pages middleware: rewrite pretty /@username profile URLs to the
// real /creator/index.html shell while keeping the browser URL as /@name,
// so js/pages/creator-page.js can parse the name from location.pathname.
// (The _redirects /@* -> /creator 200 rule is Netlify-only; without this,
// Cloudflare serves platform 404 + white page when assets fail.)
export async function onRequest(context) {
  try {
    const url = new URL(context.request.url);
    const path = url.pathname || "/";
    // Only intercept /@<name> (not /creator/, /creators/, or files with extensions).
    if (path === "/@" || path.startsWith("/@")) {
      const name = path.slice(2).split("/")[0];
      if (name && !name.includes(".")) {
        // Internal rewrite: browser URL stays /@name for SEO + JS parsing.
        const rewrite = new URL("/creator/index.html", url.origin);
        // Preserve query string so ?u= fallback keeps working.
        rewrite.search = url.search;
        const assetRes = await context.env.ASSETS.fetch(rewrite);
        // Re-serve with 200 even though the /@ path has no static file.
        return new Response(assetRes.body, {
          status: 200,
          headers: assetRes.headers,
        });
      }
    }
  } catch (e) {
    // Fall through to static / 404.html handling on any error.
  }
  return context.next();
}
