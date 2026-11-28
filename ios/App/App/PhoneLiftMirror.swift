import Foundation
import HealthKit

/// HealthKit can wake the companion before the WebView exists. Buffer only the
/// latest state in memory and expose it to the matching signed-in athlete.
@available(iOS 17.0, *)
final class PhoneLiftMirror: NSObject, HKWorkoutSessionDelegate {
    static let shared = PhoneLiftMirror()
    static let changed = Notification.Name("OTLiftMirrorChanged")
    private let health = HKHealthStore()
    private var session: HKWorkoutSession?
    private var state: LiftMirrorSnapshot?
    private var lastDisconnect = Date.distantPast
    private var receivedAt = Date.distantPast
    private var pending: (id: UUID, complete: (String?) -> Void)?

    func activate() {
        health.workoutSessionMirroringStartHandler = { [weak self] remote in
            DispatchQueue.main.async {
                guard let self else { return }
                if self.session !== remote {
                    self.clear()
                    self.session = remote
                }
                remote.delegate = self
                if let data = LiftMirrorPacket(kind: .hello).encode() {
                    remote.sendToRemoteWorkoutSession(data: data) { _, _ in }
                }
            }
        }
    }

    private func clear() {
        session = nil
        state = nil
        receivedAt = .distantPast
        finishRequest("Watch session closed. Check the latest set on your Watch.")
        notify()
    }

    private func finishRequest(_ message: String?) {
        let completion = pending?.complete
        pending = nil
        completion?(message)
    }

    private func notify() { NotificationCenter.default.post(name: Self.changed, object: nil) }

    private var connected: Bool {
        session != nil && receivedAt > lastDisconnect && Date().timeIntervalSince(receivedAt) < 12
    }

    func status(owner: String) -> [String: Any] {
        guard !owner.isEmpty, let state, state.cursor.owner == owner,
              Date().timeIntervalSince(receivedAt) < 120, let data = try? JSONEncoder().encode(state),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return ["state": object, "receivedAt": receivedAt.timeIntervalSince1970 * 1000, "connected": connected]
    }

    func command(_ command: LiftMirrorCommand, owner: String, complete: @escaping (String?) -> Void) {
        guard let session, session.workoutConfiguration.activityType == .traditionalStrengthTraining, connected, let state, !owner.isEmpty, state.cursor.owner == owner,
              command.valid(for: state), pending == nil,
              let data = LiftMirrorPacket(kind: .command, command: command).encode() else {
            complete("The set changed or your Watch is reconnecting. Check the current set.")
            return
        }
        pending = (command.id, complete)
        session.sendToRemoteWorkoutSession(data: data) { [weak self] success, _ in
            guard !success else { return }
            DispatchQueue.main.async {
                guard self?.pending?.id == command.id else { return }
                self?.finishRequest("Watch unavailable. Check the set on your Watch before retrying.")
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            guard self?.pending?.id == command.id else { return }
            self?.finishRequest("No confirmation yet. Check the set on your Watch before retrying.")
        }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didReceiveDataFromRemoteWorkoutSession data: [Data]) {
        DispatchQueue.main.async {
            guard self.session === workoutSession else { return }
            for data in data {
                guard let packet = LiftMirrorPacket.decode(data), let state = packet.state, !state.cursor.owner.isEmpty,
                      packet.kind == .state || packet.kind == .receipt else { continue }
                if let existing = self.state, existing.cursor.workoutID != state.cursor.workoutID || existing.cursor.owner != state.cursor.owner { continue }
                if self.state.map({ state.sampledAt >= $0.sampledAt }) ?? true {
                    self.state = state
                    self.receivedAt = Date()
                }
                if packet.kind == .receipt, let id = packet.requestID, id == self.pending?.id {
                    self.finishRequest(packet.accepted == true ? nil : "The set changed on your Watch. Review the updated set.")
                }
                self.notify()
            }
        }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
        guard toState == .ended || toState == .stopped else { return }
        DispatchQueue.main.async { if self.session === workoutSession { self.clear() } }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        DispatchQueue.main.async { if self.session === workoutSession { self.clear() } }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didDisconnectFromRemoteDeviceWithError error: Error?) {
        DispatchQueue.main.async {
            guard self.session === workoutSession else { return }
            // HealthKit may reconnect this same session. Keep its delegate and
            // make controls read-only until fresh state arrives.
            self.finishRequest("Watch disconnected. Check the latest set when it reconnects.")
            self.lastDisconnect = Date()
            self.notify()
        }
    }
}
