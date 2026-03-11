import Foundation

// ─── Data model (mirrors widgetDataWriter.ts) ────────────────────────────────

struct WidgetNextClass: Codable {
    var name: String
    var startTime: String
    var building: String
    var leaveByTime: String
    var leaveInMinutes: Int
}

struct WidgetNextBus: Codable {
    var route: String
    var stop: String
    var departureTime: String
    var minsUntil: Int
    var isLive: Bool
}

struct WidgetTodayClass: Codable {
    var name: String
    var startTime: String
    var building: String
    var recommendedDepartTime: String
}

struct WidgetData: Codable {
    var nextClass: WidgetNextClass?
    var nextBus: WidgetNextBus?
    var todayClasses: [WidgetTodayClass]
    var stepsToday: Int
    var weeklyStepGoal: Int
    var weeklyStepsProgress: Double
    var lastUpdated: Double
    var isDataFresh: Bool
}

// ─── Loader ───────────────────────────────────────────────────────────────────

struct WidgetDataLoader {
    /// Path matches widgetDataWriter.ts — documentDirectory/widget_data.json
    /// For production with App Group, replace with:
    ///   FileManager.default
    ///     .containerURL(forSecurityApplicationGroupIdentifier: "group.com.uiucbusapp.widget")!
    ///     .appendingPathComponent("widget_data.json")
    static func load() -> WidgetData? {
        guard let url = try? FileManager.default
            .url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
            .appendingPathComponent("widget_data.json"),
              let data = try? Data(contentsOf: url)
        else { return nil }
        return try? JSONDecoder().decode(WidgetData.self, from: data)
    }

    static func placeholder() -> WidgetData {
        WidgetData(
            nextClass: WidgetNextClass(
                name: "CS 225",
                startTime: "10:00",
                building: "Siebel Center",
                leaveByTime: "09:42",
                leaveInMinutes: 18
            ),
            nextBus: WidgetNextBus(
                route: "22",
                stop: "Pennsylvania & Ag",
                departureTime: "09:45",
                minsUntil: 21,
                isLive: true
            ),
            todayClasses: [],
            stepsToday: 2400,
            weeklyStepGoal: 50000,
            weeklyStepsProgress: 0.42,
            lastUpdated: Date().timeIntervalSince1970 * 1000,
            isDataFresh: true
        )
    }
}
