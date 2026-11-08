// One adapter per AI platform. Each takes a question and a location and returns
// { text, citations: [{ url, title }], places: [titles of map results] }.
// ChatGPT, Gemini, Perplexity and Claude use the platforms' official APIs with web search on.
// Google AI Mode has no official API, so it comes from DataForSEO, which loads the real
// AI Mode page for a searcher at the customer's location and returns the answer.

import { sleep } from "./http.mjs";

export const ENGINES = {
  openai: { label: "ChatGPT (OpenAI)", key: "OPENAI_API_KEY", concurrency: 6 },
  gemini: { label: "Gemini with Google Maps", key: "GEMINI_API_KEY", concurrency: 4 },
  perplexity: { label: "Perplexity", key: "PERPLEXITY_API_KEY", concurrency: 3 },
  anthropic: { label: "Claude (Anthropic)", key: "ANTHROPIC_API_KEY", concurrency: 4 },
  aimode: { label: "Google AI Mode (via DataForSEO)", keys: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"], concurrency: 5 }
};

export function enginesAvailable() {
  return Object.fromEntries(Object.entries(ENGINES).map(([id, e]) => [id, (e.keys || [e.key]).every((k) => !!process.env[k])]));
}

export const MODELS = () => ({
  openai: process.env.OPENAI_MODEL || "chat-latest", // the model OpenAI lists for ChatGPT itself
  gemini: process.env.GEMINI_MODEL || "gemini-3.8-flash",
  perplexity: process.env.PERPLEXITY_EFFORT || process.env.PERPLEXITY_PRESET || "fast",
  anthropic: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
  anthropicTool: process.env.ANTHROPIC_WEB_SEARCH_TOOL || "web_search_20250305",
  aimode: "Google AI Mode, live results (DataForSEO)"
});

async function post(url, headers, body, timeoutMs = 120000) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
      const text = await res.text();
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
        await sleep(2000 * (attempt + 1) + Math.random() * 1000);
        continue;
      }
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`), { status: res.status, fatal: true });
      return JSON.parse(text);
    } catch (e) {
      clearTimeout(timer);
      if (e.fatal) throw e;
      lastErr = e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

// Collect every http(s) url/uri in a response, with a nearby title if present.
export function collectUrls(node, out = [], seen = new Set()) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((n) => collectUrls(n, out, seen)); return out; }
  const u = typeof node.url === "string" ? node.url : typeof node.uri === "string" ? node.uri : null;
  if (u && /^https?:\/\//.test(u) && !seen.has(u)) { seen.add(u); out.push({ url: u, title: typeof node.title === "string" ? node.title : "" }); }
  for (const v of Object.values(node)) if (v && typeof v === "object") collectUrls(v, out, seen);
  return out;
}

const TZ = "America/New_York";

async function openai(q, loc) {
  const m = MODELS();
  const data = await post("https://api.openai.com/v1/responses",
    { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    {
      model: m.openai,
      input: q,
      tools: [{ type: "web_search", user_location: { type: "approximate", country: "US", city: loc.town, region: loc.region || "Maine", timezone: TZ } }]
    });
  let text = data.output_text || "";
  const cites = [];
  for (const item of data.output || []) {
    if (item.type !== "message") continue;
    for (const c of item.content || []) {
      if (c.type === "output_text") {
        if (!data.output_text) text += (text ? "\n" : "") + (c.text || "");
        for (const a of c.annotations || []) {
          const u = a.url || a.url_citation?.url;
          if (u) cites.push({ url: u, title: a.title || a.url_citation?.title || "" });
        }
      }
    }
  }
  return { text, citations: dedupe(cites), places: [] };
}

async function gemini(q, loc) {
  const m = MODELS();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m.gemini)}:generateContent`;
  const headers = { "x-goog-api-key": process.env.GEMINI_API_KEY };
  const base = { contents: [{ role: "user", parts: [{ text: q }] }] };
  if (loc.lat != null) base.toolConfig = { retrievalConfig: { latLng: { latitude: loc.lat, longitude: loc.lng }, languageCode: "en_US" } };
  let data;
  try {
    data = await post(url, headers, { ...base, tools: [{ googleSearch: {} }, { googleMaps: {} }] });
  } catch (e) {
    if (e.status !== 400) throw e;
    data = await post(url, headers, { ...base, tools: [{ googleMaps: {} }] }); // some models don't allow both tools at once
  }
  const cand = (data.candidates || [])[0] || {};
  const text = (cand.content?.parts || []).map((p) => p.text || "").join("");
  const cites = [], places = [];
  for (const ch of cand.groundingMetadata?.groundingChunks || []) {
    if (ch.web?.uri) cites.push({ url: ch.web.uri, title: ch.web.title || "" });
    if (ch.maps) { places.push(ch.maps.title || ""); if (ch.maps.uri) cites.push({ url: ch.maps.uri, title: ch.maps.title || "", maps: true }); }
  }
  return { text, citations: dedupe(cites), places: places.filter(Boolean) };
}

