import { checkAdmin, json, baseUrl } from "../lib/http.mjs";
import { getJSON, setJSON, del } from "../lib/store.mjs";
import { summarize } from "../lib/score.mjs";
import { launchWorkers, buildTasks, COST, refreshEntities } from "../lib/plan.mjs";
import { ENGINES, enginesAvailable } from "../lib/engines.mjs";
import { finishIfDone } from "../lib/finish.mjs";
import { isLabel, analyze } from "../lib/extract.mjs";

export const config = { path: "/api/audit" };
const STALE_MS = 17 * 60 * 1000;

// A finished audit keeps its results while it's brought up to date (a retried or added platform,
// a fresh listings check), so the owner's dashboard never goes blank; the new results replace
// them once every part is done. An unfinished audit simply keeps running.
// Corrections made on the client page after an audit ran (the website, the verified phone) apply
// when it's re-scored or its website and listings are re-checked.
async function refreshFromClient(audit) {
  const c = audit.clientId ? await getJSON("clients", audit.clientId) : null;
  if (!c) return;
  audit.client = { ...audit.client, website: c.website || "", facts: c.facts || {} };
  audit.facts = c.facts || {};
  return refreshEntities(audit, c);     // corrected business names (yours or a competitor's)
}
function reopen(audit) {
  if (audit.status === "complete" && audit.summary) audit.updating = new Date().toISOString();
  else audit.status = "running";
}

async function loadAll(audit) {
  const out = {};
  for (const e of [...audit.plan.engines, "site"]) out[e] = await getJSON("answers", `${audit.key}/${e}`);
  return out;
}

