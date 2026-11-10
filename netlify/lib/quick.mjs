// Quick checks an owner runs from their dashboard, between measurements.
//  - Website and Google check ("site"): the exact facts (can AI crawlers read the site, robots.txt,
//    hours, towns and schema on the site, Google rating and review count). Nearly free, a few a day.
//  - Quick look ("look"): a step's questions asked once on every AI platform. A preview, never a
//    measurement: it doesn't change the score or confirm a rate benchmark. Limited per plan.
import { getJSON, setJSON, listKeys } from "./store.mjs";
import { discoveryQuestions, brandedQuestions } from "./questions.mjs";
import { enginesAvailable, ENGINES, ask } from "./engines.mjs";
import { analyze, phonesIn, digits } from "./extract.mjs";
import { entitiesFor, COST } from "./plan.mjs";
import { checkSite } from "./sitecheck.mjs";
import { businessFacts, locate } from "./places.mjs";
import { rid } from "./http.mjs";

const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };
export function quickSettings() {
  return {
    enabled: process.env.QUICK_CHECKS_ENABLED !== "false",
    lookAudit: num(process.env.QUICK_LOOKS_AUDIT, 2),          // included with the audit
    lookMonthly: num(process.env.QUICK_LOOKS_MONTHLY, 5),      // each month on the monthly plan
    sitePerDay: num(process.env.QUICK_SITE_PER_DAY, 3),        // website and Google checks per client per day
    dailyCap: num(process.env.QUICK_LOOKS_DAILY_CAP, 100)      // quick looks per day across every client
  };
}

export async function quickRecords(clientId) {
  const keys = await listKeys("quick", `${clientId}/`);
  return (await Promise.all(keys.map((k) => getJSON("quick", k)))).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function onMonthlyPlan(client) {
  const b = client.billing;
  return b ? ["monthly", "yearly"].includes(b.plan) && ["active", "past_due", "cancelling"].includes(b.status) : !!client.tracking;
}

// Quick looks left: 2 with the audit, or 5 each calendar month on the monthly plan. Failed ones don't count.
export function lookAllowance(client, records, now = new Date()) {
  const st = quickSettings(), looks = records.filter((r) => r.kind === "look" && r.counted !== false);
  if (onMonthlyPlan(client)) {
    const month = now.toISOString().slice(0, 7);
    const used = looks.filter((r) => r.createdAt.slice(0, 7) === month).length;
    return { plan: "monthly", total: st.lookMonthly, used, left: Math.max(0, st.lookMonthly - used),
      resetsOn: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10) };
  }
  const since = client.billing?.paidAt || "";
  const used = looks.filter((r) => r.createdAt >= since).length;
  return { plan: "audit", total: st.lookAudit, used, left: Math.max(0, st.lookAudit - used), resetsOn: null };
}
export function siteLeft(records, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return Math.max(0, quickSettings().sitePerDay - records.filter((r) => r.kind === "site" && r.counted !== false && r.createdAt.slice(0, 10) === day).length);
}

/* ---------- Which questions a quick look asks ---------- */
const FOCUS = { accuracy: "phone", hours: "phone", listings: "mixed", towns: "town" };
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function lookPlan(client, step, towns) {
  const focus = FOCUS[step.type] || "general";
  const all = [...new Set([client.town, ...(towns || []), ...(client.testTowns || [])].filter(Boolean))];
  let town = client.town;
  if (focus === "town") town = all.find((t) => new RegExp(`\\b${escRe(t)}\\b`, "i").test(`${step.title} ${step.detail || ""}`)) || all.find((t) => t !== client.town) || client.town;
  const disc = discoveryQuestions(client, town);
  const first = (...ids) => ids.map((id) => disc.find((q) => q.id === id)).find(Boolean);
  const general = [first("best"), first("today", "opennow"), first("job1", "crave1")].filter(Boolean);
  const br = brandedQuestions(client), byId = (id) => br.find((q) => q.id === id);
  const qs = focus === "phone" ? [byId("b_info"), byId("b_good")]
    : focus === "mixed" ? [...general.slice(0, 2), byId("b_info")]
    : general;
  return { focus, town, questions: qs.map((q) => ({ qid: q.id, text: q.text, branded: !!q.branded })) };
}

