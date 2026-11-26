import UIKit
import Capacitor

/// The web view the app runs in. It registers the app's own plugins, which
/// live in this target rather than in npm packages so the project builds in
/// Xcode without Node.
class AppViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(DevicePlugin())
        bridge?.registerPluginInstance(RestAlertPlugin())

        // Until the page paints, show the launch colour for the phone's
        // appearance, so a dark launch doesn't flash white.
        let launch = UIColor(named: "LaunchBackground") ?? .systemBackground
        webView?.backgroundColor = launch
        webView?.scrollView.backgroundColor = launch
    }
}
