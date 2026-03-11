import WidgetKit
import SwiftUI

// ─── UIUC Brand colors ────────────────────────────────────────────────────────
private let uiucNavy    = Color(red: 0.074, green: 0.161, blue: 0.294)  // #13294B
private let uiucNavyLt  = Color(red: 0.114, green: 0.239, blue: 0.435)  // #1D3D6F
private let uiucOrange  = Color(red: 0.910, green: 0.290, blue: 0.153)  // #E84A27

// ─── Timeline Entry ───────────────────────────────────────────────────────────
struct UIUCEntry: TimelineEntry {
    let date: Date
    let data: WidgetData
}

// ─── Provider ─────────────────────────────────────────────────────────────────
struct UIUCProvider: TimelineProvider {
    func placeholder(in context: Context) -> UIUCEntry {
        UIUCEntry(date: .now, data: WidgetDataLoader.placeholder())
    }

    func getSnapshot(in context: Context, completion: @escaping (UIUCEntry) -> Void) {
        let data = WidgetDataLoader.load() ?? WidgetDataLoader.placeholder()
        completion(UIUCEntry(date: .now, data: data))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<UIUCEntry>) -> Void) {
        let data = WidgetDataLoader.load() ?? WidgetDataLoader.placeholder()
        let entry = UIUCEntry(date: .now, data: data)

        // Refresh more aggressively when leave-time is imminent
        let leaveIn = data.nextClass?.leaveInMinutes ?? 999
        let refreshInterval: TimeInterval = leaveIn < 30 ? 5 * 60 : 15 * 60
        let nextRefresh = Date().addingTimeInterval(refreshInterval)

        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

// ─── Small Widget (2×2) ───────────────────────────────────────────────────────
struct SmallWidgetView: View {
    let entry: UIUCEntry

    var body: some View {
        ZStack {
            LinearGradient(colors: [uiucNavy, uiucNavyLt],
                           startPoint: .topLeading, endPoint: .bottomTrailing)

            if let cls = entry.data.nextClass {
                VStack(alignment: .leading, spacing: 4) {
                    Text(cls.name)
                        .font(.custom("DMSerifDisplay-Regular", size: 17))
                        .foregroundColor(.white)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)

                    Text(cls.startTime)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.white.opacity(0.75))

                    Spacer()

                    if cls.leaveInMinutes > 0 && cls.leaveInMinutes < 120 {
                        HStack(spacing: 4) {
                            Circle()
                                .fill(uiucOrange)
                                .frame(width: 6, height: 6)
                            Text("Leave in \(cls.leaveInMinutes) min")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(uiucOrange)
                        }
                    } else if cls.leaveInMinutes <= 0 {
                        Text("Leave now")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(uiucOrange)
                    }
                }
                .padding(12)
            } else {
                VStack(spacing: 6) {
                    Text("No class today")
                        .font(.custom("DMSerifDisplay-Regular", size: 14))
                        .foregroundColor(.white.opacity(0.85))
                    Text("\(entry.data.stepsToday) steps")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundColor(uiucOrange)
                    Text("today")
                        .font(.system(size: 11))
                        .foregroundColor(.white.opacity(0.6))
                }
            }
        }
    }
}

// ─── Medium Widget (2×4) ──────────────────────────────────────────────────────
struct MediumWidgetView: View {
    let entry: UIUCEntry