export function estimateCost(engines, n) { return Math.round(engines.reduce((s, e) => s + n * (COST[e] || 0.03), 0) * 100) / 100; }

/* ---------- The latest full audit, for towns, competitors and the phone on file ---------- */
export async function latestAudit(clientId) {
  const keys = await listKeys("audits", `${clientId}/`);
  const audits = (await Promise.all(keys.map((k) => getJSON("audits", k)))).filter((a) => a && a.status === "complete");
  return audits.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1) || null;
}

export async function newRecord(client, fields) {
  const now = new Date().toISOString();
  const rec = { id: `${now.slice(0, 10)}-${rid(6)}`, clientId: client.id, createdAt: now, status: "running", ...fields };
  rec.key = `${client.id}/${rec.id}`;
  await setJSON("quick", rec.key, rec);
  return rec;
}

export async function launchQuick(base, adminKey, key) {
  await fetch(`${base}/.netlify/functions/quick-background`, {
    method: "POST", headers: { "content-type": "application/json", "x-admin-key": adminKey }, body: JSON.stringify({ key })
  }).catch(() => null);
}

/* ---------- Running them ---------- */
export async function runSiteCheck(rec, client, audit) {
  let site;
  try { site = await checkSite(client.website, client, client.facts || {}); } catch (e) { site = { error: String(e.message).slice(0, 200) }; }
  const ents = (audit?.entities || entitiesFor(client));
  const places = {};
  const facts = await businessFacts(client.business, client.town, client.state || "ME");
  places.client = facts;
  for (const e of ents.filter((x) => !x.isClient)) places[e.id] = await businessFacts(e.name, e.town || client.town, client.state || "ME");
  const findings = (site.findings || []).map((f) => ({ level: f.level, title: f.title }));
  rec.site = { domain: site.domain || null, skipped: site.skipped || null, error: site.error || null, findings, pagesRead: site.pagesRead ? site.pagesRead.length : null,
    findingsCount: site.findings ? { fail: findings.filter((f) => f.level === "fail").length, warn: findings.filter((f) => f.level === "warn").length } : null };
  rec.places = Object.fromEntries(Object.entries(places).map(([id, p]) => [id, p && p.found ? { rating: p.rating, reviews: p.reviews } : null]));
  rec.status = site.error && !Object.values(rec.places).some(Boolean) ? "failed" : "done";
  if (rec.status === "failed") rec.counted = false;
  rec.finishedAt = new Date().toISOString();
  return rec;
}

const fmtPhone = (d) => (d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d);

export async function runLook(rec, client, audit) {
  const ents = (audit?.entities || entitiesFor(client));
  const loc = audit?.plan?.locations?.find((l) => l.town === rec.town) || (await locate(rec.town, client.state || "ME"));
  const answers = [], errors = [];
  // Each platform runs its questions one after another; platforms run side by side.
  await Promise.all(rec.engines.map(async (engine) => {
    for (const q of rec.questions) {
      try {
        const ans = await ask(engine, q.text, loc);
        const an = analyze(ans, ents);
        answers.push({
          engine, qid: q.qid, question: q.text, branded: q.branded,
          named: !!an.entities.client?.named, rank: an.entities.client?.rank ?? null,
          comps: ents.filter((e) => !e.isClient && an.entities[e.id]?.named).map((e) => e.name),
          others: an.others.slice(0, 6), phones: phonesIn(ans.text), domains: an.domains.slice(0, 6),
          text: String(ans.text || "").slice(0, 2500)
        });
      } catch (e) { errors.push({ engine, qid: q.qid, message: String(e.message || e).slice(0, 200) }); }
    }
  }));
  const order = (a) => rec.engines.indexOf(a.engine) * 10 + rec.questions.findIndex((q) => q.qid === a.qid);
  rec.answers = answers.sort((a, b) => order(a) - order(b));
  rec.errors = errors;
  // The numbers that count as right: every number on file plus the Google listing's.
  const site = audit ? (await getJSON("answers", `${audit.key}/site`))?.site : null;
  const ok = new Set([...String(client.facts?.phone || "").split(/[,;/]|\bor\b/i).map(digits), digits(site?.places?.client?.phone || "")].filter((d) => d.length === 10));
  rec.verdict = verdict(rec, answers, ok);
  rec.status = answers.length ? "done" : "failed";
  if (!answers.length) rec.counted = false;   // nothing came back: it doesn't use up a quick look
  rec.finishedAt = new Date().toISOString();
  return rec;
}

