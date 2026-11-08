export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

// Every API route and the background workers require the admin password.
export function checkAdmin(req) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return json({ error: "ADMIN_PASSWORD is not set in Netlify environment variables." }, 500);
  const got = req.headers.get("x-admin-key") || "";
  if (got.length !== expected.length) return json({ error: "Wrong password." }, 401);
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? null : json({ error: "Wrong password." }, 401);
}

export function baseUrl(req) {
  return process.env.URL || (req ? new URL(req.url).origin : "");
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "client";
}
export function rid(n = 6) {
  return Math.random().toString(36).slice(2, 2 + n);
}
