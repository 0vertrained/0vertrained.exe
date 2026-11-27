import Foundation
import Capacitor

/// The page's side of the watch connection: send the week's plans, read the
/// sets logged on the watch, and confirm them once they're in the log. A
/// "watchEvent" goes to the page whenever new ones arrive.
@objc(WatchPlugin)
public class WatchPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WatchPlugin"
    public let jsName = "OTWatch"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sendPlan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise)
    ]

    private var observer: NSObjectProtocol?

    override public func load() {
        observer = NotificationCenter.default.addObserver(forName: WatchLink.inboxChanged, object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("watchEvent", data: [:])
        }
    }

    deinit {
        if let observer = observer {
            NotificationCenter.default.removeObserver(observer)
        }
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

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(WatchLink.shared.status())
    }
}
