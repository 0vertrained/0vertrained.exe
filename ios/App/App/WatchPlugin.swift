import Foundation
import Capacitor
import WatchConnectivity

/// The page's side of the watch connection: send the week's plans, read the
/// sets logged on the watch, and confirm them once they're in the log. A
/// "watchEvent" goes to the page whenever new ones arrive.
@objc(WatchPlugin)
public class WatchPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WatchPlugin"
    public let jsName = "OTWatch"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "climbInvite", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "climbCue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "climbClose", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendPlan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "mirrorStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "mirrorCommand", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise)
    ]

    private var observer: NSObjectProtocol?

    private var mirrorObserver: NSObjectProtocol?

    override public func load() {
        if #available(iOS 17.0, *) {
            mirrorObserver = NotificationCenter.default.addObserver(forName: PhoneLiftMirror.changed, object: nil, queue: .main) { [weak self] _ in
                self?.notifyListeners("liftMirrorChanged", data: [:])
            }
        }
        observer = NotificationCenter.default.addObserver(forName: WatchLink.inboxChanged, object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("watchEvent", data: [:])
        }
    }

    deinit {
        if let mirrorObserver { NotificationCenter.default.removeObserver(mirrorObserver) }
        if let observer = observer {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    @objc func climbInvite(_ call: CAPPluginCall) { sendClimb(call, action: "invite") }
    @objc func climbCue(_ call: CAPPluginCall) { sendClimb(call, action: "cue") }
    @objc func climbClose(_ call: CAPPluginCall) { sendClimb(call, action: "close") }

    private func sendClimb(_ call: CAPPluginCall, action: String) {
        guard let owner = call.getString("owner"), !owner.isEmpty, let id = call.getString("recordingId"), UUID(uuidString: id) != nil,
              WCSession.isSupported(), WCSession.default.activationState == .activated, WCSession.default.isReachable else {
            call.reject("Open 0vertrained on your paired Watch and try again.")
            return
        }
        var message: [String: Any] = ["climbAction": action, "owner": owner, "recordingId": id, "issuedAt": Date().timeIntervalSince1970]
        for field in ["name", "date", "landmark"] { if let text = call.getString(field) { message[field] = String(text.prefix(120)) } }
        for field in ["remaining", "grade", "gap"] { if let number = call.getDouble(field), number.isFinite { message[field] = number } }
        WCSession.default.sendMessage(message, replyHandler: { reply in
            if reply["accepted"] as? Bool == true { call.resolve() }
            else { call.reject("Check the athlete and active workout on your Watch.") }
        }, errorHandler: { _ in call.reject("Watch disconnected. Open the Watch app to reconnect.") })
    }

    @objc func sendPlan(_ call: CAPPluginCall) {
        guard let plan = call.getString("plan"), !plan.isEmpty else {
            call.reject("No plan to send.")
            return
        }
        WatchLink.shared.sendPlan(plan)
        call.resolve()
    }

    @objc func pending(_ call: CAPPluginCall) {
        call.resolve(WatchLink.shared.pendingPayload(owner: call.getString("owner")))
    }

    @objc func ack(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        WatchLink.shared.acknowledge(ids: Set(ids), owner: call.getString("owner"))
        call.resolve()
    }

    @objc func mirrorStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard #available(iOS 17.0, *), let owner = call.getString("owner") else { call.resolve(); return }
            call.resolve(PhoneLiftMirror.shared.status(owner: owner))
        }
    }

    @objc func mirrorCommand(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard #available(iOS 17.0, *), let owner = call.getString("owner"),
                  let raw = call.getString("payload"), raw.utf8.count <= 16_384,
                  let request = try? JSONDecoder().decode(LiftMirrorCommand.self, from: Data(raw.utf8)) else {
                call.reject("Invalid Watch command.")
                return
            }
            PhoneLiftMirror.shared.command(request, owner: owner) { error in
                if let error { call.reject(error) } else { call.resolve() }
            }
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(WatchLink.shared.status())
    }
}
