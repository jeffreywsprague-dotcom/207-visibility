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
const COST = { openai: 0.058, gemini: 0.028, perplexity: 0.006, anthropic: 0.02, aimode: 0.004 };

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
