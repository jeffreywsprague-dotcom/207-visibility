// Visits from AI assistants, read from the client's Google Analytics 4 property.
// Setup: create a Google Cloud service account with the Google Analytics Data API enabled,
// put its JSON key in GA4_SERVICE_ACCOUNT_JSON, and have the owner add the service account's
// email as a Viewer on their GA4 property. Read-only; nothing is changed in their account.
import { createSign } from "node:crypto";

// Session sources that mean a visitor clicked through from an AI assistant.
// Google AI Mode and AI Overviews visits arrive as ordinary Google traffic, so they can't be separated.
export const AI_SOURCES = [
  [/chatgpt\.com|chat\.openai\.com|openai/i, "ChatGPT"],
  [/perplexity/i, "Perplexity"],
  [/gemini\.google|bard\.google/i, "Gemini"],
  [/copilot\.microsoft|copilot\.cloud|bing\.com\/chat|copilot/i, "Copilot"],
  [/claude\.ai|anthropic/i, "Claude"],
  [/meta\.ai/i, "Meta AI"],
  [/grok|x\.ai/i, "Grok"],
  [/deepseek/i, "DeepSeek"],
  [/(^|\.)you\.com|phind|chat\.mistral/i, "Other AI"]
];
export const assistantFor = (source) => (AI_SOURCES.find(([re]) => re.test(String(source || ""))) || [])[1] || null;

function serviceAccount() {
  try { const sa = JSON.parse(process.env.GA4_SERVICE_ACCOUNT_JSON || ""); return sa.client_email && sa.private_key ? sa : null; } catch { return null; }
}
export const ga4Settings = () => ({ ready: !!serviceAccount(), email: serviceAccount()?.client_email || null });

let cached = null;
async function accessToken() {
  if (cached && cached.exp > Date.now() + 60000) return cached.token;
  const sa = serviceAccount();
  if (!sa) throw new Error("GA4_SERVICE_ACCOUNT_JSON is not set.");
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/analytics.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }).toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Google sign-in failed: ${data.error_description || data.error || res.status}`);
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return cached.token;
}

const propertyId = (v) => String(v || "").replace(/^properties\//, "").trim();

// Visits from AI assistants over the last 30 complete days, with each assistant's share.
export async function aiReferrals(client) {
  const pid = propertyId(client.ga4PropertyId);
  if (!pid || !/^\d{5,}$/.test(pid)) return null;
  const token = await accessToken();
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runReport`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: "30daysAgo", endDate: "yesterday" }],
      dimensions: [{ name: "sessionSource" }],
      metrics: [{ name: "sessions" }, { name: "keyEvents" }],
      metricAggregations: ["TOTAL"],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 500
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = data.error?.message || `HTTP ${res.status}`;
    throw new Error(/permission|PERMISSION_DENIED|403/.test(m + res.status) ? `No access to GA4 property ${pid}. Ask the owner to add ${ga4Settings().email} as a Viewer.` : `Google Analytics: ${m}`);
  }
  return summarizeReport(data);
}

export function summarizeReport(data) {
  const num = (v) => Number(v?.value || 0);
  const by = {};
  let aiSessions = 0, aiKey = 0;
  for (const r of data.rows || []) {
    const who = assistantFor(r.dimensionValues?.[0]?.value);
    if (!who) continue;
    const s = num(r.metricValues?.[0]), k = num(r.metricValues?.[1]);
    const b = by[who] || (by[who] = { assistant: who, sessions: 0, keyEvents: 0 });
    b.sessions += s; b.keyEvents += k; aiSessions += s; aiKey += k;
  }
  const total = data.totals?.[0]?.metricValues ? num(data.totals[0].metricValues[0]) : (data.rows || []).reduce((t, r) => t + num(r.metricValues?.[0]), 0);
  const end = new Date(Date.now() - 864e5), start = new Date(Date.now() - 30 * 864e5);
  return {
    from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10),
    sessions: total, ai: { sessions: aiSessions, keyEvents: aiKey, bySource: Object.values(by).sort((a, b) => b.sessions - a.sessions) }
  };
}
