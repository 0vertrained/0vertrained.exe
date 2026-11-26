import SwiftUI

/// 0VERTRAINED on Apple Watch: today's lifts from the phone, one set at a
/// time, with the workout tracked in Health. The phone stays the one place
/// the log is written; the watch sends it each set it logs.
@main
struct OvertrainedWatchApp: App {
    @StateObject private var store = SessionStore.shared
    @StateObject private var workout = WorkoutManager()

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                TodayView()
            }
            .environmentObject(store)
            .environmentObject(workout)
            .tint(Ledger.ink)
        }
    }
}
