interface Env {
  API: { fetch(input: Request): Promise<Response> };
}

const IMMUTABLE = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

async function forward(request: Request, env: Env, url: URL): Promise<Response> {
  const target = new URL(url.pathname + url.search, "http://localhost");
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
  try {
    return await env.API.fetch(new Request(target, { method: request.method, headers, body: request.body, redirect: "manual" }));
  } catch {
    return Response.json(
      { type: "about:blank", title: "Backend unavailable", status: 503, detail: "The analysis service is offline. Try again shortly." },
      { status: 503, headers: { "content-type": "application/problem+json", "retry-after": "30" } },
    );
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET" || !IMMUTABLE.test(url.pathname)) {
      return forward(request, env, url);
    }
    const cache = (caches as unknown as { default: Cache }).default;
    const key = new Request(url.origin + url.pathname);
    const hit = await cache.match(key);
    if (hit) return hit;
    const response = await forward(request, env, url);
    if (response.status !== 200) return response;
    const stored = new Response(response.body, response);
    stored.headers.set("cache-control", "public, max-age=31536000, immutable");
    ctx.waitUntil(cache.put(key, stored.clone()));
    return stored;
  },
};
