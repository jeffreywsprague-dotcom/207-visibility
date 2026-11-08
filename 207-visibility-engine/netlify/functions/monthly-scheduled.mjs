// Runs on the 1st of each month: starts a fresh audit for every client marked for tracking.
import { getJSON, listKeys } from "../lib/store.mjs";
import { startAudit } from "../lib/plan.mjs";

// 13:00 UTC on the 1st (8 or 9 a.m. in Maine). "@monthly" runs at midnight UTC, which is still the
// last day of the previous month in Maine, so every audit would be labeled with the wrong month.
export const config = { schedule: "0 13 1 * *" };

export default async () => {
  const keys = await listKeys("clients");
  for (const k of keys) {
    const c = await getJSON("clients", k);
    if (!c || !c.tracking) continue;
    try { await startAudit(c, { runs: 3, source: "monthly" }, process.env.URL, process.env.ADMIN_PASSWORD); } catch (e) { console.log("monthly audit failed", c.id, e.message); }
  }
};
