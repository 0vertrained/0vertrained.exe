import Foundation

/// A day of the plan at a glance, for the widgets: the Home and Lock Screen
/// widget on the iPhone and the complication on the watch. The iPhone app
/// writes the week's cards from the page (App/WidgetPlugin.swift), the watch
/// app from the week the phone sends it (WatchApp/SessionStore.swift), and
/// the widgets read them from the app group they share.
struct DayCard: Codable, Equatable {
    /// "2026-11-26", in the device's time zone.
    var date: String
    /// "Upper B — Pull + Biceps", or "Rest day".
    var title: String
    /// "8 exercises · Easy Run, 30 min"; empty on a rest day.
    var detail: String
    /// "lift", "run", "both" or "rest", for the symbol beside it.
    var kind: String?
}

enum DayCards {
    private static let key = "ovt.dayCards"

    /// The container the app and its widgets share, named in Info.plist
    /// (OTAppGroup). Nil when the build has no app group.
    static var defaults: UserDefaults? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "OTAppGroup") as? String,
              group.hasPrefix("group.") else { return nil }
        return UserDefaults(suiteName: group)
    }

    static func load() -> [DayCard] {
        guard let data = defaults?.data(forKey: key),
              let cards = try? JSONDecoder().decode([DayCard].self, from: data) else { return [] }
        return cards
    }

    /// Saves the cards. False when they're unchanged or can't be shared.
    @discardableResult
    static func save(_ cards: [DayCard]) -> Bool {
        guard let defaults, let data = try? JSONEncoder().encode(cards) else { return false }
        if defaults.data(forKey: key) == data { return false }
        defaults.set(data, forKey: key)
        return true
    }

    /// "2026-11-26" for a date in the device's time zone.
    static func dateKey(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// Midnight at the start of a card's day.
    static func startOfDay(_ key: String) -> Date? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    /// The SF Symbol for a day's kind of training.
    static func symbol(_ kind: String?) -> String {
        switch kind {
        case "run": return "figure.run"
        case "rest": return "bed.double.fill"
        default: return "dumbbell.fill"
        }
    }
}
