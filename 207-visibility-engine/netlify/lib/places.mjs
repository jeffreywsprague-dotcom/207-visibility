// Google Places API (New): business facts (rating, reviews, hours, phone, website)
// and town coordinates for location-aware questions. Optional: without a key, the
// engine falls back to built-in approximate coordinates for Maine towns.

import { coordsFor } from "./towns.mjs";

const KEY = () => process.env.GOOGLE_MAPS_API_KEY;

async function searchText(query, fieldMask) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Goog-Api-Key": KEY(), "X-Goog-FieldMask": fieldMask },
    body: JSON.stringify({ textQuery: query, regionCode: "US", maxResultCount: 3 })
  });
  if (!res.ok) throw new Error(`Places HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.places || [];
}

export async function locate(town, state = "ME") {
  const k = String(town || "").trim().toLowerCase();
  if (KEY()) {
    try {
      const [p] = await searchText(`${town}, ${state}`, "places.location,places.formattedAddress");
      if (p?.location) return { town, region: state === "ME" ? "Maine" : state, lat: p.location.latitude, lng: p.location.longitude, source: "google" };
    } catch { /* fall through */ }
  }
  const c = coordsFor(k);
  return { town, region: state === "ME" ? "Maine" : state, lat: c ? c[0] : null, lng: c ? c[1] : null, source: c ? "approximate" : "none" };
}

const FIELDS = [
  "places.id", "places.displayName", "places.formattedAddress", "places.nationalPhoneNumber", "places.websiteUri",
  "places.rating", "places.userRatingCount", "places.regularOpeningHours.weekdayDescriptions",
  "places.businessStatus", "places.primaryTypeDisplayName", "places.googleMapsUri"
].join(",");

export async function businessFacts(name, town, state = "ME") {
  if (!KEY()) return { skipped: "GOOGLE_MAPS_API_KEY not set" };
  try {
    const list = await searchText(`${name}, ${town}, ${state}`, FIELDS);
    const p = list[0];
    if (!p) return { found: false };
    return {
      found: true,
      name: p.displayName?.text || "",
      address: p.formattedAddress || "",
      phone: p.nationalPhoneNumber || "",
      website: p.websiteUri || "",
      rating: p.rating ?? null,
      reviews: p.userRatingCount ?? null,
      hours: p.regularOpeningHours?.weekdayDescriptions || [],
      status: p.businessStatus || "",
      category: p.primaryTypeDisplayName?.text || "",
      mapsUrl: p.googleMapsUri || ""
    };
  } catch (e) {
    return { error: e.message };
  }
}

// Up to 5 Google reviews for a business (Places API limit), used to spot towns customers mention.
export async function reviewTexts(name, town, state = "ME") {
  if (!KEY()) return [];
  try {
    const [p] = await searchText(`${name}, ${town}, ${state}`, "places.id");
    if (!p?.id) return [];
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(p.id)}`, {
      headers: { "X-Goog-Api-Key": KEY(), "X-Goog-FieldMask": "reviews" }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.reviews || []).map((r) => r.originalText?.text || r.text?.text || "").filter(Boolean);
  } catch { return []; }
}
