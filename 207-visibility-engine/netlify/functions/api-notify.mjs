// Staff side of owner updates and analytics: the message log (outbox), sending this month's
// summary or a test now, marking a hand-sent message as sent, and testing the GA4 connection.
import { checkAdmin, json, baseUrl } from "../lib/http.mjs";
import { getJSON, setJSON, listKeys } from "../lib/store.mjs";
import { notifySettings, normNotify, digest, deliver, contextFor } from "../lib/notify.mjs";
import { ga4Settings, aiReferrals } from "../lib/ga4.mjs";

export const config = { path: "/api/notify" };

async function outboxOf(clientId) {
  const items = (await Promise.all((await listKeys("outbox", `${clientId}/`)).map((k) => getJSON("outbox", k)))).filter(Boolean);
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 40);
}

export default async (req) => {
  const denied = checkAdmin(req);
  if (denied) return denied;
  const url = new URL(req.url);
  if (req.method === "GET") {
    const clientId = url.searchParams.get("clientId");
    return json({ settings: notifySettings(), ga4: ga4Settings(), items: clientId ? await outboxOf(clientId) : [] });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const client = await getJSON("clients", b.clientId);
  if (!client) return json({ error: "Client not found" }, 404);
  const n = normNotify(client.notify);

  if (b.action === "send" || b.action === "test") {
    if (!n.byEmail && !n.byText) return json({ error: "Switch on email or texts for this client first." }, 400);
    let msg;
    if (b.action === "test") {
      const link = `${baseUrl(req)}/report/#${client.shareToken}`;
      msg = { subject: "Test from 207 Visibility", sms: `207 Visibility: this is a test. Your monthly AI visibility summary will come from this number. ${link} Reply STOP to opt out.`,
        text: `This is a test from 207 Visibility. Your monthly AI visibility summary will come from this address.\n\n${link}`,
        html: `<p>This is a test from 207 Visibility. Your monthly AI visibility summary will come from this address.</p><p><a href="${link}">Open your dashboard</a></p>` };
    } else {
      const keys = await listKeys("audits", `${client.id}/`);
      const latest = (await Promise.all(keys.map((k) => getJSON("audits", k)))).filter((a) => a && a.status === "complete" && a.summary)
        .sort((a, c) => c.createdAt.localeCompare(a.createdAt))[0];
      if (!latest) return json({ error: "No finished audit to summarize yet." }, 400);
      const { prev, site, prevSite } = await contextFor(latest);
      msg = digest(client, latest, prev, site, prevSite, baseUrl(req));
    }
    const sent = await deliver(client, msg, { reason: b.action === "test" ? "test" : "manual" });
    return json({ sent, items: await outboxOf(client.id) });
  }
  if (b.action === "mark" && b.id) {
    const rec = await getJSON("outbox", `${client.id}/${b.id}`);
    if (rec) { rec.status = "sent"; rec.sentAt = new Date().toISOString(); rec.sentBy = "staff"; await setJSON("outbox", `${client.id}/${b.id}`, rec); }
    return json({ items: await outboxOf(client.id) });
  }
  if (b.action === "ga4test") {
    if (!ga4Settings().ready) return json({ error: "GA4_SERVICE_ACCOUNT_JSON isn’t set in Netlify yet." }, 400);
    if (!client.ga4PropertyId) return json({ error: "Add the client’s GA4 property ID first." }, 400);
    try { return json({ traffic: await aiReferrals(client) }); } catch (e) { return json({ error: e.message }, 400); }
  }
  return json({ error: "Unknown action" }, 400);
};
