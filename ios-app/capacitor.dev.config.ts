import type { CapacitorConfig } from '@capacitor/cli';
import base from './capacitor.config';
// Local development ONLY: test current hosted product without migrating backend yet.
// Never submit a TestFlight/App Store build with server.url enabled.
const config: CapacitorConfig = {
 ...base,
 server: { url: 'https://aditsanghani.com/briefing/', cleartext: false, allowNavigation: ['aditsanghani.com'] }
};
export default config;
