import SwiftUI
import WidgetKit

/// Today's training on the Home Screen and the Lock Screen, with tomorrow
/// beside it on the larger sizes. The app saves the week's cards whenever
/// the plan changes (App/WidgetPlugin.swift); each shows from its midnight.
struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "OvertrainedToday", provider: TodayProvider()) { entry in
            TodayWidgetView(entry: entry)
        }
        .configurationDisplayName("Today")
        .description("Today’s training, and what’s tomorrow.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

/// The app's Ledger colours: paper on a near-black ground.
private enum TodayPalette {
    static let paper = Color(red: 0.945, green: 0.933, blue: 0.906)
    static let muted = Color(red: 0.725, green: 0.706, blue: 0.667)
    static let ground = Color(red: 0.114, green: 0.110, blue: 0.102)
}

private extension View {
    /// The widget's background; iOS 17 asks for it as a container background.
    @ViewBuilder
    func todayBackground(_ color: Color) -> some View {
        if #available(iOS 17.0, *) {
            containerBackground(color, for: .widget)
        } else {
            background(color)
        }
    }
}

struct TodayWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TodayEntry

    private var title: String { entry.today?.title ?? "Open 0VERTRAINED" }
    private var detail: String {
        guard let today = entry.today else { return "Your plan shows here once the app has opened today." }
        return today.detail
    }

    var body: some View {
        switch family {
        case .accessoryInline:
            Label(title, systemImage: DayCards.symbol(entry.today?.kind))
                .todayBackground(.clear)
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Label("Today", systemImage: DayCards.symbol(entry.today?.kind))
                    .font(.caption2)
                Text(title)
                    .font(.headline)
                    .lineLimit(1)
                if !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .todayBackground(.clear)
        default:
            VStack(alignment: .leading, spacing: 4) {
                Label("Today", systemImage: DayCards.symbol(entry.today?.kind))
                    .font(.caption)
                    .foregroundStyle(TodayPalette.muted)
                Text(title)
                    .font(.headline)
                    .fontDesign(.serif)
                    .foregroundStyle(TodayPalette.paper)
                    .lineLimit(family == .systemSmall ? 3 : 2)
                if !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(TodayPalette.muted)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
                if let next = entry.next {
                    Text("Tomorrow: \(next.title)")
                        .font(.caption2)
                        .foregroundStyle(TodayPalette.muted)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .todayBackground(TodayPalette.ground)
        }
    }
}
