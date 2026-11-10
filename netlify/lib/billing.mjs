// Self-serve sign-ups and billing: prices (set in Netlify), founding spots, Stripe calls, turning a
// paid sign-up into a client and its first audit, and releasing the reviewed audit to the owner.
import { randomBytes } from "node:crypto";
import { getJSON, setJSON, listKeys } from "./store.mjs";
import { normalizeClient } from "./clients.mjs";
import { startAudit } from "./plan.mjs";
import { sendOne, alertFounder, cleanEmail, cleanPhone } from "./notify.mjs";

const cents = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };
export const money = (c) => "$" + (c % 100 ? (c / 100).toFixed(2) : String(c / 100));

export function billingSettings() {
  return {
    mode: process.env.STRIPE_SECRET_KEY ? "stripe" : "request",
    open: process.env.SIGNUP_ENABLED !== "false",
    auditCents: cents(process.env.AUDIT_PRICE_CENTS, 9900),
    monthlyCents: cents(process.env.MONTHLY_PRICE_CENTS, 4900),
    yearlyCents: cents(process.env.YEARLY_PRICE_CENTS, 49000),          // 0 turns the yearly option off
    foundingSpots: cents(process.env.FOUNDING_SPOTS, 25),               // 0 turns founding prices off
    foundingAuditCents: cents(process.env.FOUNDING_AUDIT_CENTS, 4900),
    foundingMonthlyCents: cents(process.env.FOUNDING_MONTHLY_CENTS, 3900),
    foundingYearlyCents: cents(process.env.FOUNDING_YEARLY_CENTS, 39000)
  };
}

