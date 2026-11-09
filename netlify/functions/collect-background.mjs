// Background worker: runs every question for one AI platform (or the site check),
// saving progress as it goes. If it nears Netlify's 15-minute limit it saves and
// relaunches itself to finish the rest.
import { checkAdmin, json, baseUrl } from "../lib/http.mjs";
import { getJSON, setJSON } from "../lib/store.mjs";
import { buildTasks, launchWorkers } from "../lib/plan.mjs";
import { ask, ENGINES } from "../lib/engines.mjs";
import { analyze } from "../lib/extract.mjs";
import { checkSite } from "../lib/sitecheck.mjs";
import { businessFacts } from "../lib/places.mjs";
import { finishIfDone } from "../lib/finish.mjs";
import { aiReferrals } from "../lib/ga4.mjs";

export const config = { background: true };
const BUDGET_MS = 12.5 * 60 * 1000;

export default async (req) => {
  const denied = checkAdmin(req);
  if (denied) return denied;
  const { key, engine } = await req.json();
  const audit = await getJSON("audits", key);
  if (!audit) return json({ error: "Audit not found" }, 404);
  const slot = `${key}/${engine}`;
  const state = (await getJSON("answers", slot)) || { answers: [], errors: [] };
  if (state.status === "done") return json({ ok: true });
  state.status = "running";
  state.startedAt = state.startedAt || new Date().toISOString();
  state.updatedAt = Date.now();
  await setJSON("answers", slot, state);

  if (engine === "site") {
    const c = audit.client;
    let site;
    try { site = await checkSite(c.website, c, audit.facts || {}); } catch (e) { site = { error: e.message }; }
    const places = { client: await businessFacts(c.business, c.town, c.state || "ME") };
    for (const e of audit.entities.filter((x) => !x.isClient)) places[e.id] = await businessFacts(e.name, e.town || c.town, c.state || "ME");
    // Visits from AI assistants, if the owner gave us read access to their Google Analytics.
    let traffic;
    if (c.ga4PropertyId) { try { traffic = await aiReferrals(c); } catch (e) { traffic = { error: String(e.message).slice(0, 300) }; } }
    Object.assign(state, { site: { ...site, places, traffic }, status: "done", done: 1, total: 1, updatedAt: Date.now() });
    await setJSON("answers", slot, state);
    await finishWhenAllDone(key);
    return json({ ok: true });
  }

  if (!ENGINES[engine]) return json({ error: "Unknown engine" }, 400);
  const tasks = buildTasks(audit);
  state.total = tasks.length;
  const errCount = {};
  for (const e of state.errors) errCount[e.i] = (errCount[e.i] || 0) + 1;
  const finished = new Set(state.answers.map((a) => a.i));
  for (const [i, n] of Object.entries(errCount)) if (n >= 2) finished.add(Number(i));
  for (const e of state.errors) if (e.final) finished.add(e.i);
  const todo = tasks.filter((t) => !finished.has(t.i));
  const locBy = Object.fromEntries(audit.plan.locations.map((l) => [l.town, l]));
  const conc = parseInt(process.env[`CONCURRENCY_${engine.toUpperCase()}`], 10) || ENGINES[engine].concurrency;
  const started = Date.now();
  let next = 0, sinceSave = 0, outOfTime = false;

  const save = async () => { state.done = state.answers.length; state.updatedAt = Date.now(); await setJSON("answers", slot, state); };

  async function worker() {
    while (next < todo.length) {
      if (Date.now() - started > BUDGET_MS) { outOfTime = true; return; }
      const t = todo[next++];
      try {
        const ans = await ask(engine, t.question, locBy[t.town] || { town: t.town, region: "Maine" });
        const analysis = analyze(ans, audit.entities);
        state.answers.push({
          i: t.i, engine, qid: t.qid, group: t.group, question: t.question, town: t.town, branded: t.branded, run: t.run,
          text: String(ans.text || "").slice(0, 6000), citations: (ans.citations || []).slice(0, 25), places: ans.places || [], analysis, at: Date.now()
        });
      } catch (e) {
        const msg = String(e.message || e).slice(0, 400);
        state.errors.push({ i: t.i, engine, qid: t.qid, town: t.town, message: msg, final: !!e.fatal });
        if (e.fatal && /HTTP (401|402|403)/.test(msg)) { state.fatal = msg; next = todo.length; }   // bad key or no credit: stop, don't fail every question
      }
      if (++sinceSave >= 8) { sinceSave = 0; await save(); }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, conc) }, worker));

  if (outOfTime && next < todo.length + conc && !state.fatal) {
    state.status = "continuing";
    state.relaunches = (state.relaunches || 0) + 1;
    await save();
    if (state.relaunches <= 6) await launchWorkers(baseUrl(req), process.env.ADMIN_PASSWORD, key, [engine]);
    return json({ ok: true, continuing: true });
  }
  state.status = state.fatal ? "failed" : "done";
  state.finishedAt = new Date().toISOString();
  await save();
  await finishWhenAllDone(key);
  return json({ ok: true });
};

// The last worker to finish scores the audit, so it completes even if nobody has the console open.
async function finishWhenAllDone(key) {
  try { const audit = await getJSON("audits", key); if (audit) await finishIfDone(audit); }
  catch (e) { console.log("finish failed", key, e.message); }
}
