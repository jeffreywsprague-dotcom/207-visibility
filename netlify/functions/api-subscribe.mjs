// The owner starts the monthly (or yearly) plan from their dashboard, or opens Stripe’s billing page
// to update their card or cancel. Found by the dashboard’s share token. Before Stripe is set up,
// starting a plan files a request on the client’s page for staff to follow up.
import { json, baseUrl } from "../lib/http.mjs";
import { getJSON, setJSON, listKeys } from "../lib/store.mjs";
import { normalizeClient } from "../lib/clients.mjs";
import { billingSettings, clientPrices, stripe, money } from "../lib/billing.mjs";

export const config = { path: "/api/subscribe" };

async function clientByToken(t) {
  if (!t || t.length < 16) return null;
  for (const k of await listKeys("clients")) { const c = await getJSON("clients", k); if (c && c.shareToken === t) return c; }
  return null;
}
const ACTIVE = ["active", "past_due", "cancelling"];

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const client = await clientByToken(String(b.t || ""));
  if (!client) return json({ error: "Not found" }, 404);
  const st = billingSettings(), base = baseUrl(req), back = `${base}/report/#${client.shareToken}`;

  if (b.action === "portal") {
    if (st.mode !== "stripe" || !client.billing?.customerId) return json({ error: "Billing isn’t available online for your account. Reply to any of our emails and we’ll sort it out." }, 400);
    try { const s = await stripe("billing_portal/sessions", { customer: client.billing.customerId, return_url: back }); return json({ url: s.url }); }
    catch { return json({ error: "The billing page isn’t available right now. Please try again shortly." }, 502); }
  }

  const plan = b.plan === "yearly" ? "yearly" : "monthly";
  if (client.billing && ACTIVE.includes(client.billing.status) && ["monthly", "yearly"].includes(client.billing.plan)) return json({ error: "Your plan is already active." }, 409);
  const p = clientPrices(client), cents = plan === "yearly" ? p.yearly : p.monthly;
  if (!cents) return json({ error: "That option isn’t available." }, 400);

  if (st.mode === "stripe") {
    const params = {
      mode: "subscription",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(cents),
      "line_items[0][price_data][recurring][interval]": plan === "yearly" ? "year" : "month",
      "line_items[0][price_data][product_data][name]": `${plan === "yearly" ? "Yearly" : "Monthly"} AI visibility tracking: ${client.business}`,
      success_url: `${base}/report/?subscribed=1#${client.shareToken}`,
      cancel_url: `${base}/report/?subscribed=cancelled#${client.shareToken}`,
      client_reference_id: client.id,
      "metadata[kind]": "subscription", "metadata[clientId]": client.id, "metadata[plan]": plan, "metadata[cents]": String(cents),
      "subscription_data[metadata][clientId]": client.id, "subscription_data[metadata][plan]": plan
    };
    if (client.billing?.customerId) params.customer = client.billing.customerId;
    else if (client.notify?.email) params.customer_email = client.notify.email;
    try { const s = await stripe("checkout/sessions", params); return json({ url: s.url }); }
    catch { return json({ error: "Checkout isn’t available right now. Please try again in a few minutes." }, 502); }
  }

  // No payment processor yet: leave a request on the client's page for staff.
  const key = `plan-${plan}`;
  if (!(client.asks || []).some((a) => a.key === key && a.status === "open")) {
    client.asks = [...(client.asks || []), { id: Math.random().toString(36).slice(2, 10), key, title: `Start the ${plan} plan (${money(cents)} a ${plan === "yearly" ? "year" : "month"})`,
      note: "Sent from the dashboard. Set up billing, then tick “Re-run automatically on the 1st of each month”.", at: new Date().toISOString(), status: "open" }];
    await setJSON("clients", client.id, normalizeClient(client));
  }
  return json({ requested: true });
};
