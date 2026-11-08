// Early re-checks: settings, status, and starting one for a client.
import { getJSON, setJSON, listKeys } from "./store.mjs";
import { startAudit } from "./plan.mjs";
import { loadSlots, finishIfDone, slotStuck } from "./finish.mjs";

export function recheckSettings() {
  return {
    priceCents: Math.max(100, parseInt(process.env.RECHECK_PRICE_CENTS, 10) || 4900),
    runs: Math.max(1, Math.min(5, parseInt(process.env.RECHECK_RUNS, 10) || 2)),
    name: process.env.RECHECK_NAME || "Early re-check",
    mode: process.env.STRIPE_SECRET_KEY ? "stripe" : "request",
    enabled: process.env.RECHECK_ENABLED !== "false"
  };
}

async function auditsOf(client) {
  const keys = await listKeys("audits", `${client.id}/`);
  return (await Promise.all(keys.map((k) => getJSON("audits", k)))).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function requestsOf(client) {
  const keys = await listKeys("rechecks", `${client.id}/`);
  return (await Promise.all(keys.map((k) => getJSON("rechecks", k)))).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// What the dashboard shows: running (with progress), requested (waiting for staff, maybe already paid), or none.
export async function recheckStatus(client) {
  const rechecks = (await auditsOf(client)).filter((a) => a.kind === "recheck");
  let running = rechecks.find((a) => a.status !== "complete");
  let progress = null, stalled = false;
  if (running) {
    const slots = await loadSlots(running);
    if (await finishIfDone(running, slots)) running = null; // finished, but nobody had scored it yet
    else {
      const list = Object.values(slots);
      const total = list.reduce((s, d) => s + (d?.total || 0), 0);
      const done = list.reduce((s, d) => s + Math.min(d?.done || 0, d?.total || 0), 0);
      progress = total ? Math.round((100 * done) / total) / 100 : 0;
      stalled = list.some((d) => slotStuck(d, running));
    }
  }
  const last = rechecks.find((a) => a.status === "complete");
  const pending = (await requestsOf(client)).find((r) => r.status === "requested");
  return {
    status: running ? "running" : pending ? "requested" : "none",
    startedAt: running?.createdAt || null, progress, stalled,
    lastAt: last?.createdAt || null, lastKey: last?.key || null,
    requestedAt: pending?.createdAt || null, paid: !!pending?.paid
  };
}

// Starts a re-check. Asks the same questions from the same towns as the latest regular audit,
// with fewer runs per question (RECHECK_RUNS). With meta.id, updates that request record.
export async function runRecheck(client, base, meta = {}) {
  const st = recheckSettings();
  const lastRegular = (await auditsOf(client)).find((a) => a.kind !== "recheck" && a.status === "complete");
  const audit = await startAudit(client, { runs: st.runs, maxLocations: lastRegular?.plan.locations.length || 3, kind: "recheck" }, base, process.env.ADMIN_PASSWORD);
  const id = meta.id || `${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 7)}`;
  const prev = await getJSON("rechecks", `${client.id}/${id}`);
  const now = new Date().toISOString();
  const rec = { ...(prev || {}), ...meta, id, clientId: client.id, createdAt: prev?.createdAt || now, startedAt: now, status: "started", auditKey: audit.key };
  delete rec.error;
  await setJSON("rechecks", `${client.id}/${id}`, rec);
  return { audit, record: rec };
}
