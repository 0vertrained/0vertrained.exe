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

    private let journalKey = "ovt.watch.inbox.v2"
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
    func pendingPayload(owner: String?) -> [String: Any] {
        queue.sync {
            let accounts = partitions(for: owner)
            return ["events": accounts.flatMap { readInbox(owner: $0).events }, "acceptLegacy": accounts.contains(nil)]
        }
    }

    // Old watch apps omitted the athlete ID. Keep those events with the first
    // account that claims this pairing, including across iPhone relaunches.
    private func partitions(for owner: String?) -> [String?] {
        let key = journalKey + ".legacyOwner"
        guard let owner else { return UserDefaults.standard.string(forKey: key) == nil ? [nil] : [] }
        if UserDefaults.standard.string(forKey: key) == nil { UserDefaults.standard.set(owner, forKey: key) }
        return UserDefaults.standard.string(forKey: key) == owner ? [nil, owner] : [owner]
    }

    func acknowledge(ids: Set<String>, owner: String?) {
        queue.sync {
            for partition in partitions(for: owner) {
                var inbox = readInbox(owner: partition)
                let accepted = Set(inbox.events.compactMap(WatchInbox.id)).intersection(ids)
                guard !accepted.isEmpty else { continue }
                inbox.confirm(accepted)
                writeInbox(inbox, owner: partition)
                sendReceipts(Array(accepted), owner: partition)
            }
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
            if week.count > 50_000 {
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("week-" + UUID().uuidString)
                try week.write(to: url, options: .atomic)
                session.transferFile(url, metadata: ["week": true])
                try session.updateApplicationContext(["journalVersion": 1])
            } else {
                try session.updateApplicationContext(["week": week, "journalVersion": 1])
            }
            unsentPlan = nil
        } catch {
            // Kept, and tried again when the watch's state changes or the
            // next plan comes.
        }
    }

    private func inboxKey(_ owner: String?) -> String { owner.map { journalKey + ".athlete." + $0 } ?? journalKey }

    private func readInbox(owner: String?) -> WatchInbox {
        if let data = UserDefaults.standard.data(forKey: inboxKey(owner)),
           let inbox = try? JSONDecoder().decode(WatchInbox.self, from: data) { return inbox }
        guard owner == nil else { return WatchInbox() }
        return WatchInbox(events: UserDefaults.standard.stringArray(forKey: "ovt.watch.inbox") ?? [])
    }

    private func writeInbox(_ inbox: WatchInbox, owner: String?) {
        if let data = try? JSONEncoder().encode(inbox) { UserDefaults.standard.set(data, forKey: inboxKey(owner)) }
    }

    private func sendReceipts(_ ids: [String], owner: String?) {
        guard !ids.isEmpty, WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
        var message: [String: Any] = ["receipts": ids]
        message["owner"] = owner
        WCSession.default.transferUserInfo(message)
    }

    /// The week's JSON, zlib-compressed: the watch unpacks it the same way.
    private static func pack(_ json: String) -> Data? {
        guard let compressed = try? (Data(json.utf8) as NSData).compressed(using: .zlib) else { return nil }
        return compressed as Data
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
        let events = userInfo["events"] as? [String] ?? (userInfo["event"] as? String).map { [$0] } ?? []
        receiveBatch(events)
    }

    func session(_ session: WCSession, didFinish fileTransfer: WCSessionFileTransfer, error: Error?) {
        try? FileManager.default.removeItem(at: fileTransfer.file.fileURL)
    }

    func session(_ session: WCSession, didReceive file: WCSessionFile) {
        guard file.metadata?["batchID"] != nil, let data = try? Data(contentsOf: file.fileURL),
              let events = try? JSONDecoder().decode([String].self, from: data) else { return }
        receiveBatch(events)
    }

    private func receiveBatch(_ events: [String]) {
        guard !events.isEmpty else { return }
        queue.async {
            for (owner, batch) in Dictionary(grouping: events, by: WatchInbox.owner) {
                var inbox = self.readInbox(owner: owner)
                let alreadySaved = inbox.receive(batch)
                self.writeInbox(inbox, owner: owner)
                self.sendReceipts(alreadySaved, owner: owner)
            }
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: WatchLink.inboxChanged, object: nil)
            }
        }
    }
}
