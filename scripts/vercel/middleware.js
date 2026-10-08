/**
 * Vercel Routing Middleware (Edge) for the online sample: HTTP Basic auth on every request, static pages and /api
 * alike. Any user name; the password is the project env var SITE_PASSWORD (never committed). Without it the site
 * stays closed. Copied as-is by build.mjs into .vercel/output/functions/_middleware.func/index.js.
 */
const REALM = "food-sources-viewer (sample)";

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function passwordOf(request) {
  const auth = request.headers.get("authorization") || "";
  const m = /^Basic\s+(.+)$/i.exec(auth);
  if (!m) return null;
  try {
    const bytes = Uint8Array.from(atob(m[1].trim()), (c) => c.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    const i = decoded.indexOf(":");
    return i < 0 ? null : decoded.slice(i + 1);
  } catch {
    return null;
  }
}

export default function middleware(request) {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) {
    return new Response("This deployment has no SITE_PASSWORD set, so it stays closed.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const given = passwordOf(request);
  if (given !== null && safeEqual(given, expected)) {
    // Pass through to the static files / API function.
    return new Response(null, { headers: { "x-middleware-next": "1" } });
  }
  return new Response("Password required.", {
    status: 401,
    headers: {
      "www-authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
