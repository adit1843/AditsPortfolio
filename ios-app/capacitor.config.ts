import type { CapacitorConfig } from '@capacitor/cli';

// Release-safe default: bundled, local web assets. Do not set server.url in distribution builds.
const config: CapacitorConfig = {
  appId: 'com.noesis.daily', // Confirm final bundle identifier before App Store registration.
  appName: 'Noesis',
  webDir: 'www',
  ios: { contentInset: 'automatic', scrollEnabled: true },
  plugins: {
    SplashScreen: { launchShowDuration: 0, backgroundColor: '#FFF8F1' },
    StatusBar: { style: 'DARK', backgroundColor: '#FFF8F1' }
  }
};
export default config;
