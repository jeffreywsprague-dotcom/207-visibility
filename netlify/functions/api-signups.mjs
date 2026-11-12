// Staff side of self-serve sign-ups: the list (with whether each first audit is ready for review),
// starting an audit by hand (after a hand-sent payment link, or if it failed to start), releasing a
// reviewed audit to the owner, and dismissing a sign-up. Password required.
import { checkAdmin, json, baseUrl } from "../lib/http.mjs";
import { getJSON, setJSON } from "../lib/store.mjs";
import { allSignups, paySignup, startSignupAudit, releaseToOwner, billingSettings, usesFoundingSpot, isTestSignup, foundingLeft } from "../lib/billing.mjs";
import { notifySettings } from "../lib/notify.mjs";
import { loadSlots, slotStuck } from "../lib/finish.mjs";
import { listKeys } from "../lib/store.mjs";
import { answersShort } from "../lib/score.mjs";
import { tradeFit } from "../lib/questions.mjs";

// Monthly audits from the last few days that stopped part-way (nobody is watching those).
async function stoppedAudits() {
  const since = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10), out = [];
  for (const k of await listKeys("audits")) {
    const id = k.split("/")[1] || "";
    if (id.slice(0, 10) < since) continue;
    const a = await getJSON("audits", k);
    if (!a || a.status === "complete" || a.source !== "monthly") continue;
    const stuck = Object.entries(await loadSlots(a)).filter(([, d]) => slotStuck(d, a)).map(([e]) => e);
    if (stuck.length) out.push({ key: a.key, business: a.client?.business || a.clientId, clientId: a.clientId, createdAt: a.createdAt, stuck });
  }
  return out;
}

export const config = { path: "/api/signups" };

// One label for the console: what, if anything, the founder needs to do next.
async function withStage(s) {
  let stage = s.status;
  const audit = s.auditKey ? await getJSON("audits", s.auditKey) : null;
  let stuck = [];
  if (s.status === "auditing" && audit && audit.status !== "complete") {
    const slots = await loadSlots(audit);
    stuck = Object.entries(slots).filter(([, d]) => slotStuck(d, audit)).map(([e]) => e);
  }
  if (s.status === "auditing") stage = audit?.status === "complete" ? "review" : stuck.length ? "stuck" : "running";
  if (s.status === "paid") stage = "start";            // paid, but the audit didn't start
  if (s.status === "checkout") stage = Date.now() - Date.parse(s.createdAt) > 3 * 3600e3 ? "abandoned" : "checkout";
  return { ...s, stage, stuck, fit: tradeFit(s.trade), spot: usesFoundingSpot(s), isTest: isTestSignup(s), short: audit?.status === "complete" ? answersShort(audit) : null, auditStatus: audit?.status || null };
}

export default async (req) => {
  const denied = checkAdmin(req);
  if (denied) return denied;
  const base = baseUrl(req);
  if (req.method === "GET") {
    const signups = await Promise.all((await allSignups()).slice(0, 80).map(withStage));
    // A second sign-up for a business that's already a client (same name and town) is worth a look before releasing.
    const clients = (await Promise.all((await listKeys("clients")).map((k) => getJSON("clients", k)))).filter(Boolean);
    const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
    for (const s of signups) {
      const other = clients.find((c) => c.id !== s.clientId && same(c.business, s.business) && same(c.town, s.town));
      if (other && s.status !== "released" && s.status !== "dismissed") s.dup = other.business;
    }
    return json({ signups, stopped: await stoppedAudits(), settings: { ...billingSettings(), email: notifySettings().email, foundingLeft: await foundingLeft() } });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  if (b.action === "release") {
    const client = await getJSON("clients", b.clientId);
    if (!client) return json({ error: "Client not found" }, 404);
    const { rec, msg, to } = await releaseToOwner(client, base);
    return json({ sent: rec?.status === "sent", status: rec?.status || "no-email", to, error: rec?.error || null, subject: msg.subject, text: msg.text, client: await getJSON("clients", client.id) });
  }

  const s = await getJSON("signups", b.id);
  if (!s) return json({ error: "Sign-up not found" }, 404);
  if (b.action === "start") {
    // Marks it paid if it wasn't (a payment link sent by hand), then starts the first audit.
    const out = s.paidAt ? await startSignupAudit(s, base) : await paySignup(s, { by: "staff" }, base);
    if (out.error) return json({ error: out.error }, 400);
    return json({ clientId: out.client.id, auditKey: out.audit?.key || null });
  }
  // Your own run-through, or a real customer after all: a test sign-up doesn't use a founding spot.
  if (b.action === "test") { s.test = !isTestSignup(s); if (!s.test && /^cs_test_/.test(s.stripeSession || "")) return json({ error: "This one was paid in Stripe’s test mode, so it stays a test." }, 400); await setJSON("signups", s.id, s); return json({ ok: true, test: s.test }); }
  if (b.action === "dismiss") { s.status = "dismissed"; await setJSON("signups", s.id, s); return json({ ok: true }); }
  return json({ error: "Unknown action" }, 400);
};
