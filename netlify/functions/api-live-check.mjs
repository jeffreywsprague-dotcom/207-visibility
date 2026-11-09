// The free live check on the public website. When an owner checks their business, the page
// asks a few of their customers' questions on low-cost AI platforms and shows the real answers:
// whether the owner was named, and who was named instead.
//
// There's no password, so every check is limited: a few per visitor per day, a site-wide daily
// cap, a fixed set of questions per check that can each run only once, and checks that expire.
// Checking the same business and town again within a week shows the saved answers at no cost.
//
//   POST { action: "start", business, trade, town, state, radius }  -> { id, tasks: [{ i, engine, label, question }] }
//   POST { action: "ask", id, i }                                     -> { i, result } (or { i, pending: true })
//   GET                                                               -> { enabled, engines }
//
// Settings (all optional):
//   LIVE_CHECK_ENABLED    "false" turns the live check off (the page falls back to its estimate)
//   LIVE_CHECK_ENGINES    platforms to ask, default "perplexity,anthropic" (the cheapest; about 8 cents a check)
//   LIVE_CHECK_QUESTIONS  questions per check, default 3 (max 4)
//   LIVE_CHECK_DAILY_CAP  checks per day across the whole site, default 60
//   LIVE_CHECK_PER_VISITOR checks per visitor per day, default 3

import { json, rid, slug } from "../lib/http.mjs";
import { getJSON, setJSON } from "../lib/store.mjs";
import { ask, ENGINES, enginesAvailable } from "../lib/engines.mjs";
import { analyze, listItems, leadName, norm, aliasesFor, domainOf, isLabel } from "../lib/extract.mjs";
import { discoveryQuestions } from "../lib/questions.mjs";
import { locate } from "../lib/places.mjs";

export const config = { path: "/api/live-check" };

