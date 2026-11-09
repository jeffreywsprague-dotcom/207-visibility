// Read-only data for a client's private dashboard, found by its share token.
// Sends compact monthly totals for the trend, plus full answers for one month at a time.
import { json } from "../lib/http.mjs";
import { getJSON, setJSON, listKeys } from "../lib/store.mjs";
import { domainOf, isLabel } from "../lib/extract.mjs";
import { recheckSettings, recheckStatus } from "../lib/recheck.mjs";
import { normNotify, cleanEmail, cleanPhone } from "../lib/notify.mjs";
import { ga4Settings } from "../lib/ga4.mjs";

export const config = { path: "/api/share" };

async function clientByToken(t) {
  if (!t || t.length < 16) return null;
  for (const k of await listKeys("clients")) {
    const c = await getJSON("clients", k);
    if (c && c.shareToken === t) return c;
  }
  return null;
}

async function answersFor(audit) {
  const out = [];
  for (const e of audit.plan.engines) {
    const d = await getJSON("answers", `${audit.key}/${e}`);
    for (const a of d?.answers || []) {
      out.push({
        engine: a.engine, town: a.town, qid: a.qid, group: a.group, question: a.question, run: a.run, branded: a.branded,
        text: String(a.text || "").slice(0, 2500),
        citations: (a.citations || []).slice(0, 10).map((c) => ({ url: c.url, domain: domainOf(c.url, c.title) })),
        hits: Object.fromEntries(Object.entries(a.analysis?.entities || {}).map(([id, r]) => [id, r.named ? (r.rank ?? 0) : null])),
        others: (a.analysis?.others || []).filter((o) => !isLabel(o)).slice(0, 6)   // labels like "Phone:" aren't competitors
      });
    }
  }
  return out;
}

function cellsFrom(answers, entities) {
  const cells = {};
  for (const a of answers) {
    if (a.branded) continue;
    const key = `${a.engine}|${a.town}`;
    const c = cells[key] || (cells[key] = { n: 0, e: {} });
    c.n++;
    for (const e of entities) {
      const r = a.hits[e.id];
      const v = c.e[e.id] || (c.e[e.id] = [0, 0]);
      if (r != null) v[0]++;
      if (r === 1) v[1]++;
    }
  }
  return cells;
}

