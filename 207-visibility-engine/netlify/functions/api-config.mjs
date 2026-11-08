import { checkAdmin, json } from "../lib/http.mjs";
import { ENGINES, enginesAvailable, MODELS } from "../lib/engines.mjs";

export const config = { path: "/api/config" };

export default async (req) => {
  const denied = checkAdmin(req);
  if (denied) return denied;
  return json({
    engines: Object.fromEntries(Object.entries(ENGINES).map(([id, e]) => [id, { label: e.label, available: enginesAvailable()[id] }])),
    maps: !!process.env.GOOGLE_MAPS_API_KEY,
    models: MODELS()
  });
};
