import Foundation

/// Live packets describe a single HealthKit session. The Watch's existing durable
/// workout journal remains the only source of completed sets.
struct LiftMirrorField: Codable {
    var prop: String
    var label: String
    var unit: String
    var max: Double
    var step: Double
    var required: Bool
}

struct LiftMirrorCursor: Codable, Equatable {
    var owner: String
    var workoutID: String
    var revision: String
    var section: String?
    var exercise: String?
    var index: Int?
    var lastSetID: String?
}

struct CardioMirrorSnapshot: Codable {
    var activity: String
    var kind: String
    var name: String
    var distanceMeters: Double?
    var stepLabel: String?
    var stepIndex: Int?
    var stepCount: Int?
    var stepStartedAt: Double?
    var stepTargetSeconds: Double?
    var stepTargetMeters: Double?
    var checkpointName: String?
    var checkpointMeters: Double?
    var checkpointTargetSeconds: Double?
    var checkpointInstruction: String?
    var atStation: Bool?
}

struct LiftMirrorSnapshot: Codable {
    var cursor: LiftMirrorCursor
    var title: String
    var display: String?
    var total: Int
    var fields: [LiftMirrorField]
    var values: [String: Double]
    var next: String?
    var heartRate: Double?
    var restUntil: Double?
    var liveReps: Int?
    var sampledAt = Date().timeIntervalSince1970
    var startedAt: Double
    var cardio: CardioMirrorSnapshot?
}

struct LiftMirrorCommand: Codable {
    enum Action: String, Codable { case setTarget, logSet, undo }
    var id: UUID
    var cursor: LiftMirrorCursor
    var action: Action
    var observedAt: Double
    var values: [String: Double]

    func valid(for state: LiftMirrorSnapshot) -> Bool {
        // Both timestamps originate on the Watch, so clock drift between
        // devices cannot turn an old button tap into a fresh command.
        let age = state.sampledAt - observedAt
        guard state.cardio == nil, (0...15).contains(age), cursor == state.cursor, state.liveReps == nil else { return false }
        if action == .undo { return cursor.lastSetID != nil }
        guard cursor.index != nil, !state.fields.isEmpty,
              Set(values.keys).isSubset(of: Set(state.fields.map(\.prop))) else { return false }
        return state.fields.allSatisfy { field in
            let value = values[field.prop] ?? 0
            return value.isFinite && value >= 0 && value <= field.max
                && (!field.required || value > 0) && (field.prop != "reps" || value.rounded() == value)
        }
    }
}

struct LiftMirrorPacket: Codable {
    enum Kind: String, Codable { case hello, state, command, receipt }
    var kind: Kind
    var state: LiftMirrorSnapshot?
    var command: LiftMirrorCommand?
    var requestID: UUID?
    var accepted: Bool?

    func encode() -> Data? { try? JSONEncoder().encode(self) }

    static func decode(_ data: Data) -> Self? {
        guard data.count <= 16_384 else { return nil }
        return try? JSONDecoder().decode(Self.self, from: data)
    }
}
