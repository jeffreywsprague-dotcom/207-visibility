import { checkAdmin, json, baseUrl } from "../lib/http.mjs";
import { getJSON, setJSON, del } from "../lib/store.mjs";
import { summarize } from "../lib/score.mjs";
import { launchWorkers } from "../lib/plan.mjs";
import { finishIfDone } from "../lib/finish.mjs";

export const config = { path: "/api/audit" };
const STALE_MS = 17 * 60 * 1000;

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
      const engines = Object.entries(data).filter(([, d]) => d && d.status !== "done").map(([e]) => e);
      for (const e of engines) { const d = data[e]; d.status = "queued"; d.relaunches = 0; await setJSON("answers", `${audit.key}/${e}`, d); }
      if (audit.status === "complete") { audit.status = "running"; delete audit.summary; await setJSON("audits", audit.key, audit); }
      await launchWorkers(baseUrl(req), process.env.ADMIN_PASSWORD, audit.key, engines);
      return json({ ok: true, resumed: engines });
    }
    if (body.action === "rescore") {
      const data = await loadAll(audit);
      audit.summary = summarize(audit, Object.fromEntries(audit.plan.engines.map((e) => [e, data[e]])), data.site?.site);
      audit.status = "complete";
      await setJSON("audits", audit.key, audit);
      return json({ ok: true });
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
  if (allDone && !audit.summary) await finishIfDone(audit, data);
  const raw = url.searchParams.get("raw") === "1";
  return json({
    audit: { key: audit.key, id: audit.id, clientId: audit.clientId, kind: audit.kind || "audit", createdAt: audit.createdAt, completedAt: audit.completedAt, status: audit.status, plan: audit.plan, entities: audit.entities.map(({ _aliases, ...e }) => e), client: audit.client },
    progress, summary: audit.summary || null, site: data.site?.site || null,
    answers: raw ? audit.plan.engines.flatMap((e) => (data[e]?.answers || []).map(({ analysis, ...a }) => ({ ...a, named: Object.fromEntries(Object.entries(analysis.entities).map(([id, r]) => [id, r.named ? (r.rank || "yes") : ""])) }))) : undefined
  });
};
