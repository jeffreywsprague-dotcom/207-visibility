// Reads an AI answer: which tracked businesses are named, in what order, which sites
// are cited, and which other businesses appear (the ones winning instead).

const SUFFIX = new Set(["company", "co", "inc", "llc", "ltd", "corp", "corporation", "the", "services", "service", "and", "of", "me", "maine", "realty", "realtors"]);

export function norm(s) {
  return " " + String(s || "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, " and ")
    .replace(/'s\b/g, "s")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() + " ";
}

export function aliasesFor(entity) {
  const set = new Set();
  const add = (s) => { const n = norm(s).trim(); if (n.length >= 4) set.add(n); };
  const names = [entity.name, ...(entity.aliases || [])].filter(Boolean);
  for (const n of names) {
    add(n);
    const core = norm(n).trim().split(" ").filter((w) => !SUFFIX.has(w)).join(" ");
    // Only use the shortened form if it is still distinctive (two words or one long word).
    if (core && (core.includes(" ") || core.length >= 7)) add(core);
  }
  return [...set];
}

export function firstIndex(normText, aliases) {
  let best = -1;
  for (const a of aliases) {
    const i = normText.indexOf(" " + a + " ");
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

// A pick can also be a bold line of its own: "**1. Adam Parent — Maine Real Estate Co.**".
const LIST_RE = /^\s*(?:\*\*\s*\d+[.)]|\d+[.)]|[-*•]|#{1,4})\s+/;

// Split an answer into recommendation items (numbered/bulleted lines or headings).
export function listItems(text) {
  const lines = String(text || "").split(/\n+/);
  const items = lines.filter((l) => LIST_RE.test(l)).map((l) => l.replace(LIST_RE, "").trim()).filter((l) => l.length > 2);
  return items.length >= 2 ? items : [];
}

// Words that make up the labels AI puts in its lists ("**Phone:** ...", "**Services Offered:** ...",
// "**Why choose them:** ..."). A short name made only of these words is a label, not a business.
const GENERIC = new Set(("phone number numbers location locations address addresses hours hour operation operating open now today days schedule " +
  "service services offered offer offering area areas served serving website site web email e mail contact contacts info information " +
  "review reviews rating ratings stars customer customers feedback reputation testimonials google yelp facebook bbb angi houzz tripadvisor nextdoor homeadvisor thumbtack " +
  "price prices pricing cost costs rate rates fee fees estimate estimates estimated typical average quote quotes payment payments insurance " +
  "specialty specialties specializes specialization why choose them it this how what when where who which note notes tip tips summary overview " +
  "recommendation recommendations recommended option options source sources pros cons highlight highlights feature features key " +
  "experience years established founded owner owners licensed license licensing insured bonded certification certifications certified warranty guarantee " +
  "family owned operated free same day fast response response time " +
  "emergency availability available booking book appointment appointments reservations reservation menu parking directions " +
  "best for good great top picks pick consider considerations important things bottom line verdict final thoughts next steps step " +
  "in conclusion details detail description about overall quick facts fact other more additional also the a an of and to with your you call ahead " +
  "social media hours: details: contact: local nearby trust trusted reliable why: alternatives alternative similar businesses business " +
  // Headings AI adds around its picks ("🏆 My Recommendation", "One quick question", "Honorable mentions")
  "my our quick question questions one honorable honourable mention mentions runner runners up winner winners choice choices shortlist list " +
  "comparison compare glance budget value premium standout standouts contender contenders regional worth checking out considering another strong solid").split(/\s+/));
// Phrases that describe a pick rather than name one: a fact about it ("Based in Scarborough",
// "Ranked among the top agents") or the heading over the list ("Top Real Estate Agents in Scarborough").
const FACT_RE = new RegExp("^(?:" + [
  "(?:based|located|headquartered|situated) (?:in|at|near|out of|just)\\b",
  "(?:ranked|rated|named|recognized|recognised|voted|listed) (?:among|in|as|by|no|number|one|top|first|second|third|\\d)",
  "(?:serving|serves|covers|covering) (?:the|all|greater|southern|northern|central|coastal|midcoast|western|eastern)\\b",
  "(?:specializes|specialises|specializing|specialising|focused|focuses) (?:in|on)\\b",
  "(?:licensed|founded|established|completed|closed|sold) (?:in|since|by|over|more|\\d)",
  "(?:approximately|about|over|more than|nearly|around|roughly) \\d"
].join("|") + ")");
const HEADING_RE = /^(?:the\s+)?(?:top|best|leading|other|more|additional|notable|recommended|popular|local)\b.*\s(?:in|near|around|for|serving)\s/;
export function isLabel(name) {
  const flat = String(name || "").toLowerCase().replace(/\*|_/g, "").replace(/[^a-z0-9&' ]+/g, " ").replace(/\s+/g, " ").trim();
  const words = flat.split(/\s+/).filter(Boolean);
  return !words.length || (words.length <= 5 && words.every((w) => GENERIC.has(w))) || FACT_RE.test(flat) || HEADING_RE.test(flat);
}

// Guess the business name at the start of a list item: "**Acme Fence** – great reviews" -> "Acme Fence".
// Leading medals, emoji and numbering come off first: "🥈 2. Hathorne Fencing LLC – Best ratings" -> "Hathorne Fencing LLC".
const leadTrim = (s) => s.replace(/^[^\p{L}\p{N}*]+/u, "").replace(/^\d{1,2}[.)]\s+/, "").replace(/^[^\p{L}\p{N}*]+/u, "");
export function leadName(item) {
  let s = leadTrim(item.replace(/\[[^\]]*\]\([^)]*\)/g, (m) => m.replace(/\]\([^)]*\)/, "]")).replace(/[[\]]/g, ""));
  const bold = s.match(/\*\*([^*]{3,80})\*\*/);
  if (bold) s = leadTrim(bold[1]);
  s = s.split(/\s[–—-]\s|:\s|\s\(|,\s|\.\s/)[0].replace(/\*+/g, "").trim();
  if (s.length < 3 || s.length > 70) return null;
  const words = s.split(/\s+/);
  if (words.length > 8) return null;
  const caps = words.filter((w) => /^[A-Z0-9&]/.test(w)).length;
  return caps >= Math.ceil(words.length * 0.6) ? s : null;
}

export function domainOf(url, title) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (/vertexaisearch|googleusercontent|google\.com$/.test(h) && title && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(title.trim())) return title.trim().toLowerCase().replace(/^www\./, "");
    if (/(^|\.)google\.[a-z.]+$/.test(h) && /maps/.test(url)) return "google maps";
    return h;
  } catch { return null; }
}

