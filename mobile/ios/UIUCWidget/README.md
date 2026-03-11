# UIUC Bus Widget — Native Setup

## What's here
- `UIUCWidget.swift` — 3 widget sizes (small/medium/large) in SwiftUI
- `UIUCWidgetBundle.swift` — Widget bundle entry point
- `WidgetData.swift` — Decodable data model (mirrors `widgetDataWriter.ts`)
- `Info.plist` — Widget extension plist

## Adding to Xcode (EAS Build)

1. Open `ios/` in Xcode: `open ios/UIUCBusApp.xcworkspace`
2. File → New → Target → Widget Extension
   - Product name: `UIUCWidget`
   - Include Configuration Intent: OFF
3. Replace generated files with the files in this directory
4. In the widget target's **Signing & Capabilities**:
   - Add "App Groups" capability
   - Create group: `group.com.uiucbusapp.widget`
5. Do the same in the **main app target** (same group ID)
6. In `WidgetData.swift`, update `WidgetDataLoader.load()` to use the App Group path:
   ```swift
   FileManager.default
     .containerURL(forSecurityApplicationGroupIdentifier: "group.com.uiucbusapp.widget")!
     .appendingPathComponent("widget_data.json")
   ```
7. In `widgetDataWriter.ts`, update the path to write to the App Group via
   a native module (or use `expo-file-system` with a custom path when the
   App Group entitlement is wired in `app.json`).

## EAS Build app.json config
```json
{
  "expo": {
    "ios": {
      "entitlements": {
        "com.apple.security.application-groups": ["group.com.uiucbusapp.widget"]
      }
    }
  }
}
```

## How data flows
```
App (JS)
  └─ widgetRefresh.ts        ← builds WidgetData snapshot
       └─ writeWidgetData()  ← writes widget_data.json
            └─ expo-file-system documentDirectory (dev)
                 OR App Group container (production EAS)

Widget Extension (Swift)
  └─ UIUCProvider.getTimeline()
       └─ WidgetDataLoader.load()  ← reads widget_data.json
            └─ Refreshes every 5–15 min via WidgetKit
```

## Deep links from widget tap
- Tap small/medium → opens Home tab (`/`)
- Tap large widget → opens Schedule tab (`/schedule`)

To implement, use `Link` in SwiftUI with a custom URL scheme:
```swift
Link(destination: URL(string: "uiucbus://home")!) { SmallWidgetView(...) }
```
And register the URL scheme in `app.json`:
```json
{ "expo": { "scheme": "uiucbus" } }
```
