// Staff view of early re-checks: open requests across all clients, one client's requests,
// payments and re-check status, and running or dismissing a request.
import { checkAdmin, json, baseUrl } from "../lib/http.mjs";
import { getJSON, setJSON, listKeys } from "../lib/store.mjs";
import { runRecheck, recheckSettings, recheckStatus, requestsOf } from "../lib/recheck.mjs";
import { loadSlots, finishIfDone, slotStuck } from "../lib/finish.mjs";

export const config = { path: "/api/rechecks" };

// Payments are stored by Stripe session. Fine to scan at this scale (one per paid re-check).
async function paymentsOf(clientId) {
  const all = (await Promise.all((await listKeys("payments")).map((k) => getJSON("payments", k)))).filter(Boolean);
  return all.filter((p) => p.clientId === clientId).sort((a, b) => b.at.localeCompare(a.at));
}

export default async (req) => {
  const denied = checkAdmin(req);
  if (denied) return denied;
  const url = new URL(req.url);
  if (req.method === "GET") {
    const clientId = url.searchParams.get("clientId");
    if (!clientId) {
      // For the clients page: open requests, and re-checks that stopped partway.
      const all = (await Promise.all((await listKeys("rechecks")).map((k) => getJSON("rechecks", k)))).filter(Boolean);
      const open = all.filter((r) => r.status === "requested");
      const stuck = [];
      for (const r of all.filter((x) => x.status === "started" && x.auditKey)) {
        const audit = await getJSON("audits", r.auditKey);
        if (!audit || audit.status === "complete") continue;
        const slots = await loadSlots(audit);
        if (await finishIfDone(audit, slots)) continue;
        const list = Object.values(slots);
        if (!list.some((d) => slotStuck(d, audit))) continue;
        const total = list.reduce((t, d) => t + (d?.total || 0), 0), done = list.reduce((t, d) => t + Math.min(d?.done || 0, d?.total || 0), 0);
        stuck.push({ ...r, progress: total ? done / total : 0 });
      }
      const names = {};
      for (const id of new Set([...open, ...stuck].map((r) => r.clientId))) names[id] = (await getJSON("clients", id))?.business || id;
      const named = (list) => list.map((r) => ({ ...r, business: names[r.clientId] })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return json({ open: named(open), stuck: named(stuck), settings: recheckSettings() });
    }
    const client = await getJSON("clients", clientId);
    if (!client) return json({ error: "Client not found" }, 404);
    const [items, payments, status] = await Promise.all([requestsOf(client), paymentsOf(clientId), recheckStatus(client)]);
    return json({ items, payments, status, settings: recheckSettings() });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const client = await getJSON("clients", b.clientId);
  if (!client) return json({ error: "Client not found" }, 404);
  if (b.action === "run") {
    if ((await recheckStatus(client)).status === "running") return json({ error: "A re-check is already running for this client." }, 409);
    const rec = b.id ? await getJSON("rechecks", `${client.id}/${b.id}`) : null;
    if (b.id && (!rec || rec.status !== "requested")) return json({ error: "That request isn’t open anymore." }, 409);
    try {
      const { audit } = await runRecheck(client, baseUrl(req), rec ? { id: rec.id } : { source: "staff", paid: false });
      return json({ audit: { key: audit.key } });
    } catch (e) { return json({ error: e.message }, 400); }
  }
  if (b.action === "dismiss" && b.id) {
    const rec = await getJSON("rechecks", `${client.id}/${b.id}`);
    if (rec) { rec.status = "dismissed"; rec.dismissedAt = new Date().toISOString(); await setJSON("rechecks", `${client.id}/${b.id}`, rec); }
    return json({ ok: true });
  }
  return json({ error: "Unknown action" }, 400);
};
