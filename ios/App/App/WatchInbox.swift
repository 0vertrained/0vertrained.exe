import Foundation

struct WatchInbox: Codable {
    var events: [String] = []
    var receipts: [String] = []

    static func id(_ json: String) -> String? {
        (try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])?["id"] as? String
    }

    static func owner(_ json: String) -> String? {
        (try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])?["owner"] as? String
    }

    mutating func receive(_ batch: [String]) -> [String] {
        let confirmed = Set(receipts)
        var waiting = Set(events.compactMap(Self.id))
        var repeatReceipts = [String]()
        for event in batch {
            guard let id = Self.id(event) else { continue }
            if confirmed.contains(id) { repeatReceipts.append(id) }
            else if waiting.insert(id).inserted { events.append(event) }
        }
        return repeatReceipts
    }

    mutating func confirm(_ ids: Set<String>) {
        let accepted = events.compactMap(Self.id).filter(ids.contains)
        events.removeAll { Self.id($0).map(ids.contains) ?? true }
        receipts = Array((receipts + accepted).suffix(4096))
    }
}
