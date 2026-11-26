import ActivityKit
import Foundation

/// Starts, moves on and ends the Lock Screen rest timer. There's only ever
/// one: a new rest moves the current timer on rather than adding another.
/// When a rest runs out with the phone locked, the timer turns to "Rest
/// over" by itself, and goes when the app next ends it.
enum RestActivityController {
    static func show(seconds: Double, next: String) {
        guard #available(iOS 16.2, *) else { return }
        guard seconds >= 1, ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let now = Date()
        let state = RestActivityAttributes.ContentState(startedAt: now, endsAt: now.addingTimeInterval(seconds), next: next)
        let content = ActivityContent(state: state, staleDate: state.endsAt)
        if let current = Activity<RestActivityAttributes>.activities.first {
            Task { await current.update(content) }
            return
        }
        do {
            _ = try Activity.request(attributes: RestActivityAttributes(), content: content, pushType: nil)
        } catch {
            // Live Activities are off for the app; the rest-over notification
            // still comes.
        }
    }

    static func end() {
        guard #available(iOS 16.2, *) else { return }
        for activity in Activity<RestActivityAttributes>.activities {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
    }
}
