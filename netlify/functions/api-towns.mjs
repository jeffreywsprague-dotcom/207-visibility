// Target-town suggestions for a client (staff only).
import { checkAdmin, json } from "../lib/http.mjs";
import { getJSON, listKeys } from "../lib/store.mjs";
import { reviewTexts } from "../lib/places.mjs";
import { suggestTowns } from "../lib/suggest.mjs";

export const config = { path: "/api/towns" };

export default async (req) => {
  const denied = checkAdmin(req);
  if (denied) return denied;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const { clientId, pasted } = await req.json();
  const client = await getJSON("clients", clientId);
  if (!client) return json({ error: "Client not found" }, 404);
  const keys = await listKeys("audits", `${clientId}/`);
  const audits = (await Promise.all(keys.map((k) => getJSON("audits", k)))).filter((a) => a?.summary).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const reviews = await reviewTexts(client.business, client.town, client.state || "ME");
  const result = suggestTowns({ client, pasted: String(pasted || "").slice(0, 50000), reviewTexts: reviews, audit: audits[0] || null });
  return json({ ...result, reviewsChecked: !!process.env.GOOGLE_MAPS_API_KEY });
};
