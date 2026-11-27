import Foundation

@main
struct WhoopPairingTests {
    static func main() {
        let suite = "whoop-pairing-test-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = WhoopPairings(defaults: defaults)
        let id = UUID()
        let legacy = "ot.whoopBluetooth.selected.v1"
        defaults.set(["owner": "A", "id": id.uuidString, "name": "A strap"], forKey: legacy)
        precondition(store.load(owner: "B") == nil)
        precondition(defaults.object(forKey: legacy) != nil)
        guard var a = store.load(owner: "A") else { preconditionFailure("Existing pairing lost") }
        precondition(a.id == id && a.reconnect && defaults.object(forKey: legacy) == nil)
        precondition(a.automaticTarget(foreground: true, authorized: true) == id)
        precondition(a.automaticTarget(foreground: false, authorized: true) == nil)
        precondition(a.automaticTarget(foreground: true, authorized: false) == nil)
        let b = WhoopPairing(id: UUID(), name: "B strap", reconnect: true)
        store.save(b, owner: "B")
        a.reconnect = false
        store.save(a, owner: "A")
        let reopened = WhoopPairings(defaults: UserDefaults(suiteName: suite)!)
        precondition(reopened.load(owner: "A") == a)
        precondition(reopened.load(owner: "A")?.automaticTarget(foreground: true, authorized: true) == nil)
        precondition(reopened.load(owner: "B") == b)
        a.reconnect = true
        reopened.save(a, owner: "A")
        precondition(store.load(owner: "A")?.reconnect == true)
        reopened.save(nil, owner: "A")
        precondition(store.load(owner: "A") == nil && store.load(owner: "B") == b)
        precondition(WhoopPairings.historyDue(now: 400_000, lastCompleted: nil))
        precondition(WhoopPairings.historyDue(now: 400_000, lastCompleted: 1_000))
        precondition(!WhoopPairings.historyDue(now: 400_000, lastCompleted: 350_000))
        precondition(WhoopPairings.retryDelay(failures: 0) == 3 && WhoopPairings.retryDelay(failures: 99) == 90)
        print("WHOOP saved pairing migration, account isolation, reconnect preferences and refresh cadence passed")
    }
}
