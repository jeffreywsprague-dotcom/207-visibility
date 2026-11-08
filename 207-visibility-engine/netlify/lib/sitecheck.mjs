// Checks a website the way AI crawlers see it: robots.txt rules per AI bot,
// whether bots get blocked at the server/CDN, and what's readable in plain HTML.

export const BOTS = [
  { token: "OAI-SearchBot", role: "search", who: "ChatGPT search", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.3; +https://openai.com/searchbot" },
  { token: "ChatGPT-User", role: "user", who: "ChatGPT when a user asks about a page", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot" },
  { token: "GPTBot", role: "training", who: "OpenAI training", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.3; +https://openai.com/gptbot" },
  { token: "Claude-SearchBot", role: "search", who: "Claude search", ua: "Mozilla/5.0 (compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)" },
  { token: "Claude-User", role: "user", who: "Claude when a user asks about a page", ua: "Mozilla/5.0 (compatible; Claude-User/1.0; +https://www.anthropic.com)" },
  { token: "ClaudeBot", role: "training", who: "Anthropic training", ua: "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)" },
  { token: "PerplexityBot", role: "search", who: "Perplexity search", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)" },
  { token: "Perplexity-User", role: "user", who: "Perplexity when a user asks about a page", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)" },
  { token: "Googlebot", role: "search", who: "Google Search, AI Overviews and AI Mode", ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
  { token: "Google-Extended", role: "training", who: "Gemini training (a robots.txt token, not a crawler)", ua: null },
  { token: "bingbot", role: "search", who: "Bing and Microsoft Copilot (also feeds ChatGPT search)", ua: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" },
  { token: "Applebot", role: "search", who: "Siri and Spotlight", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)" }
];
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

async function get(url, ua, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { "user-agent": ua, accept: "text/html,*/*" }, redirect: "follow", signal: ctrl.signal });
    const body = await res.text();
    return { status: res.status, body, url: res.url };
  } catch (e) {
    return { status: 0, body: "", error: e.name === "AbortError" ? "timed out" : e.message };
  } finally { clearTimeout(t); }
}

// RFC 9309 robots.txt evaluation for the path "/".
export function parseRobots(txt) {
  const groups = []; let cur = null, lastWasAgent = false;
  for (let raw of String(txt || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase(), val = m[2].trim();
    if (field === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase()); lastWasAgent = true;
    } else if (field === "allow" || field === "disallow") {
      if (cur) cur.rules.push({ allow: field === "allow", path: val }); lastWasAgent = false;
    } else lastWasAgent = false;
  }
  return groups;
}
export function allowedFor(groups, token, path = "/") {
  const t = token.toLowerCase();
  let matched = groups.filter((g) => g.agents.includes(t));
  if (!matched.length) matched = groups.filter((g) => g.agents.includes("*"));
  if (!matched.length) return { allowed: true, rule: "no rules" };
  const rules = matched.flatMap((g) => g.rules).filter((r) => r.path !== "" || !r.allow);
  let best = null;
  for (const r of rules) {
    if (r.path === "") continue; // empty Disallow means allow everything
    const pat = "^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
    if (new RegExp(pat).test(path)) {
      if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
    }
  }
  if (!best) return { allowed: true, rule: matched[0].agents.includes(t) ? `${token} group, no matching rule` : "default (*) group, no matching rule" };
  return { allowed: best.allow, rule: `${best.allow ? "Allow" : "Disallow"}: ${best.path} (${matched[0].agents.includes(t) ? token : "*"} group)` };
}

function htmlToText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, " ").trim();
}
function jsonLdTypes(html) {
  const types = new Set(); const blocks = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      blocks.push(data);
      const walk = (n) => { if (!n || typeof n !== "object") return; if (Array.isArray(n)) return n.forEach(walk); if (n["@type"]) [].concat(n["@type"]).forEach((t) => types.add(String(t))); if (n["@graph"]) walk(n["@graph"]); };
      walk(data);
    } catch { types.add("(invalid JSON-LD)"); }
  }
  return { types: [...types], blocks };
}

