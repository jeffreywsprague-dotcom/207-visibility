// Snapshot requests. The public snapshot page POSTs here when an owner asks for a
// full audit (no password, but rate-limited and spam-filtered). Staff list, convert,
// or dismiss requests from the console (password required).
import { checkAdmin, json, baseUrl, rid } from "../lib/http.mjs";
import { getJSON, setJSON, listKeys } from "../lib/store.mjs";
import { normalizeClient } from "../lib/clients.mjs";
import { startAudit } from "../lib/plan.mjs";

export const config = { path: "/api/leads" };

const cap = (s, n) => String(s ?? "").trim().slice(0, n);
const PER_IP_PER_DAY = 5;
const ALL_PER_DAY = 200;

function competitorsFrom(str) {
  // Snapshot format: "Main Line Fence, Cumberland; All Around Fence, Belgrade"
  return String(str || "").split(/;|\n/).map((s) => s.trim()).filter(Boolean).slice(0, 3)
    .map((s) => { const [name, town] = s.split(",").map((x) => (x || "").trim()); return { name: cap(name, 80), town: cap(town, 40), aliases: [] }; })
    .filter((c) => c.name);
}

async function bump(key, limit) {
  const n = ((await getJSON("leads-meta", key)) || 0) + 1;
  await setJSON("leads-meta", key, n);
  return n <= limit;
}

export function clientFromLead(lead) {
  return normalizeClient({
    business: lead.business, trade: lead.trade, town: lead.town, state: lead.state, radius: lead.radius,
    website: lead.nosite ? "" : lead.website, competitors: lead.competitors, testTowns: lead.targetTowns || [],
    facts: {}, tracking: false,
    // Their contact details are ready for monthly summaries; nothing is sent until they or we switch it on.
    notify: { email: lead.contact.email, phone: lead.contact.phone },
    notes: [`From snapshot request ${lead.createdAt.slice(0, 10)}.`, lead.contact.name && `Contact: ${lead.contact.name}`, lead.contact.email, lead.contact.phone,
      lead.rating && `Said Google rating: ${lead.rating}`, lead.count && `Said Google reviews: ${lead.count}`, lead.feedback && `Feedback: ${lead.feedback}`].filter(Boolean).join("\n")
  });
}

export default async (req, context) => {
  const isAdmin = !!req.headers.get("x-admin-key");

  // ---------- Public submission ----------
  if (req.method === "POST" && !isAdmin) {
    let b;
    try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    if (b.company_url) return json({ ok: true }); // honeypot: bots fill hidden fields
    const lead = {
      id: new Date().toISOString().slice(0, 10) + "-" + rid(6),
      createdAt: new Date().toISOString(), status: "new",
      business: cap(b.business, 100), trade: cap(b.trade, 60), town: cap(b.town, 50), state: cap(b.state || "ME", 2).toUpperCase(),
      radius: Math.max(1, Math.min(400, parseInt(b.radius, 10) || 15)), website: cap(b.website, 120), nosite: !!b.nosite,
      rating: cap(b.rating, 20), count: cap(b.count, 20), competitors: competitorsFrom(b.rivals),
      targetTowns: String(b.targets || "").split(/[,;\n]/).map((t) => cap(t, 40)).filter(Boolean).slice(0, 3),
      contact: { name: cap(b.contactName, 80), email: cap(b.email, 120), phone: cap(b.phone, 30) },
      feedback: cap(b.feedback, 1000), snapshot: cap(b.snapshotText, 6000)
    };
    if (!lead.business || !lead.trade || !lead.town) return json({ error: "Missing business details." }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.contact.email) && lead.contact.phone.replace(/\D/g, "").length < 10)
      return json({ error: "Add an email address or a phone number so we can send your audit." }, 400);
    const day = lead.createdAt.slice(0, 10);
    const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
    if (!(await bump(`ip/${day}/${ip}`, PER_IP_PER_DAY)) || !(await bump(`all/${day}`, ALL_PER_DAY)))
      return json({ error: "We’ve received a lot of requests today. Please try again tomorrow." }, 429);
    await setJSON("leads", lead.id, lead);

    // Optional: start a light audit automatically for every request.
    if (process.env.AUTO_AUDIT_LEADS === "true") {
      try {
        const client = clientFromLead(lead);
        await setJSON("clients", client.id, client);
        await startAudit(client, { runs: 2, maxLocations: 2 }, baseUrl(req), process.env.ADMIN_PASSWORD);
        Object.assign(lead, { status: "converted", clientId: client.id, auto: true });
        await setJSON("leads", lead.id, lead);
      } catch (e) { console.log("auto audit failed", e.message); }
    }
    return json({ ok: true });
  }

  // ---------- Staff ----------
  const denied = checkAdmin(req);
  if (denied) return denied;
  if (req.method === "GET") {
    const keys = await listKeys("leads");
    const leads = (await Promise.all(keys.map((k) => getJSON("leads", k)))).filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json({ leads });
  }
  if (req.method === "POST") {
    const b = await req.json();
    const lead = await getJSON("leads", b.id);
    if (!lead) return json({ error: "Request not found" }, 404);
    if (b.action === "dismiss") { lead.status = "dismissed"; await setJSON("leads", lead.id, lead); return json({ ok: true }); }
    if (b.action === "convert") {
      const client = clientFromLead(lead);
      await setJSON("clients", client.id, client);
      let audit = null;
      if (b.startAudit) {
        try { audit = await startAudit(client, { runs: b.runs || 3, maxLocations: 3 }, baseUrl(req), process.env.ADMIN_PASSWORD); }
        catch (e) { return json({ client, error: e.message }, 400); }
      }
      Object.assign(lead, { status: "converted", clientId: client.id });
      await setJSON("leads", lead.id, lead);
      return json({ client, audit: audit ? { key: audit.key } : null });
    }
    return json({ error: "Unknown action" }, 400);
  }
  return json({ error: "Method not allowed" }, 405);
};
