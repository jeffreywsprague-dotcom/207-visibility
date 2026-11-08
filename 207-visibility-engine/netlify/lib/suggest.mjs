// Suggests target towns for a client from evidence: where their customers actually are
// (a pasted list of recent jobs, and towns mentioned in their Google reviews), which larger
// towns sit inside their service area, and how they did in towns already measured.
import { MAINE_TOWNS, coordsFor } from "./towns.mjs";

const NAMES = MAINE_TOWNS.map(([n]) => n);
const SIZE_RANK = Object.fromEntries(MAINE_TOWNS.map(([n], i) => [n.toLowerCase(), i]));
const canon = (t) => NAMES.find((n) => n.toLowerCase() === String(t).trim().toLowerCase()) || titleCase(t);
function titleCase(s) { return String(s).trim().toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase()); }

function miles(a, b) {
  const R = 3958.8, r = (d) => (d * Math.PI) / 180;
  const x = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const wordRe = (n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "i");
const TOWN_RES = NAMES.slice().sort((a, b) => b.length - a.length).map((n) => [n, wordRe(n)]);

// Count towns in a pasted list of addresses, towns, or job notes (one per line).
export function townsFromList(text) {
  const counts = {};
  for (const raw of String(text || "").split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    let town = null;
    const addr = line.match(/,\s*([A-Za-z][A-Za-z .'-]{1,40}?)\s*,?\s*(?:ME|Maine)\b/i);
    if (addr) town = canon(addr[1]);
    if (!town) { const hit = TOWN_RES.find(([, re]) => re.test(line)); if (hit) town = hit[0]; }
    if (!town && /^[A-Za-z .'-]{3,40}$/.test(line)) town = titleCase(line);
    if (town) counts[town] = (counts[town] || 0) + 1;
  }
  return counts;
}

// Count Maine towns named in review text.
export function townsInText(texts) {
  const counts = {};
  for (const t of texts || []) {
    const seen = new Set();
    for (const [n, re] of TOWN_RES) {
      if (seen.has(n)) continue;
      if (re.test(t)) { seen.add(n); counts[n] = (counts[n] || 0) + 1; }
    }
  }
  return counts;
}

export function suggestTowns({ client, pasted, reviewTexts, audit }) {
  const home = coordsFor(client.town);
  const radius = Number(client.radius) || 15;
  const homeKey = String(client.town || "").trim().toLowerCase();
  const fromJobs = townsFromList(pasted);
  const fromReviews = townsInText(reviewTexts);
  const totalJobs = Object.values(fromJobs).reduce((s, n) => s + n, 0);
  const current = new Set((client.testTowns || []).map((t) => t.toLowerCase()));

  // Measured results for towns already tested.
  const measured = {};
  const ents = audit?.summary?.entities || [];
  const you = ents.find((e) => e.isClient);
  if (you) for (const [town, r] of Object.entries(you.byLocation || {})) {
    const best = ents.filter((e) => !e.isClient).map((e) => ({ name: e.name, rate: e.byLocation?.[town]?.rate })).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))[0];
    measured[town.toLowerCase()] = { you: r.rate, best };
  }

  const pool = new Set([...Object.keys(fromJobs), ...Object.keys(fromReviews), ...(client.testTowns || [])]);
  if (home) for (const [n, la, lo] of MAINE_TOWNS) { const d = miles(home, [la, lo]); if (d >= 4 && d <= radius) pool.add(n); }

  const out = [];
  for (const town of pool) {
    const key = town.toLowerCase();
    if (key === homeKey) continue;
    const c = coordsFor(town);
    const dist = home && c ? Math.round(miles(home, c)) : null;
    const inArea = dist == null ? null : dist <= radius;
    const jobs = fromJobs[town] || 0, reviews = fromReviews[town] || 0;
    const sizeRank = SIZE_RANK[key];
    const big = sizeRank != null && sizeRank < 12 ? 2 : sizeRank != null && sizeRank < 30 ? 1 : 0;
    const sizeScore = big === 2 ? 1.2 : big === 1 ? 0.6 : 0;
    const m = measured[key];
    const reasons = [];
    if (jobs) reasons.push(`${jobs} of your ${totalJobs} recent jobs`);
    if (reviews) reasons.push(`named in ${reviews} Google review${reviews === 1 ? "" : "s"}`);
    if (big === 2) reasons.push("one of Maine’s larger towns");
    else if (big === 1) reasons.push("a mid-sized town");
    if (m && m.best && m.best.rate != null && m.you != null) reasons.push(`measured: you ${Math.round(m.you * 100)}%, ${m.best.name} ${Math.round(m.best.rate * 100)}%`);
    if (inArea === false) reasons.push(`${dist} miles away, outside the ${radius}-mile service area`);
    if (dist != null && dist < 3) reasons.push(`right next to ${client.town}, so answers will be nearly the same`);
    // Real customers count most, then reviews, then town size.
    let score = (totalJobs ? (jobs / totalJobs) * 15 : 0) + (jobs ? 1 : 0) + reviews * 1.5 + sizeScore + (current.has(key) ? 0.4 : 0);
    if (m && m.best?.rate != null && m.you != null && m.best.rate > m.you) score += 1; // room to win
    if (inArea === false) score -= jobs ? 1 : 3;
    if (dist != null && dist < 3) score -= 3;
    if (!reasons.length) continue;
    out.push({ town: canon(town), score: Math.round(score * 10) / 10, jobs, reviews, distance: dist, inArea, current: current.has(key), reasons });
  }
  out.sort((a, b) => b.score - a.score || (a.distance ?? 999) - (b.distance ?? 999));
  return { suggestions: out.slice(0, 10), totalJobs, reviewCount: (reviewTexts || []).length, unknownTowns: Object.keys(fromJobs).filter((t) => !coordsFor(t)) };
}