export default async (req) => {
  const denied = checkAdmin(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || (req.method !== "GET" ? (await req.clone().json()).key : null);
  const audit = key ? await getJSON("audits", key) : null;
  if (!audit) return json({ error: "Audit not found" }, 404);

  if (req.method === "POST") {
    const body = await req.json();
    if (body.action === "resume") {
      const data = await loadAll(audit);
      // A corrected name means every saved answer is read again when this re-check finishes.
      if (Array.isArray(body.engines) && body.engines.includes("site")) { if (((await refreshFromClient(audit)) || []).length) audit.reanalyze = true; }
      // Retry the platforms asked for (even ones that finished with errors), or every one that hasn't finished.
      // "site" re-runs only the website and Google listings check (say, after adding the Google Places key).
      const asked = Array.isArray(body.engines) ? body.engines.filter((e) => [...audit.plan.engines, "site"].includes(e)) : [];
      const engines = asked.length ? asked : Object.entries(data).filter(([, d]) => d && d.status !== "done").map(([e]) => e);
      for (const e of engines) {
        const d = data[e] || { answers: [], errors: [] };
        // After a fixed key or a topped-up account, forget the earlier errors so every unanswered
        // question is asked again. Answers already collected are kept, so nothing is paid for twice.
        delete d.fatal; d.errors = []; d.status = "queued"; d.relaunches = 0; d.updatedAt = Date.now();
        await setJSON("answers", `${audit.key}/${e}`, d);
      }
      reopen(audit); await setJSON("audits", audit.key, audit);
      await launchWorkers(baseUrl(req), process.env.ADMIN_PASSWORD, audit.key, engines);
      return json({ ok: true, resumed: engines });
    }
    if (body.action === "add-engines") {
      // Bring a finished audit up to date after a new platform key is added (say, Google AI Mode):
      // ask only the new platforms the same questions; answers already collected are kept.
      // "site" in the list also re-reads the website and Google listings (after adding Google Places).
      const avail = enginesAvailable();
      const asked = Array.isArray(body.engines) ? body.engines : [];
      const add = [...new Set(asked)].filter((e) => ENGINES[e] && avail[e] && !audit.plan.engines.includes(e));
      const site = asked.includes("site");
      if (!add.length && !site) return json({ ok: true, added: [] });
      if (site) await refreshFromClient(audit);
      const total = buildTasks(audit).length;
      for (const e of add) await setJSON("answers", `${audit.key}/${e}`, { status: "queued", done: 0, total, answers: [], errors: [] });
      if (site) {
        const d = (await getJSON("answers", `${audit.key}/site`)) || { answers: [], errors: [] };
        delete d.fatal; d.errors = []; d.status = "queued"; d.relaunches = 0; d.updatedAt = Date.now();
        await setJSON("answers", `${audit.key}/site`, d);
      }
      if (add.length) {
        audit.plan.engines = [...audit.plan.engines, ...add];
        audit.plan.added = [...(audit.plan.added || []), ...add.map((e) => ({ engine: e, at: new Date().toISOString() }))];
        audit.plan.estimatedCost = Math.round(((audit.plan.estimatedCost || 0) + add.reduce((t, e) => t + total * (COST[e] || 0.03), 0)) * 100) / 100;
      }
      reopen(audit);
      await setJSON("audits", audit.key, audit);
      await launchWorkers(baseUrl(req), process.env.ADMIN_PASSWORD, audit.key, [...add, ...(site ? ["site"] : [])]);
      return json({ ok: true, added: add, site });
    }
    if (body.action === "drop-engines") {
      // A platform that keeps failing (say, an account problem at DataForSEO) shouldn't hold up the audit:
      // finish without it, using the other platforms' answers. It can be added back later with "add-engines".
      const drop = (Array.isArray(body.engines) ? body.engines : []).filter((e) => audit.plan.engines.includes(e));
      if (!drop.length) return json({ ok: true, dropped: [] });
      if (drop.length >= audit.plan.engines.length) return json({ error: "An audit needs at least one platform." }, 400);
      for (const e of drop) await del("answers", `${audit.key}/${e}`);
      audit.plan.engines = audit.plan.engines.filter((e) => !drop.includes(e));
      audit.plan.dropped = [...(audit.plan.dropped || []), ...drop.map((e) => ({ engine: e, at: new Date().toISOString() }))];
      await setJSON("audits", audit.key, audit);
      const done = await finishIfDone(audit);   // finishes now if every remaining part is done
      return json({ ok: true, dropped: drop, status: done?.status || audit.status });
    }
    if (body.action === "rescore") {
      // Re-read every saved answer with the current rules (labels, list formats) and the client's
      // current details (phone numbers, corrected names), then score.
      const renamed = (await refreshFromClient(audit)) || [];
      const data = await loadAll(audit);
      for (const e of audit.plan.engines) {
        const d = data[e];
        if (!d?.answers?.length) continue;
        for (const a of d.answers) a.analysis = analyze({ text: a.text, citations: a.citations, places: a.places }, audit.entities);
        await setJSON("answers", `${audit.key}/${e}`, d);
      }
      audit.summary = summarize(audit, Object.fromEntries(audit.plan.engines.map((e) => [e, data[e]])), data.site?.site);
      audit.status = "complete";
      await setJSON("audits", audit.key, audit);
      return json({ ok: true, renamed });
    }
    if (body.action === "delete") {
      for (const e of [...audit.plan.engines, "site"]) await del("answers", `${audit.key}/${e}`);
      await del("audits", audit.key);
      return json({ ok: true });
    }
    return json({ error: "Unknown action" }, 400);
  }

  const data = await loadAll(audit);
  const progress = {};
  let allDone = true;
  for (const [e, d] of Object.entries(data)) {
    const stale = d && d.status !== "done" && d.updatedAt && Date.now() - d.updatedAt > STALE_MS;
    progress[e] = d ? { status: stale ? "stalled" : d.status, done: d.done || 0, total: d.total || 0, errors: (d.errors || []).length, fatal: d.fatal || null, lastError: (d.errors || []).slice(-1)[0]?.message || null } : { status: "missing" };
    if (!d || d.status !== "done") allDone = false;
  }
  if (allDone && (!audit.summary || audit.updating)) await finishIfDone(audit, data);
  const raw = url.searchParams.get("raw") === "1";
  return json({
    audit: { key: audit.key, id: audit.id, clientId: audit.clientId, kind: audit.kind || "audit", createdAt: audit.createdAt, completedAt: audit.completedAt, status: audit.status, updating: audit.updating || null, plan: audit.plan, entities: audit.entities.map(({ _aliases, ...e }) => e), client: audit.client },
    // Older audits may list labels like "Phone:" among the businesses AI named; leave them out.
    progress, summary: audit.summary ? { ...audit.summary, others: (audit.summary.others || []).filter((o) => !isLabel(o.name)) } : null, site: data.site?.site || null,
    answers: raw ? audit.plan.engines.flatMap((e) => (data[e]?.answers || []).map(({ analysis, ...a }) => ({ ...a, named: Object.fromEntries(Object.entries(analysis.entities).map(([id, r]) => [id, r.named ? (r.rank || "yes") : ""])) }))) : undefined
  });
};
