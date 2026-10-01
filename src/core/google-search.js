// Build Google Search URLs used by the Google AI Overview adapter.

function encodeBase64UrlUtf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function encodeUULE(location) {
  const normalized = String(location || "").trim();
  if (!normalized) return "";
  return `w+CAIQICI${encodeBase64UrlUtf8(normalized)}`;
}

export function buildSearchURL(query, options = {}) {
  const params = new URLSearchParams();
  params.set("q", String(query || "").trim());
  params.set("pws", "0");
  params.set("num", "10");

  const language = String(options.language || "").trim();
  const country = String(options.country || "").trim().toUpperCase();
  const location = String(options.location || "").trim();
  if (language) params.set("hl", language);
  if (country) params.set("gl", country);
  if (location) params.set("uule", encodeUULE(location));

  return `https://www.google.com/search?${params.toString()}`;
}
