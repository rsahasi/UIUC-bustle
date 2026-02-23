# Map screen – API keys (optional)

The **Map** tab shows your location and nearby stop pins. The app works without any map API keys: on **iOS** the map uses Apple Maps by default; on **Android** you can add a Google Maps API key for the best experience (without it, the map may show a development watermark).

## Android – Google Maps API key

1. **Google Cloud Console**
   - Go to [Google Cloud Console](https://console.cloud.google.com/).
   - Create or select a project.
   - Enable **Maps SDK for Android** (APIs & Services → Library → search “Maps SDK for Android”).

2. **Create an API key**
   - APIs & Services → Credentials → Create Credentials → API key.
   - Restrict the key (recommended): Application restrictions → Android apps; add your app’s package name (`com.uiuc.bus`) and SHA-1 fingerprint.

3. **Add the key to the app**
   - In `app.json`, under `expo.android.config`, add `googleMaps` with your key:
   ```json
   "android": {
     "package": "com.uiuc.bus",
     "config": {
       "googleMaps": {
         "apiKey": "YOUR_GOOGLE_MAPS_ANDROID_KEY"
       }
     }
   }
   ```
   - To avoid committing the key, use an environment variable and reference it in `app.config.js` (see [Expo config](https://docs.expo.dev/workflow/configuration/)).

4. **Rebuild**
   - The key is baked in at build time. Run a new native build (e.g. `npx expo prebuild --clean` then build, or EAS Build). Hot reload will not pick up the new key.

## iOS – Apple Maps (default)

No key is required. The Map tab uses **Apple Maps** by default on iOS.

To use **Google Maps** on iOS instead (optional):

1. Enable **Maps SDK for iOS** in Google Cloud and create an API key (or use the same key with iOS restriction).
2. Configure the key in your native iOS project (e.g. `AppDelegate` or `GoogleMaps` setup). This usually requires a [development build](https://docs.expo.dev/develop/development-builds/introduction/) and custom native config; Expo Go may not support custom Google Maps on iOS.

## Summary

| Platform | Default / no key              | With Google key              |
|----------|-------------------------------|-------------------------------|
| iOS      | Apple Maps (works)            | Optional: custom dev build   |
| Android  | Map may show dev watermark    | Add `googleMaps.apiKey` + rebuild |
| Web      | Map tab shows “not available” | N/A                          |

The app remains fully functional without any map keys: Home, Schedule, Settings, and Trip all work. The Map tab is optional and behind its own tab.
