import { checkAdmin, json, baseUrl } from "../lib/http.mjs";
import { answersShort } from "../lib/score.mjs";
import { getJSON, listKeys } from "../lib/store.mjs";
import { startAudit } from "../lib/plan.mjs";

export const config = { path: "/api/audits" };

export default async (req) => {
  const denied = checkAdmin(req);
  if (denied) return denied;
  if (req.method === "GET") {
    const clientId = new URL(req.url).searchParams.get("clientId");
    if (!clientId) return json({ error: "clientId required" }, 400);
    const keys = await listKeys("audits", `${clientId}/`);
    const audits = (await Promise.all(keys.map((k) => getJSON("audits", k)))).filter(Boolean).map((a) => ({
      key: a.key, id: a.id, kind: a.kind || "audit", createdAt: a.createdAt, status: a.status, engines: a.plan.engines, runs: a.plan.runs,
      locations: a.plan.locations.map((l) => l.town), estimatedCost: a.plan.estimatedCost, short: a.summary ? answersShort(a) : null,
      rates: a.summary ? a.summary.entities.map((e) => ({ name: e.name, isClient: e.isClient, rate: e.overall.rate, low: e.overall.low, high: e.overall.high })) : null
    })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json({ audits });
  }
  if (req.method === "POST") {
    const body = await req.json();
    const client = await getJSON("clients", body.clientId);
    if (!client) return json({ error: "Client not found" }, 404);
    try {
      const audit = await startAudit(client, body, baseUrl(req), process.env.ADMIN_PASSWORD);
      return json({ audit: { key: audit.key, id: audit.id, plan: audit.plan } });
    } catch (e) {
      return json({ error: e.message }, 400);
    }
  }
  return json({ error: "Method not allowed" }, 405);
};
