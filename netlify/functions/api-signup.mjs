// Public sign-up for the full audit. GET: current prices (and founding spots left).
// POST: saves the sign-up and returns a Stripe Checkout link, or, before Stripe is set up,
// files it as a request so staff can send a payment link. No password; rate-limited and spam-filtered.
import { json, baseUrl } from "../lib/http.mjs";
import { getJSON, setJSON } from "../lib/store.mjs";
import { billingSettings, publicPrices, foundingLeft, readSignup, signupId, stripe, money, alertFounder } from "../lib/billing.mjs";

export const config = { path: "/api/signup" };

const PER_IP_PER_DAY = 6;
const ALL_PER_DAY = 100;

async function bump(key, limit) {
  const n = ((await getJSON("signups-meta", key)) || 0) + 1;
  await setJSON("signups-meta", key, n);
  return n <= limit;
}

export default async (req, context) => {
  if (req.method === "GET") {
    const id = new URL(req.url).searchParams.get("s");
    if (id) {   // the thank-you page checks on its own sign-up
      const s = await getJSON("signups", id);
      return json(s ? { status: s.status, paid: !!s.paidAt, business: s.business } : { status: "unknown" });
    }
    return json(await publicPrices());
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  if (b.company_url) return json({ ok: true });   // honeypot: bots fill hidden fields
  const st = billingSettings();
  if (!st.open) return json({ error: "Sign-ups are paused for the moment. Please check back soon." }, 503);
  const { signup: fields, error } = readSignup(b);
  if (error) return json({ error }, 400);

  const now = new Date().toISOString(), day = now.slice(0, 10);
  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
  if (!(await bump(`ip/${day}/${ip}`, PER_IP_PER_DAY)) || !(await bump(`all/${day}`, ALL_PER_DAY)))
    return json({ error: "We’ve had a lot of sign-ups today. Please try again tomorrow." }, 429);

  const founding = (await foundingLeft()) > 0;
  const priceCents = founding ? st.foundingAuditCents : st.auditCents;
  const signup = { id: signupId(), createdAt: now, status: st.mode === "stripe" ? "checkout" : "requested", founding, priceCents, ...fields };
  await setJSON("signups", signup.id, signup);
  const base = baseUrl(req);

  if (st.mode === "stripe") {
    try {
      const session = await stripe("checkout/sessions", {
        mode: "payment",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(priceCents),
        "line_items[0][price_data][product_data][name]": `AI visibility audit: ${signup.business}`,
        "line_items[0][price_data][product_data][description]": "Your customers’ questions asked on five AI platforms from up to three towns, your private dashboard, and a step-by-step plan.",
        customer_email: signup.contact.email,
        customer_creation: "always",
        allow_promotion_codes: "true",       // codes you create in Stripe: a full comp, half off, and so on
        success_url: `${base}/start/?paid=1&s=${encodeURIComponent(signup.id)}`,
        cancel_url: `${base}/start/?cancelled=1`,
        client_reference_id: signup.id,
        "metadata[kind]": "signup",
        "metadata[signupId]": signup.id,
        "payment_intent_data[metadata][signupId]": signup.id,
        "payment_intent_data[description]": `207 Visibility audit: ${signup.business}`
      });
      signup.stripeSession = session.id;
      await setJSON("signups", signup.id, signup);
      return json({ url: session.url });
    } catch (e) {
      signup.error = String(e.message).slice(0, 300);
      await setJSON("signups", signup.id, signup);
      return json({ error: "Checkout isn’t available right now. Please try again in a few minutes." }, 502);
    }
  }

  // Before Stripe is set up: staff send a payment link by hand, then start the audit from the console.
  await alertFounder(`new sign-up (send a payment link): ${signup.business}`, [
    `${signup.contact.name} signed up ${signup.business} (${signup.trade}, ${signup.town}) for the full audit at ${money(priceCents)}${founding ? " (founding price)" : ""}.`,
    `Email: ${signup.contact.email}${signup.contact.phone ? ` · Mobile: ${signup.contact.phone}` : ""}`,
    "Stripe isn’t set up, so send them a payment link, then press Start audit on their sign-up in the console."
  ], `${base}/admin/`);
  return json({ requested: true, email: signup.contact.email });
};