export async function allSignups() {
  const keys = await listKeys("signups");
  return (await Promise.all(keys.map((k) => getJSON("signups", k)))).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Founding spots are taken by paid sign-ups only, so an abandoned checkout never uses one up.
export async function foundingLeft() {
  const st = billingSettings();
  if (!st.foundingSpots) return 0;
  const used = (await allSignups()).filter((s) => s.founding && s.paidAt).length;
  return Math.max(0, st.foundingSpots - used);
}

// What the sign-up page, the home page and the dashboard show.
export async function publicPrices() {
  const st = billingSettings(), left = await foundingLeft();
  return {
    mode: st.mode, open: st.open,
    contact: { name: process.env.CONTACT_NAME || "", email: cleanEmail(process.env.CONTACT_EMAIL) || "", phone: process.env.CONTACT_PHONE || "" },
    audit: st.auditCents, monthly: st.monthlyCents, yearly: st.yearlyCents || null,
    founding: left > 0 ? { left, spots: st.foundingSpots, audit: st.foundingAuditCents, monthly: st.foundingMonthlyCents, yearly: st.yearlyCents ? st.foundingYearlyCents : null } : null
  };
}

// The monthly and yearly prices for one client: founding owners keep their founding price.
export function clientPrices(client) {
  const st = billingSettings(), f = !!client.billing?.founding;
  return { monthly: f ? st.foundingMonthlyCents : st.monthlyCents, yearly: st.yearlyCents ? (f ? st.foundingYearlyCents : st.yearlyCents) : null, founding: f };
}

export async function stripe(path, params) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Stripe: HTTP ${res.status}`);
  return data;
}

/* ---------- Sign-ups ---------- */
const cap = (s, n) => String(s ?? "").trim().replace(/\s+/g, " ").slice(0, n);
export const signupId = () => `${new Date().toISOString().slice(0, 10)}-${randomBytes(6).toString("base64url")}`;

function competitorsFrom(v) {
  const rows = Array.isArray(v) ? v : String(v || "").split(/;|\n/);
  return rows.map((r) => (typeof r === "object" && r ? [r.name, r.town] : String(r).split(",")))
    .map(([name, town]) => ({ name: cap(name, 80), town: cap(town, 40), aliases: [] })).filter((c) => c.name).slice(0, 3);
}

// Cleans what the sign-up form sent. Returns { signup } or { error }.
export function readSignup(b) {
  const phones = String(b.phones || "").split(/[,;\n]/).map((p) => p.trim()).filter(Boolean)
    .filter((p) => p.replace(/\D/g, "").length >= 10).slice(0, 4).map((p) => cap(p, 25));
  const s = {
    business: cap(b.business, 100), trade: cap(b.trade, 60), town: cap(b.town, 50), state: cap(b.state || "ME", 2).toUpperCase(),
    radius: Math.max(1, Math.min(400, parseInt(b.radius, 10) || 15)),
    website: b.nosite ? "" : cap(b.website, 120).replace(/^https?:\/\//i, "").replace(/\/$/, ""), nosite: !!b.nosite,
    phones: phones.join(", "), address: cap(b.address, 160), hours: cap(b.hours, 120),
    targetTowns: String(b.targets || "").split(/[,;\n]/).map((t) => cap(t, 40)).filter(Boolean).slice(0, 2),   // the audit asks from the main town plus two more
    competitors: competitorsFrom(b.rivals),
    contact: { name: cap(b.name, 80), email: cleanEmail(b.email), phone: cleanPhone(b.mobile) || cap(b.mobile, 25) },
    notes: cap(b.notes, 1000)
  };
  if (!s.business || !s.trade || !s.town) return { error: "Add your business name, what you do and your town." };
  if (!s.phones) return { error: "Add the phone number customers call, with the area code." };
  if (!s.contact.name) return { error: "Add your name." };
  if (!s.contact.email) return { error: "Add an email address. That’s where your dashboard link goes." };
  if (!b.agree) return { error: "Please tick the box to agree to the terms." };
  return { signup: s };
}

export function clientFromSignup(s) {
  return normalizeClient({
    business: s.business, trade: s.trade, town: s.town, state: s.state, radius: s.radius, website: s.website,
    competitors: s.competitors, testTowns: s.targetTowns,
    facts: { phone: s.phones, hours: s.hours, address: s.address },
    tracking: false,
    // The dashboard link and monthly summaries go to the email they signed up with.
    notify: { email: s.contact.email, phone: s.contact.phone, byEmail: true },
    notes: [`Self-serve sign-up ${s.createdAt.slice(0, 10)}${s.founding ? " (founding price)" : ""}.`, `Contact: ${s.contact.name}`, s.contact.email, s.contact.phone,
      s.notes && `Note from the owner: ${s.notes}`].filter(Boolean).join("\n"),
    billing: { plan: "audit", status: s.paidAt ? "paid" : "requested", founding: s.founding, signupId: s.id, customerId: s.customerId || null,
      auditCents: s.paidCents ?? s.priceCents, paidAt: s.paidAt || null }
  });
}

// Records the payment (Stripe or marked by hand) and starts the first audit. Safe to call twice.
export async function paySignup(signup, pay, base) {
  if (!signup.paidAt) {
    Object.assign(signup, { paidAt: new Date().toISOString(), paidCents: pay.amountCents ?? signup.priceCents, paidBy: pay.by || "stripe",
      customerId: pay.customerId || signup.customerId || null, stripeSession: pay.session || signup.stripeSession || null, status: "paid" });
    await setJSON("signups", signup.id, signup);
  }
  return startSignupAudit(signup, base);
}

export async function startSignupAudit(signup, base) {
  let client = signup.clientId ? await getJSON("clients", signup.clientId) : null;
  if (!client) {
    client = clientFromSignup(signup);
    await setJSON("clients", client.id, client);
    signup.clientId = client.id;
    await setJSON("signups", signup.id, signup);
  } else if (client.billing && signup.paidAt && !client.billing.paidAt) {
    client.billing = { ...client.billing, status: "paid", paidAt: signup.paidAt, customerId: signup.customerId || client.billing.customerId, auditCents: signup.paidCents };
    await setJSON("clients", client.id, normalizeClient(client));
  }
  if (signup.auditKey) return { client, audit: await getJSON("audits", signup.auditKey) };
  // Two payment notices arriving together must not start two audits.
  if (signup.startingAt && Date.now() - signup.startingAt < 60e3) return { client, audit: null, pending: true };
  signup.startingAt = Date.now();
  await setJSON("signups", signup.id, signup);
  try {
    const audit = await startAudit(client, { runs: 3, maxLocations: 3, source: "signup" }, base, process.env.ADMIN_PASSWORD);
    Object.assign(signup, { auditKey: audit.key, status: "auditing" });
    delete signup.error; delete signup.startingAt;
    await setJSON("signups", signup.id, signup);
    return { client, audit };
  } catch (e) {
    signup.error = String(e.message).slice(0, 300);
    delete signup.startingAt;
    await setJSON("signups", signup.id, signup);
    return { client, audit: null, error: signup.error };
  }
}

/* ---------- Releasing the reviewed audit ---------- */
export function releaseMessage(client, base) {
  const link = `${base}/report/#${client.shareToken}`, p = clientPrices(client);
  const first = String(client.notes || "").match(/Contact: ([^\n]+)/)?.[1]?.split(/\s+/)[0] || "";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const monthly = `${money(p.monthly)} a month${p.founding ? ", your founding price" : ""}`;
  const subject = `Your AI visibility audit is ready: ${client.business}`;
  const lines = [
    `${first ? `Hi ${first},` : "Hello,"}`,
    `Your audit for ${client.business} is ready. Your private dashboard shows how often AI names you when customers ask, who it names instead, every answer we collected and your step-by-step plan.`,
    `Start with “What needs attention” on the Overview tab, then work through the steps in Your plan. Tick each one off as you finish it.`,
    `Keep this link private: anyone who has it can see your dashboard.`,
    `Want it re-measured every month? You can start the monthly plan from your dashboard (${monthly}, cancel anytime).`,
    `Questions? Just reply to this email. Want a step done for you? Ask, and we’ll quote a set price first.`
  ];
  const text = [lines[0], "", lines[1], "", `Your dashboard: ${link}`, "", ...lines.slice(2).flatMap((l) => [l, ""]), "207 Visibility · Maine-owned. Maine-run."].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#F3F6FB;font-family:Helvetica,Arial,sans-serif;color:#27344E">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F6FB;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#001536;color:#fff;padding:18px 24px;font-weight:bold;font-size:15px">207 Visibility <span style="color:#A9B8D6;font-weight:normal">· ${esc(client.business)}</span></td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">
<p style="margin:0 0 12px">${esc(lines[0])}</p>
<p style="margin:0 0 18px">${esc(lines[1])}</p>
<p style="margin:0 0 22px"><a href="${esc(link)}" style="background:#014FE5;color:#fff;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:8px;display:inline-block">Open your dashboard</a></p>
${lines.slice(2).map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`).join("")}
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #E1E7F0;font-size:12px;color:#8793A8">207 Visibility · Maine-owned. Maine-run.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html, sms: `207 Visibility: your audit for ${client.business} is ready. ${link}`, link };
}

// Emails the owner their dashboard link (or queues it in the outbox for sending by hand) and marks it released.
export async function releaseToOwner(client, base) {
  const to = cleanEmail(client.notify?.email);
  const msg = releaseMessage(client, base);
  const rec = to ? await sendOne(client, "email", to, msg, { reason: "release" }) : null;
  const now = new Date().toISOString();
  client.billing = { ...(client.billing || { plan: "audit", status: "paid" }), releasedAt: now };
  await setJSON("clients", client.id, normalizeClient(client));
  if (client.billing.signupId) {
    const s = await getJSON("signups", client.billing.signupId);
    if (s) { s.status = "released"; s.releasedAt = now; await setJSON("signups", s.id, s); }
  }
  return { rec, msg, to };
}

export { alertFounder };