const LABELS = { openai: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity", anthropic: "Claude", aimode: "Google AI Mode" };
const PREFERRED = { food: ["best", "locals", "opennow", "crave1"], other: ["best", "today", "toprated", "emergency"] };
const EXPIRES_MS = 30 * 60 * 1000;   // a check's questions can be asked for 30 minutes
const ANSWER_MS = 24000;             // stay inside Netlify's 30-second limit for a page request
const RUNNING_MS = 45000;            // a question still "running" after this is treated as lost
const REUSE_MS = 7 * 24 * 3600 * 1000; // the same business and town reuse saved answers for a week

const cap = (s, n) => String(s ?? "").trim().slice(0, n);
const int = (v, d, lo, hi) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

export function liveSettings() {
  const avail = enginesAvailable();
  const wanted = String(process.env.LIVE_CHECK_ENGINES || "perplexity,anthropic").split(",").map((s) => s.trim()).filter((e) => ENGINES[e]);
  const engines = wanted.filter((e) => avail[e]);
  return {
    enabled: process.env.LIVE_CHECK_ENABLED !== "false" && engines.length > 0,
    engines,
    questions: int(process.env.LIVE_CHECK_QUESTIONS, 3, 1, 4),
    dailyCap: int(process.env.LIVE_CHECK_DAILY_CAP, 60, 0, 5000),
    perVisitor: int(process.env.LIVE_CHECK_PER_VISITOR, 3, 1, 50)
  };
}

async function bump(key, limit) {
  const n = ((await getJSON("live-meta", key)) || 0) + 1;
  if (n > limit) return false;
  await setJSON("live-meta", key, n);
  return true;
}

// Which customer questions to ask: the ones most likely to get a list of local names.
export function pickQuestions(client, n) {
  const all = discoveryQuestions(client, client.town);
  const food = all.some((q) => q.id === "crave1");
  const order = PREFERRED[food ? "food" : "other"];
  const picked = order.map((id) => all.find((q) => q.id === id)).filter(Boolean);
  for (const q of all) if (picked.length < n && !picked.includes(q)) picked.push(q);
  return picked.slice(0, n);
}

// Business names in an answer: list items, map results, and **bold** names in prose answers.
export function namesIn(answer, business) {
  const text = String(answer.text || "");
  const mine = aliasesFor({ name: business });
  const out = [], seen = new Set();
  const add = (raw) => {
    const name = String(raw || "").replace(/\s+/g, " ").replace(/[.,:;]+$/, "").trim();
    if (!name || name.length < 3 || isLabel(name)) return;
    const n = norm(name);
    if (mine.some((a) => n.includes(" " + a + " ") || (" " + a + " ").includes(n))) return;
    if (/^ (the )?(best|top|why|how|what|note|tips?|summary|overview|recommendations?|options?|sources?|pricing|cost|hours|reviews?|address|phone|website|location|services?) /.test(n)) return;
    const key = n.trim();
    if (seen.has(key)) return;
    seen.add(key); out.push(name);
  };
  for (const it of listItems(text)) add(leadName(it));
  for (const p of answer.places || []) add(p);
  for (const m of text.matchAll(/\*\*([^*\n]{3,70})\*\*/g)) add(leadName(m[1]));
  return out.slice(0, 8);
}

// Strip markdown so the page can show the answer as plain text.
export function plainText(text, max = 1400) {
  let s = String(text || "")
    .replace(/\[([^\]]+)\]\((?:https?:)?[^)]*\)/g, "$1")
    .replace(/\[\d+(?:,\s*\d+)*\]/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*|__/g, "")
    .replace(/(^|\s)[*_](\S[^*_]*\S)[*_](?=\s|$|[.,;:])/g, "$1$2")
    .replace(/^\s*[-*•]\s+/gm, "• ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, "") + "…";
  return s;
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

async function start(body, ip) {
  const st = liveSettings();
  if (!st.enabled) return json({ enabled: false, reason: "off" });
  if (cap(body.company_url, 200)) return json({ error: "Something went wrong." }, 400); // spam trap
  const client = {
    business: cap(body.business, 100), trade: cap(body.trade, 60), town: cap(body.town, 60),
    state: cap(body.state, 2).toUpperCase() || "ME", radius: int(body.radius, 15, 1, 400)
  };
  if (!client.business || !client.trade || !client.town) return json({ error: "Missing business details." }, 400);
  const bizKey = `biz/${slug(client.business)}--${slug(client.town)}--${client.state.toLowerCase()}`;
  const seen = await getJSON("live", bizKey);
  if (seen && Date.now() - Date.parse(seen.createdAt) < REUSE_MS) {
    const old = await getJSON("live", `${seen.id}/meta`);
    if (old) return json({ enabled: true, id: old.id, town: old.client.town, cached: true, checkedAt: old.createdAt,
      tasks: old.tasks.map(({ i, engine, label, question }) => ({ i, engine, label, question })) });
  }
  const day = new Date().toISOString().slice(0, 10);
  if (!(await bump(`ip/${day}/${ip}`, st.perVisitor))) return json({ enabled: false, reason: "visitor" });
  if (!(await bump(`all/${day}`, st.dailyCap))) return json({ enabled: false, reason: "busy" });
  const loc = await locate(client.town, client.state).catch(() => ({ town: client.town, region: client.state === "ME" ? "Maine" : client.state, lat: null, lng: null }));
  const qs = pickQuestions(client, st.questions);
  const tasks = [];
  for (const q of qs) for (const engine of st.engines) tasks.push({ i: tasks.length, engine, label: LABELS[engine] || engine, qid: q.id, question: q.text });
  const id = `${day}-${rid(10)}`;
  const createdAt = new Date().toISOString();
  await setJSON("live", `${id}/meta`, { id, createdAt, client, loc, tasks });
  await setJSON("live", bizKey, { id, createdAt });
  return json({ enabled: true, id, town: client.town, tasks: tasks.map(({ i, engine, label, question }) => ({ i, engine, label, question })) });
}

async function askOne(body) {
  const id = cap(body.id, 40), i = parseInt(body.i, 10);
  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9]+$/.test(id) || !Number.isInteger(i)) return json({ error: "Bad request." }, 400);
  const meta = await getJSON("live", `${id}/meta`);
  if (!meta) return json({ error: "This check has ended." }, 404);
  const task = meta.tasks[i];
  if (!task) return json({ error: "Bad request." }, 400);
  const key = `${id}/${i}`;
  const prev = await getJSON("live", key);
  if (prev?.status === "done" || prev?.status === "error") return json({ i, result: prev });
  if (prev?.status === "running" && Date.now() - Date.parse(prev.startedAt) < RUNNING_MS) return json({ i, pending: true });
  if (prev?.status === "running") { const lost = { status: "error", message: "No answer in time." }; await setJSON("live", key, lost); return json({ i, result: lost }); }
  if (Date.now() - Date.parse(meta.createdAt) > EXPIRES_MS) return json({ error: "This check has ended." }, 410);

  await setJSON("live", key, { status: "running", startedAt: new Date().toISOString() });
  const t0 = Date.now();
  let result;
  try {
    const answer = await withTimeout(ask(task.engine, task.question, meta.loc), ANSWER_MS);
    const a = analyze(answer, [{ id: "you", name: meta.client.business, aliases: [] }]);
    const you = a.entities.you;
    result = {
      status: "done", engine: task.engine, label: task.label,
      named: !!you.named, rank: you.named ? you.rank : null,
      others: namesIn(answer, meta.client.business),
      sources: [...new Set((answer.citations || []).map((c) => domainOf(c.url, c.title)).filter(Boolean))].slice(0, 5),
      text: plainText(answer.text),
      seconds: Math.round((Date.now() - t0) / 100) / 10,
      at: new Date().toISOString()
    };
  } catch (e) {
    console.log("live check", task.engine, e.message);
    result = { status: "error", engine: task.engine, label: task.label, message: /timeout/.test(e.message) ? "No answer in time." : "No answer this time." };
  }
  await setJSON("live", key, result);
  return json({ i, result });
}

export default async (req, context) => {
  if (req.method === "GET") { const st = liveSettings(); return json({ enabled: st.enabled, engines: st.engines.map((e) => LABELS[e] || e) }); }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
  if (body.action === "start") return start(body, ip);
  if (body.action === "ask") return askOne(body);
  return json({ error: "Bad request." }, 400);
};
