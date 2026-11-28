import Foundation
import UserNotifications
import Capacitor

/// Reminders the phone schedules itself, repeating at fixed times: the
/// Courier's evening check-in and Sunday Edition. The web's push
/// notifications don't reach the app, so the page says which reminders are
/// on and when (src/reminders/localReminders.js), and this replaces whatever
/// was scheduled before.
@objc(RemindersPlugin)
public class RemindersPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RemindersPlugin"
    public let jsName = "OTReminders"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise)
    ]

    private static let prefix = "ovt.reminder."

    private struct Reminder: Decodable {
        var id: String
        var title: String
        var body: String?
        var hour: Int
        var minute: Int?
        /// 1 is Sunday. Without one, the reminder is daily.
        var weekday: Int?
    }

    /// reminders: a JSON array of { id, title, body, hour, minute, weekday }.
    /// Resolves { allowed }: false when there were reminders to set and iOS
    /// doesn't allow the app's notifications.
    @objc func set(_ call: CAPPluginCall) {
        let text = call.getString("reminders") ?? "[]"
        guard let reminders = try? JSONDecoder().decode([Reminder].self, from: Data(text.utf8)) else {
            call.reject("Invalid reminder list")
            return
        }
        let requests = reminders.map(Self.request)
        let clearDelivered = call.getBool("clearDelivered") == true
        let center = UNUserNotificationCenter.current()
        Task {
            let pending = await center.pendingNotificationRequests()
            let ours = pending.map(\.identifier).filter { $0.hasPrefix(Self.prefix) }
            center.removePendingNotificationRequests(withIdentifiers: ours)
            if clearDelivered {
                let delivered = await center.deliveredNotifications()
                let ids = delivered.map { $0.request.identifier }.filter { $0.hasPrefix(Self.prefix) }
                center.removeDeliveredNotifications(withIdentifiers: ids)
            }
            guard !requests.isEmpty else {
                call.resolve(["allowed": true, "deliveredCleared": clearDelivered])
                return
            }
            do {
                guard try await center.requestAuthorization(options: [.alert, .sound]) else {
                    call.resolve(["allowed": false])
                    return
                }
                for request in requests { try await center.add(request) }
                call.resolve(["allowed": true])
            } catch {
                center.removePendingNotificationRequests(withIdentifiers: requests.map(\.identifier))
                call.reject("Could not schedule reminders")
            }
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            call.resolve(["denied": settings.authorizationStatus == .denied])
        }
    }

    private static func request(_ reminder: Reminder) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = reminder.title
        content.body = reminder.body ?? ""
        content.sound = .default
        var when = DateComponents()
        when.hour = reminder.hour
        when.minute = reminder.minute ?? 0
        when.weekday = reminder.weekday
        let trigger = UNCalendarNotificationTrigger(dateMatching: when, repeats: true)
        return UNNotificationRequest(identifier: prefix + reminder.id, content: content, trigger: trigger)
    }
}