export async function checkSite(website, client, facts = {}) {
  if (!website) return { skipped: "No website on file." };
  let url = website.trim();
  if (!/^https?:\/\//.test(url)) url = "https://" + url;
  const origin = new URL(url).origin;
  const domain = new URL(url).hostname.replace(/^www\./, "");
  const findings = [];
  const add = (level, title, detail) => findings.push({ level, title, detail });

  let robotsRes = await get(origin + "/robots.txt", BROWSER_UA);
  if (robotsRes.status === 0 && !/^https?:\/\/www\./.test(origin)) robotsRes = await get(origin.replace(/^(https?:\/\/)/, "$1www.") + "/robots.txt", BROWSER_UA);
  const robotsTxt = robotsRes.status === 200 && !/<html/i.test(robotsRes.body) ? robotsRes.body : "";
  const groups = parseRobots(robotsTxt);
  const robots = BOTS.map((b) => ({ ...b, ua: undefined, ...allowedFor(groups, b.token) }));
  const blockedSearch = robots.filter((r) => !r.allowed && (r.role === "search" || r.role === "user"));
  if (!robotsTxt) add("pass", "No robots.txt restrictions", "Without a robots.txt file, all crawlers are allowed by default.");
  if (blockedSearch.length) add("fail", "robots.txt blocks AI search crawlers", blockedSearch.map((r) => `${r.token} (${r.who}): ${r.rule}`).join("; "));
  else add("pass", "AI search crawlers allowed in robots.txt", "OAI-SearchBot, Claude-SearchBot, PerplexityBot, Googlebot and bingbot can reach the homepage.");
  const blockedTraining = robots.filter((r) => !r.allowed && r.role === "training");
  if (blockedTraining.length) add("info", "Some AI training crawlers are blocked", blockedTraining.map((r) => r.token).join(", ") + ". This is a content choice; it does not remove the site from AI search answers.");

  let human = await get(url, BROWSER_UA);
  if ((human.status === 0 || human.status >= 400) && !/^https?:\/\/www\./.test(url)) {
    const alt = url.replace(/^(https?:\/\/)/, "$1www.");
    const second = await get(alt, BROWSER_UA);
    if (second.status === 200) { url = alt; human = second; }
  }
  if (human.status !== 200) add("fail", "Homepage did not load normally", `Status ${human.status || "no response"}${human.error ? " (" + human.error + ")" : ""}.`);
  const botFetch = [];
  for (const b of BOTS.filter((b) => b.ua && ["OAI-SearchBot", "PerplexityBot", "Claude-SearchBot", "bingbot"].includes(b.token))) {
    const r = await get(url, b.ua);
    botFetch.push({ token: b.token, status: r.status, bytes: r.body.length });
  }
  const walled = botFetch.filter((r) => r.status === 403 || r.status === 401 || r.status === 429 || r.status === 503 || (human.body.length > 2000 && r.bytes < human.body.length * 0.2));
  if (walled.length) add("fail", "AI crawlers are turned away by the server or CDN", walled.map((r) => `${r.token}: status ${r.status}, ${r.bytes} bytes`).join("; ") + ". This is usually a firewall or a ‘block AI bots’ setting, and it doesn’t show up in robots.txt.");
  else if (human.status === 200) add("pass", "AI crawlers get the same page visitors do", botFetch.map((r) => `${r.token} ${r.status}`).join(", "));

  const html = human.body || "";
  const text = htmlToText(html);
  const words = text.split(/\s+/).filter(Boolean).length;
  if (human.status === 200 && words < 150) add("fail", "Very little readable text without scripts", `Only about ${words} words are readable in the raw page. AI crawlers generally don’t run scripts, so content loaded by JavaScript is invisible to them.`);
  else if (human.status === 200) add("pass", "Readable text in plain HTML", `About ${words} words readable without running scripts.`);

  const phone = (facts.phone || "").replace(/\D/g, "").slice(-10);
  const textDigits = text.replace(/\D/g, "");
  if (phone) add(textDigits.includes(phone) ? "pass" : "warn", textDigits.includes(phone) ? "Phone number is in plain text" : "Phone number not found in plain text", textDigits.includes(phone) ? "" : "AI tools may not be able to quote the phone number.");
  const town = (client.town || "").toLowerCase();
  if (town) add(text.toLowerCase().includes(town) ? "pass" : "warn", text.toLowerCase().includes(town) ? `Mentions ${client.town}` : `Doesn’t mention ${client.town} in readable text`, "");
  const servedTowns = (client.testTowns || []).filter((t) => !text.toLowerCase().includes(t.toLowerCase()));
  if ((client.testTowns || []).length) add(servedTowns.length ? "warn" : "pass", servedTowns.length ? "Some towns you serve aren’t mentioned" : "All tested towns are mentioned", servedTowns.length ? servedTowns.join(", ") : "");
  const hasHours = /\b(mon|monday|tue|tuesday|wed|thu|fri|sat|saturday|sun)\w*\b[^.]{0,40}\b\d{1,2}(:\d{2})?\s?(am|pm|a\.m\.|p\.m\.)/i.test(text);
  add(hasHours ? "pass" : "warn", hasHours ? "Hours are in plain text" : "Hours not found in plain text", hasHours ? "" : "Publishing hours helps ‘who’s open now’ answers.");

  const ld = jsonLdTypes(html);
  const biz = ld.types.filter((t) => /LocalBusiness|Organization|Restaurant|Store|Service|Contractor|Plumber|Electrician|Roofing|HVAC|Dentist|AutoRepair|FoodEstablishment|HomeAndConstructionBusiness/i.test(t));
  add(biz.length ? "pass" : "warn", biz.length ? `Business schema found (${biz.join(", ")})` : "No business schema markup", biz.length ? "" : "LocalBusiness schema helps machines read name, address, phone, and hours correctly.");
  if (ld.types.includes("(invalid JSON-LD)")) add("warn", "Some schema markup is broken", "At least one JSON-LD block doesn’t parse.");

  if (/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html)) add("fail", "Homepage is set to noindex", "Search engines and AI tools are told not to index this page.");
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || "";
  const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1] || "";
  if (!title) add("warn", "Missing page title", "");
  if (!desc) add("warn", "Missing meta description", "");

  const sm = await get(new URL(url).origin + "/sitemap.xml", BROWSER_UA, 10000);
  const smCount = sm.status === 200 ? (sm.body.match(/<loc>/g) || []).length : 0;
  add(sm.status === 200 ? "pass" : "warn", sm.status === 200 ? `Sitemap found (${smCount} entries)` : "No sitemap.xml found", sm.status === 200 ? "" : "A sitemap helps Bing (and ChatGPT search) find every page.");

  return { url, domain, robotsFound: !!robotsTxt, robots, botFetch, words, title, description: desc, schemaTypes: ld.types, sitemapEntries: smCount, findings };
}