async function perplexity(q, loc) {
  const m = MODELS();
  const data = await post("https://api.perplexity.ai/v1/agent",
    { authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` },
    { effort: m.perplexity, input: q }); // "effort" replaced the older "preset" name in Oct 2026
  if (data.status && !["completed", "succeeded"].includes(data.status)) throw new Error(`Perplexity status ${data.status}`);
  let text = data.output_text || "";
  if (!text) {
    for (const item of data.output || []) for (const c of item.content || []) if (c.type === "output_text" && c.text) text += (text ? "\n" : "") + c.text;
  }
  return { text, citations: dedupe(collectUrls(data.output || data)), places: [] };
}

async function anthropic(q, loc) {
  const m = MODELS();
  const data = await post("https://api.anthropic.com/v1/messages",
    { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    {
      model: m.anthropic,
      max_tokens: 1500,
      messages: [{ role: "user", content: q }],
      tools: [{ type: m.anthropicTool, name: "web_search", max_uses: 2, user_location: { type: "approximate", city: loc.town, region: loc.region || "Maine", country: "US", timezone: TZ } }]
    });
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const cites = [];
  for (const b of data.content || []) {
    if (b.type === "text") for (const c of b.citations || []) if (c.url) cites.push({ url: c.url, title: c.title || "" });
  }
  return { text, citations: dedupe(cites), places: [] };
}

// Google AI Mode, as a mobile searcher near the customer's town. DataForSEO's live endpoint
// returns the AI Mode answer as markdown plus the pages it referenced.
async function aimode(q, loc) {
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString("base64");
  const task = { keyword: q.slice(0, 700), language_code: "en", device: "mobile" };
  if (loc.lat != null && loc.lng != null) task.location_coordinate = `${Number(loc.lat).toFixed(5)},${Number(loc.lng).toFixed(5)},12z`;
  else task.location_name = `${loc.town},${loc.region || "Maine"},United States`;
  const data = await post("https://api.dataforseo.com/v3/serp/google/ai_mode/live/advanced", { authorization: `Basic ${auth}` }, [task]);
  const t = (data.tasks || [])[0];
  if (!t || t.status_code !== 20000) {
    const code = String(t?.status_code || data.status_code);
    const msg = `DataForSEO ${code}: ${t?.status_message || data.status_message || "no result"}`;
    // 401xx/402xx are login or billing problems: stop this platform rather than fail every question.
    if (/^40[12]/.test(code)) throw Object.assign(new Error(`HTTP 401 (${msg})`), { fatal: true });
    throw new Error(msg);
  }
  const items = (t.result || [])[0]?.items || [];
  const ai = items.find((i) => i.type === "ai_overview");
  if (!ai) throw new Error("Google AI Mode gave no answer for this search");
  const text = ai.markdown || (ai.items || []).map((i) => i.markdown || i.text || "").join("\n\n");
  const cites = (ai.references || []).filter((r) => r.url).map((r) => ({ url: r.url, title: r.title || r.source || "" }));
  for (const i of ai.items || []) for (const l of i.links || []) if (l.url) cites.push({ url: l.url, title: l.title || "" });
  return { text, citations: dedupe(cites), places: [] };
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
}

const ADAPTERS = { openai, gemini, perplexity, anthropic, aimode };
let testAdapters = null;
export function _useTestAdapters(a) { testAdapters = a; }

export async function ask(engine, q, loc) {
  const fn = (testAdapters && testAdapters[engine]) || ADAPTERS[engine];
  if (!fn) throw new Error(`Unknown engine ${engine}`);
  return fn(q, loc);
}
