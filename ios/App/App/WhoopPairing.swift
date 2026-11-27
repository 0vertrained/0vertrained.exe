import Foundation

struct WhoopPairing: Codable, Equatable {
    let id: UUID
    var name: String
    var reconnect: Bool

    func automaticTarget(foreground: Bool, authorized: Bool) -> UUID? {
        reconnect && foreground && authorized ? id : nil
    }
}

/// Only an explicitly selected strap that completed a connection is stored.
/// An auth transition drops the live link; each athlete keeps their own choice.
struct WhoopPairings {
    let defaults: UserDefaults
    private let legacyKey = "ot.whoopBluetooth.selected.v1"

    private func key(_ owner: String) -> String { "ot.whoopBluetooth.pairing.v2." + owner }

    func load(owner: String) -> WhoopPairing? {
        if let data = defaults.data(forKey: key(owner)) {
            return try? JSONDecoder().decode(WhoopPairing.self, from: data)
        }
        guard let old = defaults.dictionary(forKey: legacyKey) as? [String: String],
              old["owner"] == owner, let text = old["id"], let id = UUID(uuidString: text) else { return nil }
        let pairing = WhoopPairing(id: id, name: old["name"] ?? "WHOOP", reconnect: true)
        save(pairing, owner: owner)
        defaults.removeObject(forKey: legacyKey)
        return pairing
    }

    func save(_ pairing: WhoopPairing?, owner: String) {
        if let pairing, let data = try? JSONEncoder().encode(pairing) {
            defaults.set(data, forKey: key(owner))
        } else {
            defaults.removeObject(forKey: key(owner))
        }
        if defaults.dictionary(forKey: legacyKey)?["owner"] as? String == owner {
            defaults.removeObject(forKey: legacyKey)
        }
    }

    static func historyDue(now: Int64, lastCompleted: Int64?) -> Bool {
        guard let lastCompleted, lastCompleted <= now else { return true }
        return now - lastCompleted >= 5 * 60 * 1000
    }

    static func retryDelay(failures: Int) -> TimeInterval {
        [3, 8, 20, 45, 90][min(4, max(0, failures))]
    }
}
