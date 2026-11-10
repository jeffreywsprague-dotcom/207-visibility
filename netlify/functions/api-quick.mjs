// Quick checks from an owner's dashboard (found by its share token), and the list for the console.
// GET ?t=…           what's left, the newest results, anything running
// GET ?t=…&id=…      one check, to follow its progress
// GET ?clientId=…    the console's list (password required)
// POST { t, kind: "site" }                 website and Google check
// POST { t, kind: "look", stepId }         quick look for a finished plan step
import { json, baseUrl, checkAdmin } from "../lib/http.mjs";
import { getJSON, setJSON, listKeys } from "../lib/store.mjs";
import { enginesAvailable, ENGINES } from "../lib/engines.mjs";
import { quickSettings, quickRecords, quickFor, lookAllowance, siteLeft, lookPlan, latestAudit, newRecord, launchQuick, estimateCost } from "../lib/quick.mjs";

export const config = { path: "/api/quick" };

async function clientByToken(t) {
  if (!t || t.length < 16) return null;
  for (const k of await listKeys("clients")) { const c = await getJSON("clients", k); if (c && c.shareToken === t) return c; }
  return null;
}
const fresh = (r) => Date.now() - Date.parse(r.createdAt) < 15 * 60e3;

export default async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("clientId")) {
    const denied = checkAdmin(req);
    if (denied) return denied;
    const client = await getJSON("clients", url.searchParams.get("clientId"));
    if (!client) return json({ error: "Not found" }, 404);
    const records = await quickRecords(client.id);
    return json({ settings: quickSettings(), allowance: lookAllowance(client, records), siteLeft: siteLeft(records),
      items: records.slice(0, 30).map(({ answers, ...r }) => ({ ...r, answerCount: (answers || []).length })) });
  }

  if (req.method === "GET") {
    const client = await clientByToken(url.searchParams.get("t") || "");
    if (!client) return json({ error: "Not found" }, 404);
    const id = url.searchParams.get("id");
    if (id) {
      const r = await getJSON("quick", `${client.id}/${id}`);
      return r ? json({ status: r.status }) : json({ error: "Not found" }, 404);
    }
    const audit = await latestAudit(client.id);
    return json(quickFor(client, await quickRecords(client.id), audit?.createdAt));
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const client = await clientByToken(String(b.t || ""));
  if (!client) return json({ error: "Not found" }, 404);
  const st = quickSettings();
  if (!st.enabled) return json({ error: "Quick checks are switched off for now." }, 403);
  const records = await quickRecords(client.id);
  const base = baseUrl(req);

  if (b.kind === "site") {
    if (records.some((r) => r.kind === "site" && r.status === "running" && fresh(r))) return json({ error: "A check is already running. It takes about a minute." }, 409);
    if (!siteLeft(records)) return json({ error: "You’ve used today’s website and Google checks. Try again tomorrow." }, 429);
    const rec = await newRecord(client, { kind: "site" });
    await launchQuick(base, process.env.ADMIN_PASSWORD, rec.key);
    return json({ id: rec.id, status: rec.status });
  }

  if (b.kind !== "look") return json({ error: "Unknown check" }, 400);
  const step = (client.plan || []).find((p) => p.id === b.stepId);
  if (!step) return json({ error: "That step isn’t in your plan." }, 404);
  if (step.status !== "done") return json({ error: "Tick the step done first, then take a quick look." }, 400);
  if (records.some((r) => r.kind === "look" && r.status === "running" && fresh(r))) return json({ error: "A quick look is already running. It takes a minute or two." }, 409);
  const today = new Date().toISOString().slice(0, 10);
  if (records.some((r) => r.kind === "look" && r.stepId === step.id && r.counted !== false && r.createdAt.slice(0, 10) === today))
    return json({ error: "You’ve already taken a quick look at this step today. AI answers vary from one ask to the next, so checking again right away won’t tell you much more." }, 429);
  const allow = lookAllowance(client, records);
  if (!allow.left) return json({ error: allow.plan === "monthly" ? `You’ve used this month’s quick looks. More on ${allow.resetsOn}.` : "You’ve used the quick looks included with your audit.", allowance: allow }, 429);
  const dayKey = `looks/${today}`;
  const day = (await getJSON("quick-meta", dayKey)) || 0;
  if (day >= st.dailyCap) return json({ error: "Quick looks are busy today. Please try again tomorrow." }, 429);
  const available = enginesAvailable();
  const engines = Object.keys(ENGINES).filter((e) => available[e]);
  if (!engines.length) return json({ error: "Quick looks aren’t available right now." }, 503);
  const audit = await latestAudit(client.id);
  const plan = lookPlan(client, step, audit?.plan?.locations?.map((l) => l.town));
  await setJSON("quick-meta", dayKey, day + 1);
  const rec = await newRecord(client, { kind: "look", stepId: step.id, stepTitle: step.title, type: step.type || "other", ...plan, engines,
    estimatedCost: estimateCost(engines, plan.questions.length) });
  await launchQuick(base, process.env.ADMIN_PASSWORD, rec.key);
  return json({ id: rec.id, status: rec.status, allowance: lookAllowance(client, [rec, ...records]) });
};
