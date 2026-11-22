// Shared by the geotagged photo screens (proof of planting, harvest report):
// the barangay reference point, distance, accuracy wording, the map embed,
// and a timeout for location extras that can stall.

// Barangay Langapud's approximate center — the schema has no per-parcel GPS
// coordinates, so this is the only geographic anchor available to flag a
// capture that's obviously nowhere near the declared parcel. Mirrors the
// reference point and threshold the web review screen uses.
export const LANGAPUD_REF = { lat: 7.8333, lng: 123.6333 };
export const FAR_THRESHOLD_KM = 5;

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function accuracyRating(meters) {
  if (meters == null) return "Unknown";
  if (meters <= 10) return "High";
  if (meters <= 30) return "Medium";
  return "Low";
}

const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export function compassLabel(deg) {
  return COMPASS_POINTS[Math.round(deg / 45) % 8];
}

// reverseGeocodeAsync and getHeadingAsync can stall instead of rejecting;
// neither is required for a valid geotag.
export function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), ms))]);
}

// The keyless output=embed URL only renders inside a real <iframe> (Google
// checks window.top !== window.self), so the WebView loads a one-line page
// that iframes it.
export function mapEmbedHtml(latitude, longitude) {
  const src = `https://www.google.com/maps?q=${latitude},${longitude}&z=15&output=embed`;
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>html,body{margin:0;padding:0;height:100%;}iframe{border:0;width:100%;height:100%;}</style></head>
    <body><iframe src="${src}"></iframe></body></html>`;
}
