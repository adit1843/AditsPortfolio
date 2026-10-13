# Neosis iOS — Capacitor development app

This project is under active development. It includes two configurations:

- **Development mode:** Loads the full, live, authenticated Neosis product in WKWebView at its existing HTTPS origin. This keeps session cookies and `/api` calls working for personal iPhone testing. It depends on internet access. Capacitor's `server.url` is explicitly a development-only feature.
- **Release mode (not yet ready):** Bundles local assets in `www/` and currently shows a branded entry screen. The production-grade mobile authentication/API integration and audio background handling have not been implemented yet. Do **not** submit this to TestFlight.

## On your Mac

Install Node.js 22+, Xcode (current version), and Xcode command-line tools.

```sh
git clone https://github.com/adit1843/AditsPortfolio.git
cd AditsPortfolio/ios-app
npm install
npx cap add ios
npm run ios:dev
npx cap open ios
```

In Xcode: select iPhone Simulator and press Run. For a physical iPhone, attach it, sign in with your free Apple Account under Xcode Settings > Accounts, then choose your Personal Team under Signing & Capabilities. Select the device and Run. Free provisioning expires periodically (typically seven days).

`npm run ios:dev` temporarily swaps in the remote development configuration for syncing **and restores the local release config afterward**, so Git never needs to store `server.url` in the production config. Running `npx cap sync ios` later will sync the **release** screen instead: run `npm run ios:dev` again before local live-product tests.

### Important before TestFlight

1. Bundle a production version of the actual Neosis UI, not merely this starter screen.
2. Replace same-origin cookie assumptions and relative `/api` endpoints with an authenticated cross-origin mobile API architecture. Handle OAuth callbacks, logout, and account deletion.
3. Add proper native media session / lock-screen playback, audio interruptions, and background modes; review App Store rules.
4. Produce validated 1024×1024 iOS icon assets, native splash screens, and required privacy disclosures.
5. Add Apple Developer Program membership, configure final unique bundle ID, signing, archive, and submit via App Store Connect.

The web production source and backend are intentionally untouched by the iOS work.
