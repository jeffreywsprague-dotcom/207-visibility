// Builds the customer questions for an audit. Mirrors the snapshot page's logic so
// owners see the same questions in their snapshot and in their measured audit.

const clean = (s) => String(s || "").trim();

export function tradeWord(trade) {
  return clean(trade).split(/\s+/).map((w) => (/^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(" ") || "contractor";
}

/* ---- What kind of business it is, and the questions that fit it (kept identical in questions.mjs and the home page) ---- */
const ACTIVITY = {
  fencing: "fence company", fences: "fence company", fence: "fence company", roofing: "roofer",
  plumbing: "plumber", landscaping: "landscaper", painting: "painter", electrical: "electrician",
  paving: "paving company", cleaning: "cleaning company", flooring: "flooring company",
  siding: "siding company", heating: "heating company", hvac: "HVAC company",
  excavation: "excavation company", excavating: "excavation company", masonry: "mason", plowing: "plowing company",
  "snow plowing": "plowing company", "snow removal": "snow removal company", "pest control": "pest control company",
  "real estate": "real estate agent", realty: "real estate agent", insurance: "insurance agency", law: "lawyer",
  accounting: "accountant", bookkeeping: "bookkeeper", catering: "caterer", photography: "photographer",
  tutoring: "tutoring service", "lawn care": "lawn care company", "tree care": "tree service", "tree work": "tree service",
  "tree removal": "tree service", "child care": "child care center", childcare: "child care center",
  "house cleaning": "house cleaning service", "carpet cleaning": "carpet cleaning company",
  "appliance repair": "appliance repair service", "auto repair": "auto repair shop", "boat repair": "boat repair shop",
  "small engine repair": "small engine repair shop", "physical therapy": "physical therapy clinic",
  "property management": "property management company", "it support": "IT support company",
  "home inspection": "home inspector", "dog grooming": "dog groomer", "pet grooming": "pet groomer",
  "dog boarding": "dog boarding kennel", "pet sitting": "pet sitter", "dog walking": "dog walker",
  massage: "massage therapist", construction: "construction company", remodeling: "remodeling contractor",
  "kitchen and bath remodeling": "kitchen and bath remodeler", towing: "towing company", moving: "moving company",
  dentistry: "dentist", septic: "septic service", welding: "welder", carpentry: "carpenter", "auto body": "auto body shop"
};
const FOOD_RE = /restaurant|diner|caf[eé]|coffee|bakery|bistro|pizza|\bbar\b|\bpub\b|brewery|tavern|eatery|\bkitchen\b|\bgrill\b|\bdeli\b|delicatessen|breakfast|brunch|bbq|barbecue|sushi|taco|\bfood|seafood|lobster|ice cream|donut|doughnut|bagel|sandwich|burger|chowder/;
// Words that sound like food but aren't a place to eat: a bed and breakfast, a kitchen remodeler, a grill repair shop, a market.
const NOT_FOOD = /bed (and|&|n) breakfast|\bb ?& ?b\b|remodel|cabinet|countertop|\bpet\b|food (bank|pantry)|\b(repair|cleaning|equipment|supply|supplies|design|install\w*)\b|deliver|grocery|\bmarket\b|\bcater/;
function isFoodTrade(word) { const k = String(word || "").toLowerCase(); return FOOD_RE.test(k) && !NOT_FOOD.test(k); }
function nounFor(word) {
  const k = String(word || "").toLowerCase();
  if (/^(food|foods|restaurants?|eatery|dining|food place)$/.test(k)) return "restaurant";
  if (ACTIVITY[k]) return ACTIVITY[k];
  if (/\brepair$/.test(k)) return word + " shop";                     // "grill repair" → "grill repair shop"
  if (/ing$/.test(k) && !/\b(building)$/.test(k)) return word + " company";   // "pressure washing" → "pressure washing company"
  return word;
}
function plural(t) {
  if (/company$/.test(t)) return t.replace(/company$/, "companies");
  if (/man$/.test(t)) return t.replace(/man$/, "men");
  if (/[^aeiou]y$/.test(t)) return t.replace(/y$/, "ies");
  if (/(s|sh|ch|x)$/.test(t)) return t + "es";
  return t + "s";
}
const P = (re, jobs, o) => [re, Object.assign({ jobs }, o || {})];
const SOON = [["soon", "Need it now", "Which {ts} near {where} can help me this week?"], ["respond", "Need it now", "Which {t} near {where} gets back to people quickly?"]];
const WALKIN = [["walkin", "Need it now", "Which {ts} near {where} take walk-ins or same-day appointments?"], ["today", "Need it now", "I need {a} {t} in {where} today. Who’s open?"]];
const OPENINGS = [["openings", "Need it now", "Which {ts} near {where} have openings right now?"], ["lastminute", "Need it now", "Which {t} near {where} takes last-minute bookings?"]];
const NEW_PATIENTS = [["job3", "A specific job", "Which {ts} near {where} are taking new patients?"], ["job4", "A specific job", "Which {t} near {where} can see me soon?"]];
/* Each business type's two "specific job" questions: a short phrase drops into "Who’s good for … near town?" and
   "Who does … around town?"; a full sentence with {where} is used as written. Types where nobody needs an
   "emergency" one (an agent, a bank, an inn, a shop) get two more fitting questions in place of that pair. */
const PROFILES = [
  // Home trades
  P(/\bplumb/, ["a burst pipe", "a water heater replacement"]),
  P(/\belectric/, ["a breaker that keeps tripping", "a panel upgrade"]),
  P(/\bsolar/, ["rooftop solar panels", "home battery backup installation"], { swap: SOON }),
  P(/insulat|weatheriz|energy audit/, ["attic insulation", "air sealing for a drafty house"], { swap: SOON }),
  P(/\bhvac|\bheat(ing| pumps?)?\b|\bair.?condition|\bfurnace|\bboiler|\bcooling\b/, ["an AC that won’t cool", "a furnace tune-up"]),
  P(/\broof/, ["a roof leak", "roof repair after a storm"]),
  P(/garage door/, ["a garage door that won’t open", "garage door opener installation"]),
  P(/chimney/, ["a chimney cleaning", "chimney liner installation"]),
  P(/gutter/, ["gutter cleaning", "seamless gutter installation"]),
  P(/pressure wash|power wash|window clean/, ["pressure washing a deck", "window cleaning"]),
  P(/carpet clean|upholster/, ["pet stains in a carpet", "upholstery cleaning"]),
  P(/dry clean|laundr|tailor|alteration/, ["dry cleaning a suit", "clothing alterations"]),
  P(/\bglass\b|windshield/, ["a cracked windshield", "replacing a broken window pane"]),
  P(/\bwindows?\b|\bsiding|\bdoors?\b/, ["replacement windows", "new vinyl siding"]),
  P(/well (drill|pump|water)|\bwater (treatment|systems?|filtration)/, ["a well pump that quit", "well drilling"]),
  P(/\bseptic/, ["septic tank pumping", "septic system installation"]),
  P(/excavat|site ?work|earth ?work/, ["digging a foundation", "driveway grading"]),
  P(/\bpav|asphalt|seal ?coat/, ["a new asphalt driveway", "driveway sealcoating"]),
  P(/\bmason|\bbrick|stone ?work|hardscap/, ["chimney repair", "stone patios"]),
  P(/small engine|lawn ?mower|snow ?blower|chainsaw/, ["a snowblower that won’t start", "lawn mower repair"]),
  P(/\btree|arborist|stump/, ["a tree leaning over the house", "stump grinding"]),
  P(/\bplow|\bsnow (removal|plow)/, ["a seasonal plowing contract", "roof shoveling"]),
  P(/landscap|\blawn|\bgardener|\bgardening|yard (work|care)/, ["a spring cleanup", "patio installation"]),
  P(/\bpaint/, ["painting a house exterior", "interior painting"]),
  P(/\bfloor|\btile\b|hardwood/, ["refinishing hardwood floors", "tile installation"]),
  P(/handyman|home repair/, ["hanging a door", "small home repairs"]),
  P(/\bcontract|remodel|\bbuild(er|ers|ing)?\b|\bcarpent|renovat|construction|cabinet|countertop/, ["a kitchen remodel", "a small addition"]),
  P(/\bfenc/, ["a new privacy fence", "a pool fence that meets code"]),
  P(/locksmith/, ["a house lockout", "rekeying locks"]),
  P(/appliance/, ["a washer that won’t drain", "refrigerator repair"]),
  P(/home inspect/, ["a pre-purchase home inspection", "well water testing"], { swap: SOON }),
  P(/\bpest|extermin/, ["mice in the walls", "wasp nest removal"]),
  P(/^(?!.*\b(carpet|window|dry|pool|gutter|chimney|pressure|power|duct|septic|car|auto|boat)\b).*(\bclean|\bmaid|housekeep|janitor)/, ["a move-out clean", "a deep clean before guests"]),
  P(/\bmov(ing|ers?)\b/, ["a local move", "piano moving"]),
  // Vehicles and boats
  P(/auto ?body|collision|\bdent (repair|removal)/, ["a dented fender", "collision repair"]),
  P(/\btires?\b/, ["new snow tires", "flat tire repair"]),
  P(/\btow(ing)?\b|roadside/, ["a tow after a breakdown", "roadside jump starts"]),
  P(/\bmarina/, ["a seasonal boat slip", "winter boat storage"],
    { swap: [["job3", "A specific job", "Which marinas near {where} have transient slips?"], ["job4", "A specific job", "Which marinas near {where} have a fuel dock?"]],
      price: "How much does a boat slip cost near {where}? Which marina do you recommend?", verb: "go with" }),
  P(/dealership|\bdealers?\b/, ["Which {t} near {where} has the best service department?", "Which {ts} near {where} are easy to deal with?"],
    { swap: [["opennow", "Right now", "{T} open now near {town}, {st}"], ["opensun", "Right now", "Which {ts} in {where} are open on Sunday?"]],
      price: "Which {t} near {where} gives fair prices and trade-in values?", verb: "buy from", kind: "retail" }),
  P(/\bboat|\bmarine\b|outboard/, ["winterizing a boat", "outboard motor repair"]),
  P(/\bauto(motive)?\b|\bmechanic|\bcar (repair|service|care)|\bbrakes?\b|\bmuffler|transmission|oil change/, ["squeaky brakes", "a check-engine light diagnosis"]),
  // Health, personal care, pets, children
  P(/\bdent(al|ist|istry)\b/, ["a chipped tooth", "a same-day cleaning"]),
  P(/\bvet\b|veterinar|animal (hospital|clinic)/, ["a sick dog", "puppy vaccinations"]),
  P(/chiro|physio|physical therap|\bmassage/, ["lower back pain", "treatment for a stiff neck"]),
  P(/\bnail/, ["gel nails", "a pedicure"], { swap: WALKIN, verb: "go with" }),
  P(/\bbarber/, ["a fade haircut", "a beard trim"], { swap: WALKIN, verb: "go with" }),
  P(/groom/, ["dog grooming", "dog nail trims"], { swap: WALKIN, verb: "go with" }),
  P(/\bkennel|\b(dog|doggy|doggie|pet|puppy|canine)\b.*\b(daycare|day care|boarding|sitting|sitter|walking|walker|care|hotel|resort|camp)\b/, ["dog boarding over a holiday weekend", "puppy daycare"], { swap: OPENINGS, verb: "go with" }),
  P(/\bhair|\bsalon|stylist/, ["balayage", "a quick trim"], { swap: WALKIN, verb: "go with" }),
  P(/\bspa\b|facial|esthetic|skin ?care|waxing/, ["a facial", "couples massages"], { swap: WALKIN, verb: "go with" }),
  P(/yoga|pilates|\bbarre\b/, ["a beginner yoga class", "prenatal yoga"], { swap: [["job3", "A specific job", "Which {ts} near {where} offer a free first class?"], ["job4", "A specific job", "Which {ts} near {where} have early morning classes?"]], verb: "join" }),
  P(/\bgym\b|fitness|crossfit|personal train/, ["personal training", "beginner strength classes"], { swap: [["job3", "A specific job", "Which {ts} near {where} offer a free trial or a day pass?"], ["job4", "A specific job", "Which {ts} near {where} are open early in the morning?"]], verb: "join" }),
  P(/preschool|nursery school|pre-?k\b/, ["a pre-K program", "half-day preschool"], { swap: [["job3", "A specific job", "Which {ts} near {where} have openings for this fall?"], ["job4", "A specific job", "Which {ts} near {where} offer tours for new families?"]], verb: "go with" }),
  P(/child ?care|day ?care/, ["infant care", "part-time child care"], { swap: [["openings", "Need it now", "Which {ts} near {where} have openings right now?"], ["dropin", "Need it now", "Which {ts} near {where} offer drop-in care?"]], verb: "go with" }),
  P(/doctor|physician|primary care|pediatric|\bclinic|optomet|eye (care|doctor)|therapist|counsel|psycholog|orthodont|dermatolog|audiolog|hearing|podiatr|urgent care/,
    ["Which {t} near {where} do patients recommend?", "Which {ts} around {where} are easy to get an appointment with?"],
    { swap: NEW_PATIENTS, price: "Which {ts} near {where} take most insurance? Who do you recommend?", verb: "go with" }),
  // Events
  P(/photograph/, ["family portraits", "wedding photography"], { swap: SOON }),
  P(/florist|flower/, ["wedding flowers", "same-day flower delivery"]),
  P(/\bcater/, ["catering a wedding", "office lunch catering"], { swap: SOON }),
  P(/\bprint|\bsigns?\b/, ["business cards printed fast", "vinyl banners"]),
  // Professional and financial services
  P(/real estate|realtor|realty/, ["Which real estate agent near {where} is best for selling a house?", "Who’s a good real estate agent for first-time home buyers near {where}?"],
    { swap: [["job3", "A specific job", "Which real estate agents near {where} know waterfront and lake property?"], ["job4", "A specific job", "I’m moving to {where}. Which real estate agent should I call?"]],
      price: "What commission do real estate agents charge in {where}? Who do you recommend?", verb: "work with",
      maine: ["Who sells camps and cottages near {where}?", "Which real estate agents near {where} work with out-of-state buyers?"] }),
  P(/mortgage|home loan/, ["a first-time home buyer mortgage", "construction loans"],
    { swap: [["job3", "A specific job", "Which {ts} near {where} can pre-approve me quickly?"], ["job4", "A specific job", "Which {t} near {where} is best for refinancing?"]],
      price: "Which {t} in {where} has the best mortgage rates? Who do you recommend?", verb: "go with" }),
  P(/\bbank|credit union/, ["Which {t} near {where} is best for a small business checking account?", "Which {ts} near {where} are best for a home mortgage?"],
    { swap: [["job3", "A specific job", "Which {t} near {where} has the best savings rates?"], ["job4", "A specific job", "Which {ts} near {where} have good customer service?"]],
      price: "Which {t} in {where} has the lowest fees? Who do you recommend?", verb: "bank with",
      maine: ["Which {ts} near {where} are based in Maine?", "Which {t} near {where} is best for a construction or camp loan?"] }),
  P(/lawyer|attorney|\blaw\b|legal/, ["Which lawyer near {where} is good for writing a will?", "Which lawyer near {where} handles a real estate closing?"],
    { swap: [["job3", "A specific job", "Who’s a good family lawyer near {where}?"], ["job4", "A specific job", "Which lawyer near {where} helps small businesses?"]] }),
  P(/accountant|\bcpa\b|bookkeep|\btax/, ["small business bookkeeping", "personal tax returns"],
    { swap: [["job3", "A specific job", "Which {t} near {where} is taking new clients?"], ["job4", "A specific job", "Which {ts} near {where} work with self-employed people?"]] }),
  P(/insurance/, ["home and auto insurance", "small business insurance"],
    { swap: [["job3", "A specific job", "Which {t} near {where} can get me a quote quickly?"], ["job4", "A specific job", "Which {ts} near {where} are independent?"]],
      price: "Which {t} in {where} finds the best rates? Who do you recommend?", verb: "go with" }),
  P(/financial (advis|plan)|wealth|investment/, ["retirement planning", "401(k) rollovers"],
    { swap: [["job3", "A specific job", "Which {ts} near {where} are fee-only fiduciaries?"], ["job4", "A specific job", "Which {t} near {where} is taking new clients?"]],
      price: "How much does {a} {t} charge in {where}? Who do you recommend?", verb: "work with" }),
  P(/property manage/, ["managing a rental property", "Which {t} near {where} can find me a year-round rental?"],
    { swap: [["job3", "A specific job", "Which {ts} near {where} manage vacation rentals?"], ["job4", "A specific job", "Which {t} near {where} do landlords recommend?"]] }),
  P(/funeral|cremation/, ["a simple cremation", "traditional funeral services"],
    { swap: [["job3", "A specific job", "Which {ts} near {where} are family owned?"], ["job4", "A specific job", "Which {t} near {where} helps with pre-planning?"]], verb: "go with" }),
  // Places to stay
  P(/\bhotel|\bmotel|\binns?\b|bed (and|&|n) breakfast|\bb ?& ?b\b|\blodg|campground|\bcabins?\b|\bcottages?\b|vacation rental|\bresort|hostel|glamping/,
    ["Where should a couple stay near {where} for a quiet weekend?", "Best place to stay near {where} with kids?"],
    { swap: [["job3", "A specific job", "{Ts} near {where} with openings this weekend"], ["job4", "A specific job", "Pet-friendly {ts} near {where}"]],
      price: "Affordable {ts} near {where} that are still nice", verb: "stay at", kind: "lodging",
      maine: ["Where to stay near {where} for fall foliage?", "{Ts} near {where} open in winter"] })
];
// A shop: "open now" matters, "emergency" doesn't.
const RETAIL_RE = /\b(store|shop|boutique|market|mart|outlet|emporium|gallery|nursery|greenhouse|dealership|dealer|pharmacy|jeweler|jewelry|bookstore|grocery|supply|supplies|lumber|hardware|garden center|farm stand|butcher|thrift|consignment|antiques?)\b/;
const RETAIL = { kind: "retail", verb: "shop at",
  jobs: ["Which {t} in {where} has the best selection?", "Which {ts} near {where} do locals recommend?"],
  swap: [["opennow", "Right now", "{T} open now near {town}, {st}"], ["opensun", "Right now", "Which {ts} in {where} are open on Sunday?"]],
  price: "Which {t} in {where} has fair prices? Who do you recommend?",
  maine: ["Locally owned {ts} near {where}", "Which {ts} near {where} carry Maine-made products?"] };
// Anything else: the same questions, always naming the kind of business.
const GENERAL = { kind: "general", swap: SOON, jobs: ["Which {ts} near {where} are taking new customers?", "I’m new to {town}. Which {t} should I use?"] };
const GENERAL_MAINE = ["Which {ts} near {where} have been in business the longest?", "Which {t} do locals recommend near {where}?"];
const NOT_A_BUSINESS = /church|parish|nonprofit|non-profit|charity|\bschool\b|library|museum|town office|municipal|government|food (bank|pantry)|\bclub\b|association/;
const MAINE = [
  [/\bplumb/, ["Who can thaw frozen pipes in {where}?", "Efficiency Maine registered plumbers for a heat pump water heater near {where}"]],
  [/\bhvac|\bheat(ing| pumps?)?\b|\bair.?condition|\bfurnace|\bboiler/, ["Which heat pump installers near {where} are Efficiency Maine registered?", "Who can service my heat pump before winter in {where}?"]],
  [/\belectric/, ["Who installs backup generators near {where} before storm season?", "Efficiency Maine registered EV charger installers near {where}"]],
  [/insulat|weatheriz|energy audit/, ["Efficiency Maine registered insulation contractors near {where}", "Who does home energy audits near {where}?"]],
  [/\broof/, ["Who can deal with ice dams near {where}?", "Roofer near {where} for storm damage after a nor’easter"]],
  [/chimney|\bmason/, ["Who cleans chimneys before heating season near {where}?", "Who repairs frost-heaved steps and walkways near {where}?"]],
  [/small engine|lawn ?mower|snow ?blower/, ["Who can fix a snowblower before the next storm near {where}?", "Who tunes up lawn mowers in spring near {where}?"]],
  [/\btree|arborist/, ["Who removes storm-damaged trees near {where}?", "Who does tree work in winter near {where}?"]],
  [/\bpaint/, ["Who paints house exteriors before winter near {where}?", "Who paints camps and cottages near {where}?"]],
  [/^(?!.*\b(carpet|window|dry|pool|gutter|chimney|pressure|power|duct|septic|car|auto|boat)\b).*(\bclean|\bmaid|housekeep)/, ["Who does summer rental turnovers near {where}?", "Who can open up a camp for the season near {where}?"]],
  [/landscap|\blawn|\bgardener|\bgardening|\bplow|\bsnow (removal|plow)/, ["Who does spring cleanup after mud season near {where}?", "Who does snow plowing near {where}?"]],
  [/\bfenc/, ["Who can fix a fence heaved by frost near {where}?", "Who installs farm or snow fencing near {where}?"]],
  [/\bcontract|remodel|\bbuild(er|ers|ing)?\b|\bcarpent|renovat|construction|handyman/, ["Who repairs storm or ice damage on homes near {where}?", "Who renovates camps and cottages near {where}?"]],
  [/\bboat|\bmarine\b|\bmarina/, ["Who does boat winterization and shrink wrap near {where}?", "Who launches and hauls boats near {where}?"]],
  [/\btires?\b|\bauto(motive)?\b|\bmechanic/, ["Where can I get snow tires put on near {where}?", "Who does state inspection stickers near {where}?"]]
];
// The profile for a kind of business: its job questions, anything that replaces the "need it now" pair, and how well the set fits.
function profileFor(word) {
  const k = String(word || "").toLowerCase();
  const hit = PROFILES.find(([re]) => re.test(k));
  const base = hit ? hit[1] : RETAIL_RE.test(k) && !/repair|service|rental/.test(k) ? RETAIL : GENERAL;
  const me = MAINE.find(([re]) => re.test(k));
  const fit = NOT_A_BUSINESS.test(k) ? "poor" : hit ? "built" : base.kind;      // built | retail | general | poor
  return Object.assign({ kind: "service", swap: null, price: null, verb: "hire" }, base, { maine: base.maine || (me ? me[1] : GENERAL_MAINE), fit });
}

export { FOOD_RE, plural, profileFor };
export function noun(trade) { return nounFor(tradeWord(trade)); }
export function isFood(trade) { return isFoodTrade(tradeWord(trade)); }
// How well the question set fits this kind of business, for the founder's eyes before an audit is released.
export function tradeFit(trade) {
  if (isFood(trade)) return { level: "built", note: "" };
  const fit = profileFor(noun(trade)).fit;
  return { level: fit, note: fit === "poor" ? "The questions are written for businesses that customers hire or buy from, so several won’t fit this one. Read the question list before you release the audit."
    : fit === "general" ? "There’s no question set written for this kind of business yet, so it gets the general one. Read the question list before you release the audit, and add custom questions if something important is missing."
    : fit === "retail" ? "This gets the general questions for shops (best, open now, selection, prices). Add custom questions for what they’re known for." : "" };
}

export function article(w) {
  const first = String(w).split(/\s+/)[0];
  if (/^[A-Z]{2,}$/.test(first)) return /^[AEFHILMNORSX]/.test(first) ? "an" : "a";
  return /^[aeiou]/i.test(first) ? "an" : "a";
}
const CRAVE = [
  [/diner|breakfast|brunch/, ["corned beef hash", "blueberry pancakes"], "breakfast"],
  [/caf[eé]|coffee/, ["latte", "a breakfast sandwich"], "breakfast"],
  [/bakery|donut|doughnut|bagel/, ["croissants", "whoopie pies"], "pastries"],
  [/pizza/, ["pizza by the slice", "gluten-free pizza"], "pizza"],
  [/\bdeli\b|delicatessen|sandwich|sub shop/, ["Italian sandwich", "a breakfast sandwich"], "lunch"],
  [/ice cream|gelato|frozen yogurt/, ["soft serve", "homemade ice cream"], "dessert"],
  [/\bbar\b|\bpub\b|brewery|tavern/, ["burger", "local craft beer"], "dinner"],
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
      // A lobster roll question only for places that could serve one; a bakery or an ice cream shop gets the road-trip question.
      /caf[eé]|coffee|bakery|donut|doughnut|bagel|pizza|sushi|taco|mexican|bbq|barbecue|ice cream|gelato|frozen yogurt/.test(tradeWord(client.trade).toLowerCase())
        ? ["roadtrip", "Only in Maine", `Where should I stop for ${meal} on a drive through ${where}?`]
        : ["lobster", "Only in Maine", `Best place for a lobster roll near ${where}?`]
    ];
  } else {
    const pf = profileFor(k);
    const fill = (x) => x.replace(/\{ts\}/g, ts).replace(/\{Ts\}/g, cap(ts)).replace(/\{t\}/g, t).replace(/\{T\}/g, cap(t)).replace(/\{a\}/g, a).replace(/\{where\}/g, where).replace(/\{town\}/g, town).replace(/\{st\}/g, st);
    const job = (x, i) => (x.includes("{") ? fill(x) : i ? `Who does ${x} around ${where}?` : `Who’s good for ${x} near ${where}?`);
    list = [
      ["best", "Looking for the best", `Who’s the best ${t} in ${where}?`],
      ["toprated", "Looking for the best", `Top-rated ${ts} near ${town}, ${st}`],
      // Nobody needs an "emergency" agent, bank, inn or shop: those kinds get two questions that fit in this spot.
      ...(pf.swap ? pf.swap.map(([id, group, text]) => [id, group, fill(text)]) : [
        ["emergency", "Need it now", `Emergency ${t} near ${town}, ${st}`],
        ["today", "Need it now", `I need ${a} ${t} in ${where} today. Who’s open?`]]),
      ["job1", "A specific job", job(pf.jobs[0], 0)],
      ["job2", "A specific job", job(pf.jobs[1], 1)],
      ["price", "Price and trust", pf.price ? fill(pf.price) : `How much does ${a} ${t} cost in ${town}, ${st}? Who do you recommend?`],
      ["trusted", "Price and trust", mi >= 400 ? `Most trusted ${t} in Maine` : `Most trusted ${t} within ${mi} miles of ${where}`],
      ["voice", "Asked out loud", `Find ${a} ${t} near ${town}, Maine`],
      ["maine1", "Only in Maine", fill(pf.maine[0])],
      ["maine2", "Only in Maine", fill(pf.maine[1])]
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
// Do opening hours matter for this business? They do where customers ask AI who's open or who can take them now
// (trades, restaurants, shops, salons). An agent, a lawyer or an advisor works by appointment, so nothing in the
// website check or the plan should press them about hours.
export function hoursMatter(client) {
  try { return discoveryQuestions(client, client.town || "").some((q) => q.group === "Need it now" || q.group === "Right now"); } catch { return true; }
}

export function brandedQuestions(client) {
  const b = clean(client.business), t = noun(client.trade);
  const town = clean(client.town), st = clean(client.state) || "ME";
  return [
    { id: "b_good", group: "About you, by name", text: `Is ${b} in ${town}, ${st} any good?`, town, branded: true },
    { id: "b_info", group: "About you, by name", text: `What are the hours, phone number, and services of ${b} in ${town}, ${st}?`, town, branded: true },
    { id: "b_vs", group: "About you, by name", text: `Should I ${isFood(client.trade) ? "go to" : profileFor(t).verb} ${b} or another ${t} near ${town}, ${st}?`, town, branded: true }
  ];
}