export function verdict(rec, answers, okPhones) {
  const engines = rec.engines.filter((e) => answers.some((a) => a.engine === e));
  const disc = answers.filter((a) => !a.branded), br = answers.filter((a) => a.branded);
  const out = { engines: engines.length };
  if (disc.length) {
    const asked = engines.filter((e) => disc.some((a) => a.engine === e));
    const named = asked.filter((e) => disc.some((a) => a.engine === e && a.named));
    const counts = {};
    for (const a of disc) for (const n of new Set([...a.comps, ...a.others])) counts[n] = (counts[n] || 0) + 1;
    out.named = { answers: disc.filter((a) => a.named).length, of: disc.length, engines: named.length, ofEngines: asked.length, which: named };
    out.instead = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, n]) => ({ name, n }));
  }
  if (br.length) {
    const withPhone = br.filter((a) => a.phones.length);
    const wrong = okPhones.size ? withPhone.filter((a) => !a.phones.some((p) => okPhones.has(p))) : [];
    out.phone = { checked: okPhones.size > 0, withPhone: withPhone.length, wrong: wrong.length,
      wrongNumbers: [...new Set(wrong.flatMap((a) => a.phones))].slice(0, 3).map(fmtPhone), right: [...okPhones].slice(0, 2).map(fmtPhone) };
    out.byName = { named: br.filter((a) => a.named).length, of: br.length };
  }
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (rec.focus === "phone") {
    const p = out.phone;
    if (!p) { out.tone = "neutral"; out.line = "No answers came back to check."; }
    else if (!p.checked) { out.tone = "neutral"; out.line = `Named when asked by name in ${out.byName.named} of ${out.byName.of} answers. There’s no phone number on file to check against yet.`; }
    else if (!p.withPhone) { out.tone = "neutral"; out.line = "No assistant gave out a phone number this time, so there was nothing to check."; }
    else if (!p.wrong) { out.tone = "pass"; out.line = `Looks fixed: every answer that gave a phone number gave yours (${p.withPhone} of ${p.withPhone}).`; }
    else { out.tone = "warn"; out.line = `Not yet: ${p.wrong} of ${p.withPhone} answers with a phone number gave one that isn’t yours (${p.wrongNumbers.join(", ")}). Listings can take a few weeks to update.`; }
  } else if (out.named) {
    const n = out.named, where = rec.town ? ` for customers in ${rec.town}` : "";
    out.tone = n.engines === 0 ? "fail" : n.engines * 2 >= n.ofEngines ? "pass" : "warn";
    out.line = `Named by ${n.engines} of ${plural(n.ofEngines, "AI assistant")}${where} (${n.answers} of ${n.of} answers).`;
    if (out.phone?.wrong) out.line += ` ${out.phone.wrong} gave a phone number that isn’t yours.`;
  } else { out.tone = "neutral"; out.line = "No answers came back to check."; }
  return out;
}

// What the dashboard gets: the newest website and Google check, the newest quick look per step,
// anything still running, and what's left.
export function quickFor(client, records, latestCreatedAt) {
  const st = quickSettings();
  if (!st.enabled) return { enabled: false };
  const strip = (r) => ({ id: r.id, kind: r.kind, status: r.status, createdAt: r.createdAt, finishedAt: r.finishedAt || null, stepId: r.stepId || null,
    focus: r.focus, town: r.town, questions: r.questions, engines: r.engines, verdict: r.verdict || null, answers: r.answers || null,
    site: r.site || null, places: r.places || null });
  const site = records.find((r) => r.kind === "site" && r.status === "done" && (!latestCreatedAt || r.finishedAt > latestCreatedAt));
  const looks = {};
  for (const r of records) if (r.kind === "look" && r.stepId && !looks[r.stepId] && r.status !== "failed") looks[r.stepId] = strip(r);
  const fresh = (r) => Date.now() - Date.parse(r.createdAt) < 15 * 60e3;
  return {
    enabled: true,
    site: site ? strip(site) : null,
    siteRunning: records.some((r) => r.kind === "site" && r.status === "running" && fresh(r)),
    siteLeft: siteLeft(records),
    looks,
    allowance: lookAllowance(client, records)
  };
}
