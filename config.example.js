// Copy this file to config.js and fill in real keys. config.js is
// gitignored — never commit real keys.
//
// Supabase's project URL/key are NOT set here — see SUPABASE.md and
// Settings -> Cross-device sync in the app itself.
window.APP_CONFIG = {
  FOODDATA_API_KEY: "",
  GEMINI_API_KEY: "",
  // Free tier at finnhub.io — used for Markets' stock search + portfolio
  // price lookup.
  FINNHUB_API_KEY: "",
  // Free tier at twelvedata.com — used for Markets' price chart. Both of
  // these are just local-dev fallbacks; the app itself reads them from
  // Settings -> "Markets stock lookup" (per-device localStorage) instead.
  TWELVEDATA_API_KEY: "",
};
