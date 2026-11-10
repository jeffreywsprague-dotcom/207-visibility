// Stripe calls this after payments and subscription changes. We verify Stripe’s signature, then:
// a paid sign-up starts its first audit, a paid early re-check starts the re-check, and a monthly
// subscription switches monthly measurement on (and off again when it ends).
import { createHmac, timingSafeEqual } from "node:crypto";
import { json, baseUrl } from "../lib/http.mjs";
import { getJSON, setJSON, listKeys } from "../lib/store.mjs";
import { runRecheck } from "../lib/recheck.mjs";
import { normalizeClient } from "../lib/clients.mjs";
import { paySignup, money, alertFounder } from "../lib/billing.mjs";

export const config = { path: "/api/stripe-webhook" };

export function verifyStripe(raw, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => { const i = kv.indexOf("="); return [kv.slice(0, i).trim(), kv.slice(i + 1)]; }).filter(([k]) => k === "t"));
  const sigs = header.split(",").filter((kv) => kv.trim().startsWith("v1=")).map((kv) => kv.trim().slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

const LIVE = ["active", "trialing", "past_due"];

async function clientBySubscription(sub) {
  const byMeta = sub.metadata?.clientId && (await getJSON("clients", sub.metadata.clientId));
  if (byMeta) return byMeta;
  for (const k of await listKeys("clients")) { const c = await getJSON("clients", k); if (c?.billing?.subscriptionId === sub.id) return c; }
  return null;
}

async function onSignup(s, base) {
  const signup = await getJSON("signups", s.metadata.signupId || s.client_reference_id);
  if (!signup) return { note: "sign-up not found" };
  // Starting is safe to repeat: if this crashes part-way, Stripe sends the event again and it picks up where it stopped.
  const already = !!signup.auditKey;
  const { client, audit, error, pending } = await paySignup(signup, { amountCents: s.amount_total, customerId: s.customer || null, session: s.id }, base);
  await setJSON("payments", s.id, { id: s.id, kind: "signup", signupId: signup.id, amountCents: s.amount_total, currency: s.currency, email: s.customer_details?.email || null,
    at: new Date().toISOString(), clientId: client?.id || null, auditKey: audit?.key || null, error: error || undefined });
  if (already || pending) return { started: !!audit, duplicate: true };
  await alertFounder(`new paid sign-up: ${signup.business}`, [
    `${signup.contact.name} paid ${money(s.amount_total ?? signup.priceCents)} for ${signup.business} (${signup.trade}, ${signup.town})${signup.founding ? ", founding price" : ""}.`,
    error ? `The audit couldn’t start: ${error}. Press Start audit on their sign-up in the console.` : "Their audit is running now. You’ll get another email when it’s ready for review."
  ], client ? `${base}/admin/#client/${client.id}` : `${base}/admin/`);
  return { started: !!audit };
}

async function onSubscribe(s, base) {
  const client = await getJSON("clients", s.metadata.clientId || s.client_reference_id);
  if (!client) return { note: "client not found" };
  await setJSON("payments", s.id, { id: s.id, kind: "subscription", clientId: client.id, amountCents: s.amount_total, currency: s.currency, at: new Date().toISOString() });
  const plan = s.metadata.plan === "yearly" ? "yearly" : "monthly";
  client.billing = { ...(client.billing || {}), plan, status: "active", subscriptionId: s.subscription || null, customerId: s.customer || client.billing?.customerId || null,
    monthlyCents: Number(s.metadata.cents) || client.billing?.monthlyCents || null, subscribedAt: new Date().toISOString(), endsAt: null };
  client.tracking = true;
  await setJSON("clients", client.id, normalizeClient(client));
  await alertFounder(`new ${plan} plan: ${client.business}`, [`${client.business} started the ${plan} plan. Their next measurement runs on the 1st.`], `${base}/admin/#client/${client.id}`);
  return { tracking: true };
}

async function onSubscriptionChange(sub, deleted, base) {
  const client = await clientBySubscription(sub);
  if (!client) return { note: "client not found" };
  const ended = deleted || !LIVE.includes(sub.status);
  const status = ended ? "cancelled" : sub.cancel_at_period_end ? "cancelling" : sub.status === "past_due" ? "past_due" : "active";
  const was = client.billing?.status;
  const yearly = sub.metadata?.plan ? sub.metadata.plan === "yearly" : client.billing?.plan === "yearly";
  client.billing = { ...(client.billing || {}), subscriptionId: sub.id, status, plan: ended ? "audit" : yearly ? "yearly" : "monthly",
    endsAt: sub.cancel_at_period_end && sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : ended ? new Date().toISOString() : null };
  client.tracking = !ended;
  await setJSON("clients", client.id, normalizeClient(client));
  if (status !== was && (status === "cancelled" || status === "cancelling" || status === "past_due"))
    await alertFounder(`${client.business}: plan ${status === "past_due" ? "payment failed" : status}`, [
      status === "past_due" ? `Stripe couldn’t charge ${client.business}. It will retry; monthly measurement stays on for now.`
        : status === "cancelling" ? `${client.business} cancelled. Monthly measurement continues until the end of the paid period.`
        : `${client.business}’s plan has ended, so monthly measurement is off.`], `${base}/admin/#client/${client.id}`);
  return { tracking: client.tracking, status };
}

export default async (req) => {
  const raw = await req.text();
  if (!verifyStripe(raw, req.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET)) return json({ error: "Bad signature" }, 400);
  const event = JSON.parse(raw);
  const base = baseUrl(req);

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted")
    return json({ received: true, ...(await onSubscriptionChange(event.data.object, event.type === "customer.subscription.deleted", base)) });
  if (event.type !== "checkout.session.completed") return json({ received: true });

  const s = event.data.object;
  // Stripe can send the same event more than once; only act on the first.
  if (await getJSON("payments", s.id)) return json({ received: true, duplicate: true });
  const kind = s.metadata?.kind;
  if (kind === "subscription" && s.status === "complete") return json({ received: true, ...(await onSubscribe(s, base)) });
  if (s.payment_status !== "paid") return json({ received: true });
  if (kind === "signup") return json({ received: true, ...(await onSignup(s, base)) });
  if (kind !== "recheck") return json({ received: true });

  const clientId = s.metadata.clientId || s.client_reference_id;
  const client = await getJSON("clients", clientId);
  if (!client) return json({ received: true, note: "client not found" });
  const payment = { id: s.id, clientId, kind: "recheck", amountCents: s.amount_total, currency: s.currency, email: s.customer_details?.email || null, at: new Date().toISOString() };
  await setJSON("payments", s.id, payment);
  const id = s.id.slice(-12);
  const meta = { id, paid: true, amountCents: s.amount_total, stripeSession: s.id, source: "dashboard" };
  try {
    const { audit } = await runRecheck(client, base, meta);
    payment.auditKey = audit.key;
    await setJSON("payments", s.id, payment);
  } catch (e) {
    payment.error = e.message;
    await setJSON("payments", s.id, payment);
    // It couldn't start (for example, no AI keys set). Keep the paid request open so it shows
    // in the console with a Run button, and the owner's dashboard says it's queued.
    await setJSON("rechecks", `${clientId}/${id}`, { ...meta, clientId, createdAt: new Date().toISOString(), status: "requested", error: String(e.message).slice(0, 300) });
  }
  return json({ received: true });
};
