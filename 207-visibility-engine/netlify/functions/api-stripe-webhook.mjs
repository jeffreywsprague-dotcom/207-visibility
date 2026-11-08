// Stripe calls this after a successful payment. We verify Stripe’s signature, then start the re-check.
import { createHmac, timingSafeEqual } from "node:crypto";
import { json, baseUrl } from "../lib/http.mjs";
import { getJSON, setJSON } from "../lib/store.mjs";
import { runRecheck } from "../lib/recheck.mjs";

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

export default async (req) => {
  const raw = await req.text();
  if (!verifyStripe(raw, req.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET)) return json({ error: "Bad signature" }, 400);
  const event = JSON.parse(raw);
  if (event.type !== "checkout.session.completed") return json({ received: true });
  const s = event.data.object;
  if (s.metadata?.kind !== "recheck" || s.payment_status !== "paid") return json({ received: true });
  const clientId = s.metadata.clientId || s.client_reference_id;
  // Stripe can send the same event more than once; only act on the first.
  if (await getJSON("payments", s.id)) return json({ received: true, duplicate: true });
  const client = await getJSON("clients", clientId);
  if (!client) return json({ received: true, note: "client not found" });
  const payment = { id: s.id, clientId, kind: "recheck", amountCents: s.amount_total, currency: s.currency, email: s.customer_details?.email || null, at: new Date().toISOString() };
  await setJSON("payments", s.id, payment);
  const id = s.id.slice(-12);
  const meta = { id, paid: true, amountCents: s.amount_total, stripeSession: s.id, source: "dashboard" };
  try {
    const { audit } = await runRecheck(client, baseUrl(req), meta);
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
