// Builds an audit plan (questions x locations x runs per platform), saves it,
// and launches one background worker per platform plus one for the site check.

import { discoveryQuestions, brandedQuestions } from "./questions.mjs";
import { locate } from "./places.mjs";
import { ENGINES, enginesAvailable, MODELS } from "./engines.mjs";
import { setJSON, getJSON } from "./store.mjs";
import { rid } from "./http.mjs";

export function entitiesFor(client) {
  const list = [{ id: "client", name: client.business, aliases: client.aliases || [], town: client.town, isClient: true }];
  (client.competitors || []).slice(0, 5).forEach((c, i) => {
    if (c && c.name) list.push({ id: `c${i + 1}`, name: c.name, aliases: c.aliases || [], town: c.town || "", isClient: false });
  });
  return list;
}

// A corrected spelling of the same business ("Maine Line Fence" → "Main Line Fence"), as opposed to a
// different business put in the same slot ("All Around Fence" → "All Season Fence").
const NAME_STOP = new Set(["the", "company", "co", "inc", "llc", "ltd", "corp", "and", "of"]);
const nameWords = (n) => String(n || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !NAME_STOP.has(w));
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
export function sameBusiness(a, b) {
  const x = nameWords(a).join(""), y = nameWords(b).join("");
  if (!x || !y) return false;
  return x === y || editDistance(x, y) <= Math.max(2, Math.floor(Math.min(x.length, y.length) * 0.15));
}
// Brings a finished audit's business names up to date with the client record, so fixing a typo and
// re-scoring re-reads every saved answer under the right name. Only renames are applied: a slot that now
// holds a different business keeps the business the audit was actually run against. The old spelling
// stays on as an alias, since some answers may have used it. Returns what changed.
export function refreshEntities(audit, client) {
  const now = entitiesFor(client), changed = [];
  for (const e of audit.entities || []) {
    const cur = now.find((x) => x.id === e.id);
    if (!cur || !sameBusiness(e.name, cur.name)) continue;
    const aliases = [...new Set([...(cur.aliases || []), ...(e.aliases || []), ...(e.name !== cur.name ? [e.name] : [])])].filter((x) => x && x !== cur.name);
    if (e.name !== cur.name || JSON.stringify(aliases) !== JSON.stringify(e.aliases || [])) changed.push({ id: e.id, from: e.name, to: cur.name });
    e.name = cur.name; e.aliases = aliases; if (cur.town) e.town = cur.town;
  }
  if (audit.client) {
    const me = (audit.entities || []).find((e) => e.isClient);
    if (me) audit.client.business = me.name;
    if (Array.isArray(audit.client.competitors)) audit.client.competitors = audit.client.competitors.map((c, i) => { const e = (audit.entities || []).find((x) => x.id === `c${i + 1}`); return e && c ? { ...c, name: e.name } : c; });
  }
  return changed;
}

export function buildTasks(audit) {
  const tasks = [];
  const runs = audit.plan.runs;
  for (const loc of audit.plan.locations) {
    for (const q of discoveryQuestions(audit.client, loc.town)) {
      for (let r = 1; r <= runs; r++) tasks.push({ qid: q.id, group: q.group, question: q.text, town: loc.town, branded: false, run: r });
    }
  }
  for (const q of brandedQuestions(audit.client)) {
    for (let r = 1; r <= Math.min(runs, 3); r++) tasks.push({ qid: q.id, group: q.group, question: q.text, town: audit.client.town, branded: true, run: r });
  }
  return tasks.map((t, i) => ({ ...t, i }));
}

// Rough list-price estimate per answer, in dollars (Nov 2026 research; edit as prices change).
export const COST = { openai: 0.058, gemini: 0.028, perplexity: 0.006, anthropic: 0.02, aimode: 0.004 };

export async function startAudit(client, opts, base, adminKey) {
  const available = enginesAvailable();
  const engines = (opts.engines && opts.engines.length ? opts.engines : Object.keys(ENGINES)).filter((e) => available[e]);
  if (!engines.length) throw new Error("No AI platform keys are set. Add at least one API key in Netlify environment variables.");
  const runs = Math.max(1, Math.min(10, parseInt(opts.runs, 10) || 3));
  const towns = [client.town, ...(client.testTowns || [])].filter(Boolean).slice(0, Math.max(1, Math.min(4, opts.maxLocations || 3)));
  const locations = [];
  for (const t of towns) locations.push(await locate(t, client.state || "ME"));

  const id = new Date().toISOString().slice(0, 10) + "-" + rid(5);
  const key = `${client.id}/${id}`;
  const audit = {
    key, id, clientId: client.id, createdAt: new Date().toISOString(), status: "running", kind: opts.kind || "audit", source: opts.source || "staff",
    client: { ...client }, entities: entitiesFor(client), facts: client.facts || {},
    plan: { engines, runs, locations, models: MODELS() }
  };
  const perEngine = buildTasks(audit).length;
  audit.plan.tasksPerEngine = perEngine;
  audit.plan.estimatedCost = Math.round(engines.reduce((s, e) => s + perEngine * (COST[e] || 0.03), 0) * 100) / 100;
  await setJSON("audits", key, audit);

  const targets = [...engines, "site"];
  for (const engine of targets) {
    await setJSON("answers", `${key}/${engine}`, { status: "queued", done: 0, total: engine === "site" ? 1 : perEngine, answers: [], errors: [] });
  }
  await launchWorkers(base, adminKey, key, targets);
  return audit;
}

export async function launchWorkers(base, adminKey, key, engines) {
  await Promise.all(engines.map((engine) =>
    fetch(`${base}/.netlify/functions/collect-background`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-key": adminKey },
      body: JSON.stringify({ key, engine })
    }).catch(() => null)
  ));
}

export async function loadAudit(key) { return getJSON("audits", key); }
