import ActivityKit
import SwiftUI
import WidgetKit

/// The rest timer while the session runner rests between sets: on the Lock
/// Screen, and in the Dynamic Island while the app isn't on screen. The app
/// starts and ends it (App/RestActivityController.swift). Today's training
/// for the Home and Lock Screen lives here too (TodayWidget.swift).
@main
struct RestActivityBundle: WidgetBundle {
    var body: some Widget {
        RestActivityWidget()
        TodayWidget()
    }
}

/// The watch app's Ledger colours: paper on a near-black ground.
private enum Palette {
    static let paper = Color(red: 0.945, green: 0.933, blue: 0.906)
    static let muted = Color(red: 0.725, green: 0.706, blue: 0.667)
    static let ground = Color(red: 0.114, green: 0.110, blue: 0.102)
}

struct RestActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RestActivityAttributes.self) { context in
            RestLockScreenView(state: context.state, over: context.isStale)
                .activityBackgroundTint(Palette.ground)
                .activitySystemActionForegroundColor(Palette.paper)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.isStale ? "Rest over" : "Rest", systemImage: "timer")
                        .font(.headline)
                        .foregroundStyle(Palette.paper)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    RestClock(state: context.state, over: context.isStale)
                        .font(.title2.monospacedDigit().weight(.semibold))
                        .foregroundStyle(Palette.paper)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.state.next)
                        .font(.subheadline)
                        .foregroundStyle(Palette.muted)
                        .lineLimit(1)
                }
            } compactLeading: {
                Image(systemName: "timer")
                    .foregroundStyle(Palette.paper)
            } compactTrailing: {
                RestClock(state: context.state, over: context.isStale)
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .foregroundStyle(Palette.paper)
                    .frame(maxWidth: 44)
            } minimal: {
                Image(systemName: "timer")
                    .foregroundStyle(Palette.paper)
            }
        }
    }
}

/// Counts down to the end of the rest, then says it's over.
struct RestClock: View {
    let state: RestActivityAttributes.ContentState
    let over: Bool

    var body: some View {
        if over || state.endsAt <= state.startedAt {
            Text("Over")
        } else {
            Text(timerInterval: state.startedAt...state.endsAt, countsDown: true)
                .multilineTextAlignment(.trailing)
        }
    }
}

struct RestLockScreenView: View {
    let state: RestActivityAttributes.ContentState
    let over: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(over ? "Rest over" : "Rest")
                    .font(.headline)
                    .fontDesign(.serif)
                    .foregroundStyle(Palette.paper)
                if !state.next.isEmpty {
                    Text(state.next)
                        .font(.subheadline)
                        .foregroundStyle(Palette.muted)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            if !over && state.endsAt > state.startedAt {
                Text(timerInterval: state.startedAt...state.endsAt, countsDown: true)
                    .font(.system(size: 40, weight: .semibold, design: .monospaced))
                    .monospacedDigit()
                    .foregroundStyle(Palette.paper)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 150, alignment: .trailing)
            }
        }
        .padding(16)
    }
}
