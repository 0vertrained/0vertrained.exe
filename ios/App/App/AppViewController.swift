import UIKit
import WebKit
import Capacitor

/// The web view the app runs in. It registers the app's own plugins, which
/// live in this target rather than in npm packages so the project builds in
/// Xcode without Node.
class AppViewController: CAPBridgeViewController {
    /// The narrowest page the screens are laid out for, in CSS pixels.
    private static let narrowestPage: CGFloat = 320
    /// The most a larger text size enlarges the page.
    private static let largestZoom: CGFloat = 1.35

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(DevicePlugin())
        bridge?.registerPluginInstance(RestAlertPlugin())
        bridge?.registerPluginInstance(WatchPlugin())
        bridge?.registerPluginInstance(RunsPlugin())

        // Until the page paints, show the launch colour for the phone's
        // appearance, so a dark launch doesn't flash white.
        let launch = UIColor(named: "LaunchBackground") ?? .systemBackground
        webView?.backgroundColor = launch
        webView?.scrollView.backgroundColor = launch

        // Pages bounce at their ends, as lists do in iOS apps. Capacitor turns
        // this off; the page allows it inside the app (html.native-app).
        webView?.scrollView.bounces = true
        webView?.scrollView.alwaysBounceVertical = true

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(textSizeChanged),
            name: UIContentSizeCategory.didChangeNotification,
            object: nil
        )
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        applyTextSize()
    }

    @objc private func textSizeChanged() {
        applyTextSize()
    }

    /// A larger text size in Settings enlarges the page, as it enlarges the
    /// text in iOS apps. Smaller sizes leave the page as designed, and the
    /// page never gets narrower than the screens are laid out for.
    private func applyTextSize() {
        guard let webView, view.bounds.width > 0 else { return }
        let zoom = Self.pageZoom(
            for: UIApplication.shared.preferredContentSizeCategory,
            width: view.bounds.width
        )
        if abs(webView.pageZoom - zoom) > 0.001 {
            webView.pageZoom = zoom
        }
    }

    /// Body text at the default size is 17 points; the page is enlarged by
    /// the same ratio as body text at this size, within the limits above.
    static func pageZoom(for category: UIContentSizeCategory, width: CGFloat) -> CGFloat {
        let traits = UITraitCollection(preferredContentSizeCategory: category)
        let body = UIFont.preferredFont(forTextStyle: .body, compatibleWith: traits).pointSize
        let fits = width / narrowestPage
        return max(1, min(body / 17, largestZoom, fits))
    }
}
