import SwiftUI
import WatchKit

final class WatchWorkoutDelegate: NSObject, WKApplicationDelegate {
    func handleActiveWorkoutRecovery() {
        DispatchQueue.main.async { WorkoutManager.shared.recover() }
    }
}

/// 0VERTRAINED on Apple Watch: the day's lifts from the phone, one set at a
/// time, with the workout tracked in Health, and the day's runs, which open
/// in the Workout app. The phone stays the one place the log is written; the
/// watch sends it each set it logs. On Apple Watch Ultra the Action button
/// can start the day's lifting (StartLiftIntent), and on watches with double
/// tap, pinching twice presses the screen's main button.
@main
struct OvertrainedWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchWorkoutDelegate.self) private var delegate
    @StateObject private var store = SessionStore.shared
    @StateObject private var workout = WorkoutManager.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                TodayView()
            }
            .id(store.athleteOwner)
            .environmentObject(store)
            .environmentObject(workout)
            .tint(Ledger.ink)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                store.refreshDay()
                if store.activeLift?.healthStartedAt != nil || store.rehearsalAttempt != nil || CardioWorkoutManager.shared.hasSavedRecord {
                    workout.recover()
                }
            }
        }
    }
}
