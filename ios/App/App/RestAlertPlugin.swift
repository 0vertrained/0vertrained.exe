import Foundation
import UserNotifications
import Capacitor

/// A local notification at the end of a rest. The page's own timer stops
/// when the phone locks; this one doesn't. While the app is open the page's
/// timer and haptic do the job, and iOS doesn't show the notification.
/// The same rest also shows as a timer on the Lock Screen and in the Dynamic
/// Island (showTimer, hideTimer).
@objc(RestAlertPlugin)
public class RestAlertPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RestAlertPlugin"
    public let jsName = "OTRestAlert"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showTimer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hideTimer", returnType: CAPPluginReturnPromise)
    ]

    private static let requestId = "ovt.rest"

    /// seconds: time left in the rest. title and body: the notification text.
    /// Asks for notification permission the first time a rest starts.
    @objc func schedule(_ call: CAPPluginCall) {
        let seconds = call.getDouble("seconds") ?? 0
        guard seconds >= 1 else {
            Self.clear()
            call.resolve(["scheduled": false])
            return
        }
        let title = call.getString("title") ?? "Rest over"
        let body = call.getString("body") ?? "Time for your next set."
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else {
                call.resolve(["scheduled": false])
                return
            }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false)
            let request = UNNotificationRequest(identifier: Self.requestId, content: content, trigger: trigger)
            // Adding a request with the same identifier replaces the old one.
            center.add(request) { error in
                if let error = error {
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve(["scheduled": true])
                }
            }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        Self.clear()
        call.resolve()
    }

    /// seconds: time left in the rest. next: what comes after it.
    @objc func showTimer(_ call: CAPPluginCall) {
        let seconds = call.getDouble("seconds") ?? 0
        let next = call.getString("next") ?? ""
        DispatchQueue.main.async {
            RestActivityController.show(seconds: seconds, next: next)
            call.resolve()
        }
    }

    @objc func hideTimer(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            RestActivityController.end()
            call.resolve()
        }
    }

    private static func clear() {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [requestId])
        center.removeDeliveredNotifications(withIdentifiers: [requestId])
    }
}
