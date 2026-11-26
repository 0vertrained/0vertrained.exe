import Foundation
import WidgetKit
import Capacitor

/// The week's plan at a glance for the Home and Lock Screen widget. The page
/// works out each day's card when the plan changes (src/widgets/
/// useWidgetCards.js) and sends them here; the widget reads them from the
/// app group (Shared/DayCards.swift).
@objc(WidgetPlugin)
public class WidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetPlugin"
    public let jsName = "OTWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise)
    ]

    /// cards: a JSON array of { date, title, detail, kind }, today first.
    /// Resolves { shared, changed }: whether the widget can read them, and
    /// whether they differed from what it had.
    @objc func update(_ call: CAPPluginCall) {
        guard let text = call.getString("cards"),
              let data = text.data(using: .utf8),
              let cards = try? JSONDecoder().decode([DayCard].self, from: data) else {
            call.reject("No cards to show.")
            return
        }
        let changed = DayCards.save(cards)
        if changed {
            WidgetCenter.shared.reloadAllTimelines()
        }
        call.resolve(["shared": DayCards.defaults != nil, "changed": changed])
    }
}
