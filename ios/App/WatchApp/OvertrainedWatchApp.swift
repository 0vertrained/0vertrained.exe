import SwiftUI

/// 0VERTRAINED on Apple Watch: the day's lifts from the phone, one set at a
/// time, with the workout tracked in Health, and the day's runs, which open
/// in the Workout app. The phone stays the one place the log is written; the
/// watch sends it each set it logs.
@main
struct OvertrainedWatchApp: App {
    @StateObject private var store = SessionStore.shared
    @StateObject private var workout = WorkoutManager()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                TodayView()
            }
            .environmentObject(store)
            .environmentObject(workout)
            .tint(Ledger.ink)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { store.refreshDay() }
        }
    }
}
