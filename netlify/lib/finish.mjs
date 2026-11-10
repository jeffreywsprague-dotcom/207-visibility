// Finishing an audit: once every platform and the site check are done, score it and mark it
// complete. The background workers call this as they finish, so audits complete on their own
// (a paid re-check at 2 a.m. doesn't wait for someone to open the console). The console's
// progress view and the client dashboard's re-check status call it too, as a backstop.
import { getJSON, setJSON } from "./store.mjs";
import { summarize } from "./score.mjs";
import { analyze } from "./extract.mjs";
import { afterAudit } from "./notify.mjs";

export const STALE_MS = 17 * 60 * 1000;

export async function loadSlots(audit) {
  const out = {};
  for (const e of [...audit.plan.engines, "site"]) out[e] = await getJSON("answers", `${audit.key}/${e}`);
  return out;
}

export const slotsDone = (data) => Object.values(data).every((d) => d && d.status === "done");

// A platform is stuck if it failed, or hasn't saved progress in a while (workers save every few answers).
export function slotStuck(d, audit, now = Date.now()) {
  if (!d) return true;
  if (d.status === "done") return false;
  if (d.status === "failed") return true;
  const last = d.updatedAt || Date.parse(audit.createdAt) || now;
  return now - last > STALE_MS;
}

export async function finishIfDone(audit, data) {
  if (audit.status === "complete" && audit.summary && !audit.updating) return audit;
  const slots = data || (await loadSlots(audit));
  if (!slotsDone(slots)) return null;
  // A business name was corrected since these answers were read: read them again under the right name.
  if (audit.reanalyze) {
    for (const e of audit.plan.engines) {
      const d = slots[e];
      if (!d?.answers?.length) continue;
      for (const a of d.answers) a.analysis = analyze({ text: a.text, citations: a.citations, places: a.places }, audit.entities);
      await setJSON("answers", `${audit.key}/${e}`, d);
    }
    delete audit.reanalyze;
  }
  audit.summary = summarize(audit, Object.fromEntries(audit.plan.engines.map((e) => [e, slots[e]])), slots.site?.site);
  audit.status = "complete";
  delete audit.updating;   // an update (retried or added platform) replaces the earlier results only now
  audit.completedAt = audit.completedAt || new Date().toISOString();
  await setJSON("audits", audit.key, audit);
  // Monthly audits and re-checks send the owner their summary, if they've asked for one.
  try { await afterAudit(audit); } catch (e) { console.log("owner update failed", audit.key, e.message); }
  return audit;
}
