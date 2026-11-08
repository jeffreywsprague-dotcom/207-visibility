// Turns raw answers into the numbers in the report. Rates come with a 95% Wilson
// confidence range, which behaves well for small samples and rates near 0% or 100%.

import { digits, phonesIn, norm } from "./extract.mjs";

export function wilson(k, n, z = 1.96) {
  if (!n) return { k: 0, n: 0, rate: null, low: null, high: null };
  const p = k / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { k, n, rate: p, low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

const inc = (obj, key, named) => {
  const o = obj[key] || (obj[key] = { k: 0, n: 0 });
  o.n++; if (named) o.k++;
};
const finish = (obj) => Object.fromEntries(Object.entries(obj).map(([key, v]) => [key, wilson(v.k, v.n)]));

export function summarize(audit, engineData, site) {
  const entities = audit.entities; // [{id, name, aliases, isClient}]
  const clientId = entities.find((e) => e.isClient).id;
  const answers = Object.values(engineData).flatMap((d) => d?.answers || []);
  const errors = Object.values(engineData).flatMap((d) => d?.errors || []);
  const discovery = answers.filter((a) => !a.branded && a.analysis);
  const branded = answers.filter((a) => a.branded && a.analysis);

  const ent = {};
  for (const e of entities) ent[e.id] = { overall: { k: 0, n: 0 }, first: { k: 0, n: 0 }, byEngine: {}, byLocation: {}, byQuestion: {}, byGroup: {} };
  const domainCount = {}, otherCount = {};

  for (const a of discovery) {
    for (const e of entities) {
      const r = a.analysis.entities[e.id] || {};
      const s = ent[e.id];
      inc(s, "overall", r.named); s.overall = s.overall; // keep shape
      inc(s, "first", r.named && r.rank === 1);
      inc(s.byEngine, a.engine, r.named);
      inc(s.byLocation, a.town, r.named);
      inc(s.byQuestion, a.qid, r.named);
      inc(s.byGroup, a.group, r.named);
    }
    for (const d of a.analysis.domains) domainCount[d] = (domainCount[d] || 0) + 1;
    for (const o of a.analysis.others) { const key = norm(o).trim(); if (!key) continue; const c = otherCount[key] || (otherCount[key] = { name: o, count: 0 }); c.count++; }
  }
  // inc() above writes into s.overall/s.first via key; fix the shape (inc expects a parent object)
  const out = entities.map((e) => {
    const s = ent[e.id];
    return {
      id: e.id, name: e.name, town: e.town || "", isClient: !!e.isClient,
      overall: wilson(s.overall.k, s.overall.n),
      first: wilson(s.first.k, s.first.n),
      byEngine: finish(s.byEngine), byLocation: finish(s.byLocation), byQuestion: finish(s.byQuestion), byGroup: finish(s.byGroup)
    };
  });

  // Question list (labels from the client's main town)
  const qMap = new Map();
  for (const a of discovery) {
    if (!qMap.has(a.qid) || a.town === audit.plan.locations[0].town) qMap.set(a.qid, { id: a.qid, group: a.group, text: a.question });
  }
  const questions = [...qMap.values()];

  const nDisc = discovery.length || 1;
  const sources = Object.entries(domainCount).map(([domain, count]) => ({ domain, count, share: count / nDisc }))
    .sort((a, b) => b.count - a.count).slice(0, 25);
  const others = Object.values(otherCount).sort((a, b) => b.count - a.count).slice(0, 20)
    .map((o) => ({ ...o, share: o.count / nDisc }));

  // Accuracy: what AI says when asked about the client by name.
  const client = entities.find((e) => e.isClient);
  const factsPhone = digits(audit.facts?.phone || site?.places?.client?.phone || "");
  const samples = [], phoneIssues = [];
  for (const a of branded) {
    const r = a.analysis.entities[clientId] || {};
    const phones = phonesIn(a.text);
    if (factsPhone && phones.length && !phones.includes(factsPhone)) phoneIssues.push({ engine: a.engine, question: a.question, phones });
    if (samples.length < 12) samples.push({ engine: a.engine, question: a.question, named: !!r.named, excerpt: excerpt(a.text, r.pos) });
  }
  const brandedNamed = wilson(branded.filter((a) => a.analysis.entities[clientId]?.named).length, branded.length);

  const byEngine = {};
  for (const a of answers) (byEngine[a.engine] || (byEngine[a.engine] = { answers: 0, errors: 0 })).answers++;
  for (const e of errors) (byEngine[e.engine] || (byEngine[e.engine] = { answers: 0, errors: 0 })).errors++;

  return {
    generatedAt: new Date().toISOString(),
    totals: { answers: answers.length, discovery: discovery.length, branded: branded.length, errors: errors.length, byEngine },
    entities: out, questions, sources, others,
    clientDomainCited: site?.domain ? (domainCount[site.domain] || 0) : null,
    accuracy: { brandedNamed, phoneIssues: phoneIssues.slice(0, 20), samples, factsPhone: factsPhone || null },
    locations: audit.plan.locations.map((l) => l.town)
  };
}

function excerpt(text, pos) {
  const t = String(text || "").replace(/\s+/g, " ");
  if (!t) return "";
  // pos is an index into the normalized text; it's close enough to center an excerpt.
  const start = pos > 0 ? Math.max(0, Math.floor(pos * (t.length / Math.max(t.length, pos + 1))) - 160) : 0;
  return (start > 0 ? "…" : "") + t.slice(start, start + 420) + (t.length > start + 420 ? "…" : "");
}
