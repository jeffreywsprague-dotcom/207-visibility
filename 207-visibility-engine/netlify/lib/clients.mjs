import { slug, rid } from "./http.mjs";
import { randomBytes } from "node:crypto";
const token = () => randomBytes(18).toString("base64url");
import { nearbyTowns } from "./towns.mjs";
import { normNotify } from "./notify.mjs";

const list = (v) => (Array.isArray(v) ? v : String(v || "").split(/[,\n]/)).map((s) => String(s).trim()).filter(Boolean);

export function normalizeClient(c) {
  const comps = (Array.isArray(c.competitors) ? c.competitors : String(c.competitors || "").split("\n"))
    .map((row) => {
      if (row && typeof row === "object") return { name: String(row.name || "").trim(), town: String(row.town || "").trim(), aliases: list(row.aliases) };
      const [name, town, aliases] = String(row).split("|").map((s) => (s || "").trim());
      return { name, town: town || "", aliases: list(aliases) };
    })
    .filter((x) => x.name).slice(0, 5);
  return {
    id: c.id || `${slug(c.business)}-${rid(4)}`,
    business: String(c.business || "").trim(),
    aliases: list(c.aliases),
    trade: String(c.trade || "").trim(),
    town: String(c.town || "").trim(),
    state: String(c.state || "ME").trim().toUpperCase().slice(0, 2),
    radius: parseInt(c.radius, 10) || 15,
    website: String(c.website || "").trim(),
    testTowns: (list(c.testTowns).length ? list(c.testTowns) : nearbyTowns(c.town, c.radius, 2)).slice(0, 3),
    competitors: comps,
    customQuestions: (Array.isArray(c.customQuestions) ? c.customQuestions : String(c.customQuestions || "").split("\n")).map((q) => String(q).trim()).filter(Boolean).slice(0, 10),
    facts: { phone: String(c.facts?.phone || "").trim(), hours: String(c.facts?.hours || "").trim(), address: String(c.facts?.address || "").trim() },
    tracking: !!c.tracking,
    shareToken: typeof c.shareToken === "string" && c.shareToken.length >= 20 ? c.shareToken : token(),
    plan: (Array.isArray(c.plan) ? c.plan : []).slice(0, 20).map((p, i) => ({
      id: String(p.id || `p${Date.now().toString(36)}${i}`), title: String(p.title || "").slice(0, 140), detail: String(p.detail || "").slice(0, 600),
      type: ["crawler", "website", "towns", "listings", "hours", "accuracy", "schema", "reviews", "press", "other"].includes(p.type) ? p.type : "other",
      checkedByOwner: !!p.checkedByOwner,
      goals: Object.fromEntries(Object.entries(p.goals && typeof p.goals === "object" ? p.goals : {})
        .filter(([k, v]) => /^[a-z]+\.[a-z]+$/.test(k) && String(v || "").trim()).slice(0, 8).map(([k, v]) => [k, String(v).trim().slice(0, 60)])),
      checks: Object.fromEntries(Object.entries(p.checks && typeof p.checks === "object" ? p.checks : {}).slice(0, 40).map(([k, v]) => [String(k).slice(0, 160), {
        at: String(v?.at || new Date().toISOString().slice(0, 10)).slice(0, 10), label: String(v?.label || "").slice(0, 120),
        by: v?.by === "staff" ? "staff" : "owner", confirmed: !!v?.confirmed, confirmedAt: v?.confirmed ? String(v.confirmedAt || new Date().toISOString().slice(0, 10)).slice(0, 10) : null }])),
      extra: (Array.isArray(p.extra) ? p.extra : []).filter((x) => x && String(x.label || "").trim()).slice(0, 6).map((x) => ({
        label: String(x.label).trim().slice(0, 80), you: String(x.you || "").trim().slice(0, 80), bench: String(x.bench || "").trim().slice(0, 80),
        met: x.met === true || x.met === "yes" ? true : x.met === false || x.met === "no" ? false : null })),
      when: String(p.when || "").slice(0, 60), status: ["planned", "doing", "done"].includes(p.status) ? p.status : "planned",
      doneAt: p.status === "done" ? String(p.doneAt || new Date().toISOString().slice(0, 10)).slice(0, 10) : null
    })).filter((p) => p.title),
    notes: String(c.notes || "").slice(0, 2000),
    // Google Analytics 4 property the owner gave us read access to (for visits from AI assistants).
    ga4PropertyId: String(c.ga4PropertyId || "").replace(/^properties\//, "").replace(/\D/g, "").slice(0, 20),
    // Monthly summary and alerts: where to send them, and the owner's consent for texts.
    notify: normNotify(c.notify),
    updatedAt: new Date().toISOString(),
    createdAt: c.createdAt || new Date().toISOString()
  };
}

