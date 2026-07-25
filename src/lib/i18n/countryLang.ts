/**
 * Country (ISO-3166 alpha-2) → the language we auto-offer there.
 *
 * The visitor's country already arrives on every request as `X-Country-Code`,
 * set by nginx from the GeoIP2 database (the grains game uses the same header
 * for its country leaderboard), so IP-based detection costs us nothing extra —
 * no geo-lookup service, no client round trip.
 *
 * This is a BEST GUESS, never a lock-in: many countries are multilingual, and a
 * traveller or VPN user will be mis-guessed. The switcher always shows what was
 * picked and lets the visitor change it or go back to English, and their explicit
 * choice is remembered and beats this map forever after.
 *
 * Anything not listed falls back to English.
 */
const COUNTRY_LANG: Record<string, string> = {
  // Spanish
  ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es", VE: "es", EC: "es",
  GT: "es", CU: "es", BO: "es", DO: "es", HN: "es", PY: "es", SV: "es", NI: "es",
  CR: "es", PA: "es", UY: "es", GQ: "es",
  // Portuguese
  BR: "pt", PT: "pt", AO: "pt", MZ: "pt", CV: "pt",
  // Chinese
  CN: "zh-CN", SG: "zh-CN", TW: "zh-TW", HK: "zh-TW", MO: "zh-TW",
  // South & Southeast Asia
  IN: "hi", BD: "bn", PK: "ur", LK: "si", NP: "ne", MM: "my", KH: "km", LA: "lo",
  TH: "th", VN: "vi", ID: "id", MY: "ms", PH: "tl",
  // East Asia
  JP: "ja", KR: "ko", MN: "mn",
  // Middle East / North Africa (Arabic)
  SA: "ar", AE: "ar", EG: "ar", DZ: "ar", MA: "ar", TN: "ar", LY: "ar", IQ: "ar",
  JO: "ar", KW: "ar", QA: "ar", BH: "ar", OM: "ar", YE: "ar", SY: "ar", LB: "ar",
  SD: "ar", PS: "ar",
  IR: "fa", AF: "fa", IL: "he", TR: "tr",
  // Europe
  FR: "fr", BE: "fr", MC: "fr", DE: "de", AT: "de", CH: "de", LI: "de",
  IT: "it", SM: "it", VA: "it", NL: "nl", RU: "ru", UA: "uk", BY: "be",
  PL: "pl", CZ: "cs", SK: "sk", HU: "hu", RO: "ro", MD: "ro", BG: "bg",
  GR: "el", CY: "el", RS: "sr", HR: "hr", BA: "bs", SI: "sl", MK: "mk",
  AL: "sq", XK: "sq", LT: "lt", LV: "lv", EE: "et", FI: "fi", SE: "sv",
  NO: "no", DK: "da", IS: "is",
  // Caucasus & Central Asia
  GE: "ka", AM: "hy", AZ: "az", KZ: "kk", UZ: "uz", KG: "ru", TJ: "ru", TM: "ru",
  // Africa
  ET: "am", KE: "sw", TZ: "sw", UG: "sw", NG: "ha", SO: "so", ZA: "af", ZW: "en",
  // Americas / Oceania that are already English default via fallback:
  HT: "ht",
};

/**
 * The language to auto-offer a visitor from `code`. Returns "en" for unknown or
 * missing countries (including the "XX" the geo lookup emits when it fails).
 */
export function languageForCountry(code: string | null | undefined): string {
  if (!code) return "en";
  return COUNTRY_LANG[code.trim().toUpperCase()] ?? "en";
}
