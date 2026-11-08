// The client asks for an early re-check from their dashboard (found by share token).
// With Stripe set up, this returns a secure checkout link; otherwise it files a request for staff.
import { json, baseUrl, rid } from "../lib/http.mjs";
import { getJSON, setJSON, listKeys } from "../lib/store.mjs";
import { recheckSettings, recheckStatus } from "../lib/recheck.mjs";

export const config = { path: "/api/recheck" };

async function clientByToken(t) {
  if (!t || t.length < 16) return null;
  for (const k of await listKeys("clients")) { const c = await getJSON("clients", k); if (c && c.shareToken === t) return c; }
  return null;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const client = await clientByToken(String(b.t || ""));
  if (!client) return json({ error: "Not found" }, 404);
  const st = recheckSettings();
  if (!st.enabled) return json({ error: "Early re-checks aren’t available right now." }, 400);
  const status = await recheckStatus(client);
  if (status.status !== "none") return json({ error: status.status === "running" ? "A re-check is already running." : "We already have your request and will be in touch." }, 409);
  const base = baseUrl(req);

  if (st.mode === "stripe") {
    const form = new URLSearchParams({
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(st.priceCents),
      "line_items[0][price_data][product_data][name]": `${st.name}: ${client.business}`,
      "line_items[0][price_data][product_data][description]": "Every customer question re-asked on every AI platform, plus a fresh website and listings check.",
      success_url: `${base}/report/?recheck=paid#${client.shareToken}`,
      cancel_url: `${base}/report/?recheck=cancelled#${client.shareToken}`,
      client_reference_id: client.id,
      "metadata[clientId]": client.id,
      "metadata[kind]": "recheck",
      "payment_intent_data[metadata][clientId]": client.id
    });
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
      body: form.toString()
    });
    const data = await res.json();
    if (!res.ok || !data.url) return json({ error: "Checkout isn’t available right now. Please try again shortly." }, 502);
    return json({ url: data.url });
  }

  // No payment processor yet: file a request for staff to run and invoice.
  const id = `${new Date().toISOString().slice(0, 10)}-${rid(5)}`;
  await setJSON("rechecks", `${client.id}/${id}`, { id, clientId: client.id, createdAt: new Date().toISOString(), status: "requested", priceCents: st.priceCents, source: "dashboard" });
  return json({ requested: true });
};