// Analyze one answer for a set of tracked entities [{id, name, aliases}].
export function analyze(answer, entities) {
  const text = answer.text || "";
  const nt = norm(text);
  const items = listItems(text);
  const itemNorms = items.map(norm);
  const picks = items.map((it) => { const n = leadName(it); return !!n && !isLabel(n); });
  const placeNorms = (answer.places || []).map(norm);
  const result = {};
  for (const e of entities) {
    const al = e._aliases || (e._aliases = aliasesFor(e));
    const idx = firstIndex(nt, al);
    const inPlaces = placeNorms.findIndex((p) => al.some((a) => p.includes(" " + a + " ")));
    let rank = null;
    if (items.length) {
      const r = itemNorms.findIndex((it) => al.some((a) => it.includes(" " + a + " ")));
      // Its place among the picks: headings over the list and the facts bulleted under each pick don't count.
      if (r >= 0) rank = 1 + picks.slice(0, r).filter(Boolean).length;
    }
    if (rank == null && inPlaces >= 0) rank = inPlaces + 1;
    result[e.id] = { named: idx >= 0 || inPlaces >= 0, pos: idx, rank };
  }
  // If there's no list, rank tracked entities by where they first appear in the text.
  if (!items.length) {
    const named = entities.filter((e) => result[e.id].named && result[e.id].rank == null && result[e.id].pos >= 0).sort((a, b) => result[a.id].pos - result[b.id].pos);
    named.forEach((e, i) => { result[e.id].rank = i + 1; result[e.id].rankApprox = true; });
  }
  // Other businesses named (from list items and map results), excluding tracked ones.
  const others = new Set();
  const tracked = entities.flatMap((e) => e._aliases);
  const candidates = items.map(leadName).filter(Boolean).concat(answer.places || []);
  for (const c of candidates) {
    if (isLabel(c)) continue;
    const n = norm(c);
    if (tracked.some((a) => n.includes(" " + a + " ") || (" " + a + " ").includes(n))) continue;
    others.add(c.replace(/\s+/g, " ").trim());
  }
  const domains = [...new Set((answer.citations || []).map((c) => domainOf(c.url, c.title)).filter(Boolean))];
  return { entities: result, others: [...others].slice(0, 12), domains, listed: items.length };
}

const PHONE_RE = /\(?\b(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})\b/g;
export function phonesIn(text) {
  const out = new Set();
  for (const m of String(text || "").matchAll(PHONE_RE)) out.add(m[1] + m[2] + m[3]);
  return [...out];
}
export function digits(s) { return String(s || "").replace(/\D/g, "").slice(-10); }
