// Approximate coordinates for Maine towns, larger places first. Used to pick test
// towns automatically and as a fallback when no Google Maps key is set.
export const MAINE_TOWNS = [
  ["Portland", 43.6591, -70.2568], ["Lewiston", 44.1004, -70.2148], ["Bangor", 44.8016, -68.7712], ["South Portland", 43.6415, -70.2409],
  ["Auburn", 44.0979, -70.2312], ["Biddeford", 43.4926, -70.4534], ["Augusta", 44.3106, -69.7795], ["Saco", 43.5009, -70.4428],
  ["Westbrook", 43.677, -70.3712], ["Waterville", 44.552, -69.6317], ["Brunswick", 43.9145, -69.9653], ["Scarborough", 43.5781, -70.3217],
  ["Sanford", 43.4392, -70.7742], ["Windham", 43.8001, -70.4245], ["Gorham", 43.6795, -70.4442], ["Falmouth", 43.7295, -70.242],
  ["Kennebunk", 43.384, -70.5445], ["Bath", 43.9109, -69.8206], ["Topsham", 43.9276, -69.9759], ["Brewer", 44.7967, -68.7614],
  ["Rockland", 44.1037, -69.1089], ["Belfast", 44.4259, -69.0064], ["Camden", 44.2098, -69.0648], ["Ellsworth", 44.5434, -68.4195],
  ["York", 43.1615, -70.6484], ["Kittery", 43.0884, -70.7364], ["Skowhegan", 44.7653, -69.719], ["Farmington", 44.6706, -70.1512],
  ["Gardiner", 44.2301, -69.7753], ["Hallowell", 44.2862, -69.7909], ["Yarmouth", 43.8006, -70.1867], ["Freeport", 43.857, -70.1031],
  ["Cumberland", 43.7965, -70.2587], ["Cape Elizabeth", 43.5637, -70.2001], ["Old Orchard Beach", 43.5173, -70.3776], ["Gray", 43.8856, -70.3317],
  ["Standish", 43.7362, -70.5509], ["Fairfield", 44.5884, -69.5986], ["Oakland", 44.5401, -69.722], ["Winthrop", 44.3051, -69.977],
  ["Monmouth", 44.2387, -70.0356], ["Belgrade", 44.4473, -69.8328], ["Litchfield", 44.1612, -69.9659], ["Bar Harbor", 44.3876, -68.2039],
  ["Presque Isle", 46.6812, -68.0159], ["Orono", 44.8831, -68.6719], ["Old Town", 44.9342, -68.6453], ["Wells", 43.3223, -70.5806],
  ["Berwick", 43.2659, -70.8651], ["Norway", 44.2137, -70.5445], ["South Paris", 44.2237, -70.5134], ["Bridgton", 44.0548, -70.7128],
  ["Naples", 43.9718, -70.6097], ["Rumford", 44.5537, -70.5509], ["Bethel", 44.4040, -70.7909], ["Boothbay Harbor", 43.8523, -69.6281],
  ["Damariscotta", 44.0329, -69.5181], ["Wiscasset", 44.0029, -69.6656], ["Waldoboro", 44.0954, -69.3756], ["Houlton", 46.1259, -67.8403],
  ["Caribou", 46.8606, -68.0120], ["Calais", 45.1884, -67.2786], ["Machias", 44.7151, -67.4614], ["Dover-Foxcroft", 45.1834, -69.2267],
  ["Millinocket", 45.6573, -68.7098], ["Lincoln", 45.3623, -68.5056], ["Greenville", 45.4595, -69.5906], ["Pittsfield", 44.7823, -69.3834],
  ["Newport", 44.8353, -69.2739], ["Madison", 44.7973, -69.8798], ["Lisbon", 44.0317, -70.1048], ["Turner", 44.2562, -70.2559],
  ["Sabattus", 44.1195, -70.0759], ["Poland", 44.0606, -70.3934], ["Raymond", 43.9014, -70.4703], ["New Gloucester", 43.9645, -70.2834],
  ["Farmingdale", 44.2448, -69.7714], ["Richmond", 44.0873, -69.7989], ["Manchester", 44.3251, -69.859], ["China", 44.4787, -69.517],
  ["Vassalboro", 44.459, -69.6773], ["Pittston", 44.1734, -69.7473], ["West Gardiner", 44.2337, -69.8473], ["Readfield", 44.3876, -69.9659],
  ["Sidney", 44.4729, -69.7275], ["Wayne", 44.3487, -70.0662], ["Bowdoinham", 44.0084, -69.8984], ["Hampden", 44.7445, -68.837],
  ["Hermon", 44.8101, -68.9134], ["Bucksport", 44.5737, -68.7956], ["Thomaston", 44.0790, -69.1817], ["Harpswell", 43.8015, -69.9839],
  ["Kennebunkport", 43.3617, -70.4767], ["Eliot", 43.1531, -70.8001], ["South Berwick", 43.2342, -70.8095], ["Buxton", 43.6376, -70.519]
];
const byName = Object.fromEntries(MAINE_TOWNS.map(([n, la, lo]) => [n.toLowerCase(), [la, lo]]));
export function coordsFor(town) { return byName[String(town || "").trim().toLowerCase()] || null; }

function miles(a, b) {
  const R = 3958.8, toR = (d) => (d * Math.PI) / 180;
  const dLa = toR(b[0] - a[0]), dLo = toR(b[1] - a[1]);
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Pick up to n larger towns inside the service radius, spread apart, to test from.
export function nearbyTowns(town, radius = 15, n = 2) {
  const home = coordsFor(town);
  if (!home) return [];
  const r = Math.max(10, Math.min(400, Number(radius) || 15));
  const spacing = Math.max(10, Math.min(40, r / 6)); // spread test towns out more for big service areas
  const picked = [];
  for (const [name, la, lo] of MAINE_TOWNS) {
    if (name.toLowerCase() === String(town).trim().toLowerCase()) continue;
    const d = miles(home, [la, lo]);
    if (d < 6 || d > r) continue;
    if (picked.some((p) => miles([p.la, p.lo], [la, lo]) < spacing)) continue;
    picked.push({ name, la, lo });
    if (picked.length >= n) break;
  }
  return picked.map((p) => p.name);
}
