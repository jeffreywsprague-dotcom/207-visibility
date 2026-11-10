// Turns raw answers into the numbers in the report. Rates come with a 95% Wilson
// confidence range, which behaves well for small samples and rates near 0% or 100%.

import { digits, phonesIn, norm, isLabel, domainOf } from "./extract.mjs";

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
    for (const o of a.analysis.others) { if (isLabel(o)) continue; const key = norm(o).trim(); if (!key) continue; const c = otherCount[key] || (otherCount[key] = { name: o, count: 0 }); c.count++; }
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
  // The numbers that count as right: every number on file ("207-555-0100, 207-555-0199" is fine)
  // and the one on their Google listing. An answer is flagged only when none of its numbers is right.
  const onFile = String(audit.facts?.phone || "").split(/[,;/]|\bor\b/i).map(digits).filter((d) => d.length === 10);
  const gPhone = digits(site?.places?.client?.phone || "");
  const okPhones = new Set([...onFile, ...(gPhone.length === 10 ? [gPhone] : [])]);
  const factsPhone = onFile[0] || (gPhone.length === 10 ? gPhone : "");
  const phoneSource = onFile.length ? "facts" : factsPhone ? "google" : null;
  const samples = [], phoneIssues = [];
  for (const a of branded) {
    const r = a.analysis.entities[clientId] || {};
    const phones = phonesIn(a.text);
    if (okPhones.size && phones.length && !phones.some((p) => okPhones.has(p))) phoneIssues.push({ engine: a.engine, question: a.question, phones });
    if (samples.length < 12) samples.push({ engine: a.engine, question: a.question, named: !!r.named, excerpt: excerpt(a.text, r.pos) });
  }
  // Their own website, when AI cites it but none is on file: the plan shouldn't tell them to get one.
  let ownDomain = null;
  if (!site?.domain && client) {
    const key = norm(client.name).trim().split(" ").filter((w) => !["the", "company", "co", "inc", "llc", "ltd", "corp", "and", "of"].includes(w)).join("");
    const seen = {};
    if (key.length >= 6) for (const a of answers) {
      const ds = [...(a.citations || []).map((c) => domainOf(c.url, c.title)), ...(String(a.text || "").match(/\b[a-z0-9-]+\.(?:com|net|org|biz|us|co)\b/gi) || [])];
      for (const d of new Set(ds.filter(Boolean).map((x) => x.toLowerCase().replace(/^www\./, "")))) {
        const base = d.split(".")[0].replace(/-/g, "");
        if (base.includes(key) || (base.length >= 6 && key.includes(base) && base.length >= key.length - 3)) seen[d] = (seen[d] || 0) + 1;
      }
    }
    const best = Object.entries(seen).sort((x, y) => y[1] - x[1])[0];
    if (best) ownDomain = { domain: best[0], count: best[1] };
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
    ownDomain,
    accuracy: { brandedNamed, phoneIssues: phoneIssues.slice(0, 20), phoneIssueCount: phoneIssues.length, samples, factsPhone: factsPhone || null, phoneSource },
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

// An audit that finished with a real share of its questions unanswered (a platform was erroring):
// { got, expected }, or null when it's whole enough to trust.
export function answersShort(audit) {
  const expected = (audit?.plan?.tasksPerEngine || 0) * (audit?.plan?.engines || []).length;
  const got = audit?.summary?.totals?.answers;
  return expected && typeof got === "number" && got < expected * 0.9 ? { got, expected } : null;
}
