# UIUC Bus — Mobile

Expo (React Native) app: Home, Schedule, Settings, Trip, Report issue.

## Run (one command)

From the **mobile** directory:

```bash
npm start
```

Then press `i` for iOS simulator or `a` for Android. Set the API base URL in Settings (e.g. `http://localhost:8000` for simulator).

## Telemetry & Report issue

- In-memory log buffer (no PII): API path, status, errors, offline/cache events.
- **Settings → Report issue**: copy recent logs to clipboard to paste when reporting a bug (no external service).

## Map tab (optional)

The **Map** tab shows your location and nearby stops. No API keys are required for basic use (iOS uses Apple Maps). For Google Maps on Android and optional setup, see **[docs/MAP_SETUP.md](docs/MAP_SETUP.md)**.

## Reliability

- **Refresh**: Debounced (400ms) to avoid double-fetch.
- **In-flight requests**: AbortController cancels Home API calls on unmount.
- **Offline**: Last-known Home data (stops, departures, classes, recommendations) is persisted; on network failure the app shows cached data and an "Offline" banner.
