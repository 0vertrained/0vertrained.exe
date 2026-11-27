import UIKit
import Capacitor

/// Haptics, keeping the screen on during a session, and reloading the site
/// from the offline page. The page reaches it as Capacitor.Plugins.OTDevice.
@objc(DevicePlugin)
public class DevicePlugin: CAPPlugin, CAPBridgedPlugin {
    private var activationObserver: NSObjectProtocol?

    override public func load() {
        activationObserver = NotificationCenter.default.addObserver(forName: UIScene.didActivateNotification,
                                                                     object: nil, queue: .main) { [weak self] note in
            guard let self, let scene = note.object as? UIWindowScene,
                  self.bridge?.viewController?.viewIfLoaded?.window?.windowScene === scene else { return }
            self.notifyListeners("foreground", data: [:])
        }
    }

    deinit {
        if let activationObserver { NotificationCenter.default.removeObserver(activationObserver) }
    }

    public let identifier = "DevicePlugin"
    public let jsName = "OTDevice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "haptic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAwake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "retry", returnType: CAPPluginReturnPromise)
    ]

    /// kind: "tap" for a logged set, "done" for the end of a rest,
    /// "error" when a set can't be logged, "select" when a control changes.
    @objc func haptic(_ call: CAPPluginCall) {
        let kind = call.getString("kind") ?? "tap"
        DispatchQueue.main.async {
            switch kind {
            case "done":
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "error":
                UINotificationFeedbackGenerator().notificationOccurred(.error)
            case "select":
                // A control changed: the light tick iOS gives pickers.
                UISelectionFeedbackGenerator().selectionChanged()
            default:
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            }
            call.resolve()
        }
    }

    @objc func keepAwake(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve()
        }
    }

    /// Loads the site again. The offline page calls this from its button and
    /// when the connection comes back.
    @objc func retry(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let bridge = self.bridge, let webView = bridge.webView else {
                call.reject("The app isn't ready yet.")
                return
            }
            webView.load(URLRequest(url: bridge.config.appStartServerURL))
            call.resolve()
        }
    }
}
