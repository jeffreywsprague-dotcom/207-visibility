import { checkAdmin, json } from "../lib/http.mjs";
import { normalizeClient } from "../lib/clients.mjs";
import { getJSON, setJSON, listKeys, del } from "../lib/store.mjs";

export const config = { path: "/api/clients" };

export default async (req) => {
  const denied = checkAdmin(req);
  if (denied) return denied;
  if (req.method === "GET") {
    const keys = await listKeys("clients");
    const clients = (await Promise.all(keys.map((k) => getJSON("clients", k)))).filter(Boolean)
      .sort((a, b) => (a.business || "").localeCompare(b.business || ""));
    return json({ clients });
  }
  if (req.method === "POST") {
    const body = await req.json();
    const existing = body.client?.id ? await getJSON("clients", body.client.id) : null;
    const incoming = { ...(body.client || {}) };
    // Keep the dashboard link and plan unless this save is meant to change them.
    if (existing && incoming.shareToken === undefined) incoming.shareToken = existing.shareToken;
    if (existing && incoming.plan === undefined) incoming.plan = existing.plan;
    for (const k of ["notify", "ga4PropertyId"]) if (existing && incoming[k] === undefined) incoming[k] = existing[k];
    if (incoming.resetShare) incoming.shareToken = "";
    const c = normalizeClient(incoming);
    if (!c.business || !c.trade || !c.town) return json({ error: "Business name, trade, and town are required." }, 400);
    if (existing) c.createdAt = existing.createdAt;
    await setJSON("clients", c.id, c);
    return json({ client: c });
  }
  if (req.method === "DELETE") {
    const id = new URL(req.url).searchParams.get("id");
    if (id) await del("clients", id);
    return json({ ok: true });
  }
  return json({ error: "Method not allowed" }, 405);
};