    var body: some View {
        ZStack {
            LinearGradient(colors: [uiucNavy, uiucNavyLt],
                           startPoint: .topLeading, endPoint: .bottomTrailing)

            VStack(alignment: .leading, spacing: 0) {
                if let cls = entry.data.nextClass {
                    // Class name + time
                    HStack(alignment: .firstTextBaseline) {
                        Text(cls.name)
                            .font(.custom("DMSerifDisplay-Regular", size: 18))
                            .foregroundColor(.white)
                            .lineLimit(1)
                        Spacer()
                        Text(cls.startTime)
                            .font(.system(size: 13, weight: .medium, design: .monospaced))
                            .foregroundColor(.white.opacity(0.7))
                    }

                    Text(cls.building)
                        .font(.system(size: 12))
                        .foregroundColor(.white.opacity(0.6))
                        .lineLimit(1)
                        .padding(.top, 2)

                    Divider().background(Color.white.opacity(0.2)).padding(.vertical, 8)

                    // Primary departure line
                    if let bus = entry.data.nextBus {
                        HStack(spacing: 6) {
                            if cls.leaveInMinutes > 0 && cls.leaveInMinutes < 120 {
                                Text("Leave in \(cls.leaveInMinutes) min")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundColor(uiucOrange)
                            } else {
                                Text("Leave by \(cls.leaveByTime)")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundColor(uiucOrange)
                            }
                            Text("→")
                                .foregroundColor(.white.opacity(0.5))
                                .font(.system(size: 11))
                            Text("Rt \(bus.route)")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(uiucOrange.opacity(0.25))
                                .cornerRadius(4)
                        }

                        // Stop + live indicator
                        HStack(spacing: 4) {
                            if bus.isLive {
                                Circle().fill(uiucOrange).frame(width: 5, height: 5)
                                Text("Live").font(.system(size: 10, weight: .semibold)).foregroundColor(uiucOrange)
                            } else {
                                Text("Scheduled").font(.system(size: 10)).foregroundColor(.white.opacity(0.4))
                            }
                            Text("· \(bus.stop)")
                                .font(.system(size: 11))
                                .foregroundColor(.white.opacity(0.65))
                                .lineLimit(1)
                        }
                        .padding(.top, 4)
                    } else {
                        Text("Leave by \(cls.leaveByTime)")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(uiucOrange)
                        Text("Walk to class")
                            .font(.system(size: 11))
                            .foregroundColor(.white.opacity(0.55))
                            .padding(.top, 2)
                    }
                } else {
                    Text("No upcoming class")
                        .font(.custom("DMSerifDisplay-Regular", size: 16))
                        .foregroundColor(.white.opacity(0.8))
                    Spacer()
                    HStack {
                        Text("\(entry.data.stepsToday)")
                            .font(.system(size: 28, weight: .bold))
                            .foregroundColor(uiucOrange)
                        Text("steps today")
                            .font(.system(size: 12))
                            .foregroundColor(.white.opacity(0.6))
                    }
                }
            }
            .padding(14)
        }
    }
}

// ─── Large Widget (4×4) ───────────────────────────────────────────────────────
struct LargeWidgetView: View {
    let entry: UIUCEntry

    var body: some View {
        ZStack {
            LinearGradient(colors: [uiucNavy, uiucNavyLt],
                           startPoint: .topLeading, endPoint: .bottomTrailing)

            VStack(alignment: .leading, spacing: 0) {
                // Header
                Text("Today's Schedule")
                    .font(.custom("DMSerifDisplay-Regular", size: 17))
                    .foregroundColor(.white)
                    .padding(.bottom, 10)

                // Class timeline
                if entry.data.todayClasses.isEmpty {
                    Text("No classes today")
                        .font(.system(size: 14))
                        .foregroundColor(.white.opacity(0.6))
                        .padding(.bottom, 10)
                } else {
                    ForEach(entry.data.todayClasses.prefix(5), id: \.name) { cls in
                        HStack(spacing: 10) {
                            // Time column
                            VStack(spacing: 2) {
                                Text(cls.recommendedDepartTime)
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundColor(uiucOrange)
                                Rectangle()
                                    .fill(Color.white.opacity(0.15))
                                    .frame(width: 1, height: 8)
                            }
                            .frame(width: 36)

                            // Class info
                            VStack(alignment: .leading, spacing: 1) {
                                Text(cls.name)
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundColor(.white)
                                    .lineLimit(1)
                                Text("\(cls.startTime) · \(cls.building)")
                                    .font(.system(size: 11))
                                    .foregroundColor(.white.opacity(0.55))
                                    .lineLimit(1)
                            }
                            Spacer()
                        }
                        .padding(.bottom, 8)
                    }
                }

                Spacer()

                // Current time indicator
                HStack(spacing: 6) {
                    Rectangle()
                        .fill(uiucOrange)
                        .frame(height: 1)
                    Text("Now")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(uiucOrange)
                }
                .padding(.bottom, 10)

                // Steps + weekly progress
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("\(entry.data.stepsToday) steps today")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.white.opacity(0.85))
                        Spacer()
                        Text("\(Int(entry.data.weeklyStepsProgress * 100))% weekly goal")
                            .font(.system(size: 11))
                            .foregroundColor(.white.opacity(0.55))
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule()
                                .fill(Color.white.opacity(0.15))
                                .frame(height: 5)
                            Capsule()
                                .fill(uiucOrange)
                                .frame(width: geo.size.width * entry.data.weeklyStepsProgress, height: 5)
                        }
                    }
                    .frame(height: 5)
                }
            }
            .padding(14)
        }
    }
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
struct UIUCWidget: Widget {
    let kind: String = "UIUCWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: UIUCProvider()) { entry in
            UIUCWidgetEntryView(entry: entry)
                .containerBackground(uiucNavy, for: .widget)
        }
        .configurationDisplayName("UIUC Bus")
        .description("Next class, departure time, and live bus info.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct UIUCWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: UIUCEntry

    var body: some View {
        switch family {
        case .systemSmall:  SmallWidgetView(entry: entry)
        case .systemMedium: MediumWidgetView(entry: entry)
        case .systemLarge:  LargeWidgetView(entry: entry)
        default:            SmallWidgetView(entry: entry)
        }
    }
}
