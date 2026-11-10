// Builds the customer questions for an audit. Mirrors the snapshot page's logic so
// owners see the same questions in their snapshot and in their measured audit.

const clean = (s) => String(s || "").trim();

export function tradeWord(trade) {
  return clean(trade).split(/\s+/).map((w) => (/^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(" ") || "contractor";
}

const ACTIVITY = {
  fencing: "fence company", fences: "fence company", fence: "fence company", roofing: "roofer",
  plumbing: "plumber", landscaping: "landscaper", painting: "painter", electrical: "electrician",
  paving: "paving company", cleaning: "cleaning company", flooring: "flooring company",
  siding: "siding company", heating: "heating company", hvac: "HVAC company",
  excavation: "excavation company", masonry: "mason", plowing: "plowing company",
  "snow plowing": "plowing company", "pest control": "pest control company"
};
export const FOOD_RE = /restaurant|diner|caf[eé]|coffee|bakery|bistro|pizza|\bbar\b|\bpub\b|brewery|tavern|eatery|kitchen|grill|deli|breakfast|brunch|bbq|barbecue|sushi|taco|food|seafood|lobster|ice cream|donut|doughnut|bagel|sandwich|burger|chowder/;

export function noun(trade) {
  const k = tradeWord(trade).toLowerCase();
  if (/^(food|foods|restaurants?|eatery|dining|food place)$/.test(k)) return "restaurant";
  if (ACTIVITY[k]) return ACTIVITY[k];
  return tradeWord(trade);
}
export function isFood(trade) { return FOOD_RE.test(tradeWord(trade).toLowerCase()); }

export function article(w) {
  const first = String(w).split(/\s+/)[0];
  if (/^[A-Z]{2,}$/.test(first)) return /^[AEFHILMNORSX]/.test(first) ? "an" : "a";
  return /^[aeiou]/i.test(first) ? "an" : "a";
}
export function plural(t) {
  if (/company$/.test(t)) return t.replace(/company$/, "companies");
  if (/(s|sh|ch|x)$/.test(t)) return t + "es";
  return t + "s";
}

const JOBS = [
  [/plumb/, ["a burst pipe", "a water heater replacement"]],
  [/electric/, ["a breaker that keeps tripping", "a panel upgrade"]],
  [/hvac|heat|air|furnace/, ["an AC that won’t cool", "a furnace tune-up"]],
  [/roof/, ["a roof leak", "roof repair after a storm"]],
  [/dent/, ["a chipped tooth", "a same-day cleaning"]],
  [/auto|mechanic|car|tire/, ["squeaky brakes", "a check-engine light diagnosis"]],
  [/landscap|lawn|garden/, ["a spring cleanup", "patio installation"]],
  [/clean|maid/, ["a move-out clean", "a deep clean before guests"]],
  [/pest|extermin/, ["mice in the walls", "wasp nest removal"]],
  [/nail/, ["gel nails", "a pedicure"]],
  [/hair|salon|barber|stylist/, ["balayage", "a quick trim"]],
  [/chiro|physio|massage/, ["lower back pain", "treatment for a stiff neck"]],
  [/contract|remodel|build|carpent/, ["a kitchen remodel", "a small addition"]],
  [/fenc/, ["a new privacy fence", "a pool fence that meets code"]]
];
const MAINE = [
  [/plumb/, (t) => [`Who can thaw frozen pipes in ${t}?`, `Efficiency Maine registered plumbers for a heat pump water heater near ${t}`]],
  [/hvac|heat|air|furnace/, (t) => [`Which heat pump installers near ${t} are Efficiency Maine registered?`, `Who can service my heat pump before winter in ${t}?`]],
  [/electric/, (t) => [`Who installs backup generators near ${t} before storm season?`, `Efficiency Maine registered EV charger installers near ${t}`]],
  [/roof/, (t) => [`Who can deal with ice dams near ${t}?`, `Roofer near ${t} for storm damage after a nor’easter`]],
  [/clean|maid/, (t) => [`Who does summer rental turnovers near ${t}?`, `Who can open up a camp for the season near ${t}?`]],
  [/landscap|lawn|garden|plow|snow/, (t) => [`Who does spring cleanup after mud season near ${t}?`, `Who does snow plowing near ${t}?`]],
  [/fenc/, (t) => [`Who can fix a fence heaved by frost near ${t}?`, `Who installs farm or snow fencing near ${t}?`]],
  [/contract|remodel|build|carpent/, (t) => [`Who repairs storm or ice damage on homes near ${t}?`, `Who renovates camps and cottages near ${t}?`]]
];
const CRAVE = [
  [/diner|breakfast|brunch/, ["corned beef hash", "blueberry pancakes"], "breakfast"],
  [/caf[eé]|coffee/, ["latte", "a breakfast sandwich"], "breakfast"],
  [/bakery|donut|doughnut|bagel/, ["croissants", "whoopie pies"], "pastries"],
  [/pizza/, ["pizza by the slice", "gluten-free pizza"], "pizza"],
  [/\bbar\b|\bpub\b|brewery|tavern/, ["burger", "a trivia night"], "dinner"],
  [/seafood|lobster|oyster|chowder/, ["lobster roll", "fresh oysters"], "dinner"],
  [/sushi/, ["sushi", "omakase"], "dinner"],
  [/taco|mexican/, ["street tacos", "a good margarita"], "dinner"],
  [/bbq|barbecue/, ["brisket", "pulled pork"], "dinner"]
];

// Discovery questions for one location. Each has a stable template id so results
// can be grouped across locations.
export function discoveryQuestions(client, town) {
  const t = noun(client.trade), a = article(t), ts = plural(t);
  const k = t.toLowerCase();
  const st = clean(client.state) || "ME";
  // Every question names the state with the town: "near Augusta" alone can get answers about Augusta, Georgia.
  const where = `${town}, ${st}`;
  const mi = client.radius || 15;
  const cap = (x) => x.replace(/^./, (m) => m.toUpperCase());
  let list;
  if (isFood(client.trade)) {
    const c = CRAVE.find(([re]) => re.test(tradeWord(client.trade).toLowerCase())) || [null, ["burger", "clam chowder"], "dinner"];
    const meal = c[2];
    list = [
      ["best", "Looking for the best", `What’s the best ${t} in ${where}?`],
      ["locals", "Looking for the best", `Where do locals go for ${meal} in ${where}?`],
      ["opennow", "Right now", `${cap(t)} open now near ${town}, ${st}`],
      ["mealnow", "Right now", `Where can I get ${meal} in ${where} right now?`],
      ["crave1", "A specific craving", `Who has the best ${c[1][0]} near ${where}?`],
      ["crave2", "A specific craving", `Where can I get ${c[1][1]} in ${where}?`],
      ["parking", "Plans and logistics", `${cap(ts)} in ${where} with easy parking`],
      ["kids", "Plans and logistics", `Kid-friendly ${t} near ${where}`],
      ["siri", "Asked out loud", `Find ${a} ${t} near ${town}, Maine`],
      ["notourist", "Only in Maine", `Where do locals eat in ${where}, not the tourist spots?`],
      ["lobster", "Only in Maine", `Best place for a lobster roll near ${where}?`]
    ];
  } else {
    const jobs = (JOBS.find(([re]) => re.test(k)) || [null, ["a quick job", "a bigger project"]])[1];
    const me = (MAINE.find(([re]) => re.test(k)) || [null, (tw) => [`Who’s open after a snowstorm near ${tw}?`, `Most trusted local ${t} near ${tw}`]])[1](where);
    list = [
      ["best", "Looking for the best", `Who’s the best ${t} in ${where}?`],
      ["toprated", "Looking for the best", `Top-rated ${ts} near ${town}, ${st}`],
      ["emergency", "Need it now", `Emergency ${t} near ${town}, ${st}`],
      ["today", "Need it now", `I need ${a} ${t} in ${where} today. Who’s open?`],
      ["job1", "A specific job", `Who’s good for ${jobs[0]} near ${where}?`],
      ["job2", "A specific job", `Who does ${jobs[1]} around ${where}?`],
      ["price", "Price and trust", `How much does ${a} ${t} cost in ${town}, ${st}? Who do you recommend?`],
      ["trusted", "Price and trust", mi >= 400 ? `Most trusted ${t} in Maine` : `Most trusted ${t} within ${mi} miles of ${where}`],
      ["voice", "Asked out loud", `Find ${a} ${t} near ${town}, Maine`],
      ["maine1", "Only in Maine", me[0]],
      ["maine2", "Only in Maine", me[1]]
    ];
  }
  // Statewide businesses also compete on questions about the whole state, asked from each test town.
  if (mi >= 400) {
    const stName = st === "ME" ? "Maine" : st;
    list.push(isFood(client.trade)
      ? ["state1", "Anywhere in Maine", `What’s the best ${t} in ${stName}?`]
      : ["state1", "Anywhere in Maine", `Who’s the best ${t} in ${stName}?`]);
    list.push(isFood(client.trade)
      ? ["state2", "Anywhere in Maine", `Which ${ts} in ${stName} are worth the drive?`]
      : ["state2", "Anywhere in Maine", `Top-rated ${ts} in ${stName}`]);
  }
  const custom = (client.customQuestions || []).filter(Boolean).map((q, i) => [`custom${i + 1}`, "Your custom questions", q.replace(/\{town\}/g, town)]);
  return list.concat(custom).map(([id, group, text]) => ({ id, group, text, town, branded: false }));
}

// Questions that use the business name; used for accuracy, not for the mention rate.
export function brandedQuestions(client) {
  const b = clean(client.business), t = noun(client.trade);
  const town = clean(client.town), st = clean(client.state) || "ME";
  return [
    { id: "b_good", group: "About you, by name", text: `Is ${b} in ${town}, ${st} any good?`, town, branded: true },
    { id: "b_info", group: "About you, by name", text: `What are the hours, phone number, and services of ${b} in ${town}, ${st}?`, town, branded: true },
    { id: "b_vs", group: "About you, by name", text: `Should I hire ${b} or another ${t} near ${town}, ${st}?`, town, branded: true }
  ];
}
