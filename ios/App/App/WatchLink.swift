import Foundation
import WatchConnectivity

/// The phone's end of the watch connection.
///
/// It starts at launch, before the page loads, so sets logged on the watch
/// are kept even when they arrive with the app in the background. They wait
/// in UserDefaults until the page has written them into the log and confirms
/// them (src/watch/useWatchBridge.js). The week's plans go the other way as
/// the application context, which holds only the latest copy, compressed so
/// a full week fits.
final class WatchLink: NSObject {
    static let shared = WatchLink()
    static let inboxChanged = Notification.Name("ovt.watchInboxChanged")

    private let inboxKey = "ovt.watch.inbox"
    private let queue = DispatchQueue(label: "ovt.watch.link")
    /// The newest week of plans, until the watch can take it.
    private var unsentPlan: String?

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func sendPlan(_ json: String) {
        queue.async {
            self.unsentPlan = json
            self.flushPlan()
        }
    }

    /// The events waiting, oldest first, each as the JSON the watch sent.
    func pendingEvents() -> [String] {
        queue.sync { readInbox() }
    }

    /// Removes the events the page has dealt with, and any it can't read.
    func acknowledge(ids: Set<String>) {
        queue.sync {
            let kept = readInbox().filter { event in
                guard let id = Self.eventId(event) else { return false }
                return !ids.contains(id)
            }
            writeInbox(kept)
        }
    }

    func status() -> [String: Any] {
        guard WCSession.isSupported() else {
            return ["supported": false, "paired": false, "installed": false, "reachable": false]
        }
        let session = WCSession.default
        let active = session.activationState == .activated
        return [
            "supported": true,
            "paired": active && session.isPaired,
            "installed": active && session.isWatchAppInstalled,
            "reachable": active && session.isReachable
        ]
    }

    private func flushPlan() {
        guard let json = unsentPlan, WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
        guard let week = Self.pack(json) else {
            unsentPlan = nil
            return
        }
        do {
            try session.updateApplicationContext(["week": week])
            unsentPlan = nil
        } catch {
            // Kept, and tried again when the watch's state changes or the
            // next plan comes.
        }
    }

    private func readInbox() -> [String] {
        UserDefaults.standard.stringArray(forKey: inboxKey) ?? []
    }

    private func writeInbox(_ inbox: [String]) {
        UserDefaults.standard.set(inbox, forKey: inboxKey)
    }

    /// The week's JSON, zlib-compressed: the watch unpacks it the same way.
    private static func pack(_ json: String) -> Data? {
        guard let compressed = try? (Data(json.utf8) as NSData).compressed(using: .zlib) else { return nil }
        return compressed as Data
    }

    private static func eventId(_ json: String) -> String? {
        guard let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return object["id"] as? String
    }
}

extension WatchLink: WCSessionDelegate {
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        queue.async { self.flushPlan() }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        // Another watch was paired: start again with it.
        WCSession.default.activate()
    }

    func sessionWatchStateDidChange(_ session: WCSession) {
        queue.async { self.flushPlan() }
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        guard let event = userInfo["event"] as? String else { return }
        queue.async {
            var inbox = self.readInbox()
            inbox.append(event)
            self.writeInbox(inbox)
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: WatchLink.inboxChanged, object: nil)
            }
        }
    }
}
