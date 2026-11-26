import SwiftUI
import WidgetKit

/// Today's training on the watch face. The watch app saves the week's cards
/// whenever the phone sends a new week (WatchApp/SessionStore.swift); each
/// shows from its midnight, so the face moves on without the phone.
@main
struct WatchWidgetsBundle: WidgetBundle {
    var body: some Widget {
        TodayComplication()
    }
}

struct TodayComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "OvertrainedTodayWatch", provider: TodayProvider()) { entry in
            ComplicationView(entry: entry)
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Today")
        .description("Today’s training.")
        .supportedFamilies([.accessoryRectangular, .accessoryInline, .accessoryCircular, .accessoryCorner])
    }
}

struct ComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TodayEntry

    private var title: String { entry.today?.title ?? "Open on iPhone" }
    private var symbol: String { DayCards.symbol(entry.today?.kind) }

    var body: some View {
        switch family {
        case .accessoryInline:
            Label(title, systemImage: symbol)
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: symbol)
                    .font(.title3)
            }
            .accessibilityLabel(title)
        case .accessoryCorner:
            Image(systemName: symbol)
                .font(.title3)
                .widgetLabel(title)
        default:
            VStack(alignment: .leading, spacing: 1) {
                Label("Today", systemImage: symbol)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(title)
                    .font(.headline)
                    .lineLimit(1)
                if let detail = entry.today?.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
