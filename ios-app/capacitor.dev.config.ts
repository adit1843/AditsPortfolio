import type { CapacitorConfig } from '@capacitor/cli';
import base from './capacitor.config';
// For personal iPhone testing only. Runs the existing authenticated Noesis website
// inside WKWebView using the original HTTPS origin so cookie-based API calls work.
// NEVER distribute, archive, or submit this config to TestFlight/App Store.
const config: CapacitorConfig = {
  ...base,
  server: { url: 'https://aditsanghani.com/briefing/', cleartext: false, allowNavigation: ['aditsanghani.com'] }
};
export default config;