export default async (req) => {
  const url = new URL(req.url);
  const client = await clientByToken(url.searchParams.get("t") || "");
  if (!client) return json({ error: "Not found" }, 404);

  // "Stop these emails" link in the monthly summary.
  if (req.method === "GET" && url.searchParams.get("unsubscribe") === "email") {
    client.notify = normNotify({ ...client.notify, byEmail: false });
    await setJSON("clients", client.id, client);
    return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title><body style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:60px auto;padding:0 20px;color:#27344E"><h1 style="color:#001536;font-size:22px">You won’t get these emails anymore.</h1><p>Your dashboard still updates every month. You can turn the emails back on there anytime.</p><p><a href="/report/#${client.shareToken}" style="color:#014FE5">Open your dashboard</a></p></body>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }

  // The owner can check plan steps off from their dashboard (status only, nothing else).
  if (req.method === "POST") {
    let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    // The owner chooses how to get their monthly summary. Texts need their explicit consent.
    if (b.notify && typeof b.notify === "object") {
      const cur = normNotify(client.notify), w = b.notify;
      const email = w.email !== undefined ? cleanEmail(w.email) : cur.email, phone = w.phone !== undefined ? cleanPhone(w.phone) : cur.phone;
      if (w.byEmail && !email) return json({ error: "That email address doesn’t look right." }, 400);
      if (w.byText && !phone) return json({ error: "That mobile number doesn’t look right." }, 400);
      const keep = cur.byText && phone === cur.phone;
      if (w.byText && !keep && !w.textConsent) return json({ error: "Tick the box to agree to monthly texts." }, 400);
      client.notify = normNotify({ email, phone, byEmail: !!w.byEmail, byText: !!w.byText,
        textConsentAt: w.byText ? (keep ? cur.textConsentAt : new Date().toISOString()) : null, textConsentBy: w.byText ? (keep ? cur.textConsentBy : "owner") : null });
      await setJSON("clients", client.id, client);
      return json({ ok: true, notify: client.notify });
    }
    const item = (client.plan || []).find((p) => p.id === b.id);
    if (item && typeof b.row === "string") {
      // Mark (or unmark) one benchmark as done; 207 Visibility or the next measurement confirms it.
      const key = b.row.slice(0, 160);
      item.checks = item.checks || {};
      if (b.checked) item.checks[key] = { at: new Date().toISOString().slice(0, 10), label: String(b.label || "").slice(0, 120), by: "owner", confirmed: false };
      else if (item.checks[key] && !item.checks[key].confirmed) delete item.checks[key];
      await setJSON("clients", client.id, client);
      return json({ ok: true });
    }
    if (!item || !["planned", "doing", "done"].includes(b.status)) return json({ error: "Not found" }, 404);
    item.status = b.status;
    item.doneAt = b.status === "done" ? new Date().toISOString().slice(0, 10) : null;
    item.checkedByOwner = b.status === "done";
    await setJSON("clients", client.id, client);
    return json({ ok: true });
  }
  const rs = recheckSettings();
  const recheck = async () => (rs.enabled ? { mode: rs.mode, priceCents: rs.priceCents, runs: rs.runs, name: rs.name, ...(await recheckStatus(client)) } : null);
  // Light status check the dashboard polls while a re-check is paid for or running.
  if (url.searchParams.get("recheck") === "1") return json({ recheck: await recheck() });

  const one = url.searchParams.get("audit");
  // Status first: it scores a re-check that just finished, so the list below includes it.
  const rc = one ? null : await recheck();
  const keys = await listKeys("audits", `${client.id}/`);
  const audits = (await Promise.all(keys.map((k) => getJSON("audits", k)))).filter((a) => a && a.status === "complete" && a.summary)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (one) {
    const a = audits.find((x) => x.key === one);
    if (!a) return json({ error: "Not found" }, 404);
    return json({ answers: await answersFor(a) });
  }

  const out = [];
  for (let i = 0; i < audits.length; i++) {
    const a = audits[i];
    const answers = await answersFor(a);
    const site = (await getJSON("answers", `${a.key}/site`))?.site || {};
    const places = Object.fromEntries(Object.entries(site.places || {}).map(([id, p]) => [id, p && p.found ? { rating: p.rating, reviews: p.reviews } : null]));
    out.push({
      key: a.key, createdAt: a.createdAt, kind: a.kind || "audit",
      plan: { engines: a.plan.engines, runs: a.plan.runs, locations: a.plan.locations.map((l) => ({ town: l.town })) },
      entities: a.entities.map((e) => ({ id: e.id, name: e.name, aliases: e.aliases || [], isClient: !!e.isClient })),
      site: { domain: site.domain || null, places, traffic: site.traffic ? (site.traffic.error ? { error: true } : site.traffic) : null, findings: (site.findings || []).map((f) => ({ level: f.level, title: f.title })), findingsCount: site.findings ? { fail: site.findings.filter((f) => f.level === "fail").length, warn: site.findings.filter((f) => f.level === "warn").length } : null },
      summary: { accuracy: { brandedNamed: a.summary.accuracy.brandedNamed, phoneIssues: a.summary.accuracy.phoneIssues.map((p) => ({ engine: p.engine })) } },
      cells: cellsFrom(answers, a.entities),
      answers: i === audits.length - 1 ? answers : null
    });
  }
  const now = new Date();
  return json({
    recheck: rc,
    notify: normNotify(client.notify),
    analytics: { connected: !!client.ga4PropertyId, email: ga4Settings().email },
    client: { business: client.business, trade: client.trade, town: client.town, state: client.state, radius: client.radius, website: client.website },
    audits: out,
    plan: (client.plan || []).map(({ id, type, title, detail, when, status, doneAt, goals, extra, checks }) => ({ id, type, title, detail, when, status, doneAt, goals: goals || {}, extra: extra || [], checks: checks || {} })),
    // A calendar date (the 1st of next month), so it shows the same day in every time zone.
    nextCheck: client.tracking ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10) : null
  });
};
