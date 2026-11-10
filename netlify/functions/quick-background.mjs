// Background worker for one quick check from a dashboard (website and Google check, or a quick look).
import { checkAdmin, json } from "../lib/http.mjs";
import { getJSON, setJSON } from "../lib/store.mjs";
import { runSiteCheck, runLook, latestAudit } from "../lib/quick.mjs";

export const config = { background: true };

export default async (req) => {
  const denied = checkAdmin(req);
  if (denied) return denied;
  const { key } = await req.json();
  const rec = await getJSON("quick", key);
  if (!rec || rec.status !== "running") return json({ ok: true });
  const client = await getJSON("clients", rec.clientId);
  if (!client) return json({ error: "Client not found" }, 404);
  try {
    const audit = await latestAudit(client.id);
    if (rec.kind === "site") await runSiteCheck(rec, client, audit);
    else await runLook(rec, client, audit);
  } catch (e) {
    Object.assign(rec, { status: "failed", counted: false, error: String(e.message).slice(0, 300), finishedAt: new Date().toISOString() });
  }
  await setJSON("quick", key, rec);
  return json({ ok: true });
};
