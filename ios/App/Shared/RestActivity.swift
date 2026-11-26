import ActivityKit
import Foundation

/// The rest timer the session runner shows on the Lock Screen and in the
/// Dynamic Island. The app starts it and moves it on
/// (App/RestActivityController.swift); the RestActivity extension draws it.
@available(iOS 16.1, *)
struct RestActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// The timer counts down from the start of the rest to its end.
        var startedAt: Date
        var endsAt: Date
        /// What's next, as the runner words it.
        var next: String
    }
}
