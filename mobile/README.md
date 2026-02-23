# UIUC Bustle — Mobile

React Native app (Expo Router) for UIUC campus bus and walk navigation.

See the [root README](../README.md) for full setup instructions.

## Quick start

```bash
npm install
./start-sim.sh        # iOS simulator with UIUC GPS pinned
# or
npx expo start --ios  # manual
```

Set the API URL to `http://localhost:8000` in the **Settings** tab.

## Walking modes

Configured in Settings, used for route ETAs and walk navigation:

| Mode | Speed |
|------|-------|
| Walk | 1.2 m/s |
| Brisk | 1.5 m/s |
| Speed walk | 1.9 m/s |
| Jog | 2.7 m/s |

## Map setup (Android / Google Maps)

See [docs/MAP_SETUP.md](docs/MAP_SETUP.md) for Google Maps API key setup on Android.
iOS uses Apple Maps by default — no key required.

## Offline behaviour

When the network is unavailable, the Home tab falls back to the last cached stops, departures, classes, and recommendations, with a banner and inline Retry button.
