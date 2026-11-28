import Foundation

/// Today's lifting and runs as the phone sends them (src/watch/watchPlan.js
/// builds the plan). The phone works out every number: what each open set is
/// filled from, how long to rest, how far the crown moves each field. The
/// watch shows the plan and logs sets against it; runs open in the Workout
/// app.
struct WatchPlan: Codable, Equatable {
    var v: Int
    var owner: String?
    var date: String
    var sentAt: String?
    var title: String?
    var adaptationReason: String?
    var sessions: [PlanSession]
    /// Ids of watch events the phone has dealt with.
    var seen: [String]?
    /// Today's planned runs. Missing from plans sent before runs existed.
    var runs: [RunSpec]?
    var cardio: [RunSpec]?
    var rehearsal: RehearsalCourse?
    var barbellRules: BarbellRules?
    var cardioWorkouts: [RunSpec] { cardio ?? runs ?? [] }

    func exercise(_ key: ExerciseKey) -> PlanExercise? {
        sessions.first { $0.id == key.session }?.exercises.first { $0.name == key.name }
    }

    mutating func mutateExercise(_ key: ExerciseKey, _ change: (inout PlanExercise) -> Void) {
        guard let s = sessions.firstIndex(where: { $0.id == key.session }),
              let e = sessions[s].exercises.firstIndex(where: { $0.name == key.name }) else { return }
        change(&sessions[s].exercises[e])
    }

    func adjacent(to key: ExerciseKey, offset: Int) -> ExerciseKey? {
        guard let session = sessions.first(where: { $0.id == key.session }),
              let index = session.exercises.firstIndex(where: { $0.name == key.name }),
              session.exercises.indices.contains(index + offset) else { return nil }
        return ExerciseKey(session: key.session, name: session.exercises[index + offset].name)
    }

    func pairLeader(for key: ExerciseKey) -> ExerciseKey? {
        if let previous = adjacent(to: key, offset: -1), exercise(previous)?.pairNext == true { return previous }
        return exercise(key)?.pairNext == true ? key : nil
    }

    var keys: [ExerciseKey] {
        sessions.flatMap { session in session.exercises.map { ExerciseKey(session: session.id, name: $0.name) } }
    }
}

/// What the phone sends: today's plan and the next six days', so the watch
/// has the day's lifts and runs even when the iPhone app isn't opened. (The
/// same JSON also carries today's plan at the top level, for watch apps
/// built before weeks.)
struct WatchWeek: Codable, Equatable {
    /// Which version of the week this is.
    var week: Int?
    var owner: String?
    var sentAt: String?
    /// Ids of watch events the phone has dealt with.
    var seen: [String]?
    var days: [WatchPlan]
}

struct PlanSession: Codable, Equatable, Identifiable {
    var id: String
    var title: String
    var exercises: [PlanExercise]
}

struct PlanExercise: Codable, Equatable {
    /// The name in the program, which the log is keyed by.
    var name: String
    /// What was actually done, if it was swapped on the phone.
    var display: String
    var targetRir: String?
    var skipped: Bool?
    var restSeconds: Int
    var fields: [PlanField]
    var sets: [PlanSet]
    var swaps: [PlanVariation]?
    var pairNext: Bool?
    var barbell: Bool?
    var warmupSets: [WarmupSet]?
}

struct PlanVariation: Codable, Equatable {
    var name: String
    var fields: [PlanField]
    var sets: [PlanSet]
    var barbell: Bool?
}

struct WarmupSet: Codable, Equatable {
    var weight: Double
    var reps: Int
    var done: Bool
    var at: String?
    var workingWeight: Double?

    func matches(_ other: WarmupSet) -> Bool { weight == other.weight && reps == other.reps }
}

/// The phone supplies the same rules its plate and ramp calculators use.
struct BarbellRules: Codable, Equatable {
    struct Step: Codable, Equatable { var fraction: Double; var reps: Int }
    var bar: Double
    var plates: [Double]
    var rampMinimum: Double
    var increment: Double
    var emptyReps: Int
    var steps: [Step]

    func ramp(to work: Double) -> [WarmupSet] {
        guard work.isFinite, work >= rampMinimum, increment > 0, bar > 0, bar < work else { return [] }
        var result = [WarmupSet(weight: bar, reps: emptyReps, done: false)]
        for step in steps {
            let weight = (work * step.fraction / increment).rounded() * increment
            if weight > bar && weight < work && !result.contains(where: { $0.weight == weight }) {
                result.append(WarmupSet(weight: weight, reps: step.reps, done: false))
            }
        }
        return result
    }

    func perSide(for total: Double) -> String? {
        guard total.isFinite, total >= bar, total <= 1500, bar > 0 else { return nil }
        var remaining = (total - bar) / 2
        var parts: [String] = []
        for plate in plates where plate >= 0.25 {
            let count = Int((remaining / plate).rounded(.down))
            guard count > 0 else { continue }
            parts.append(count == 1 ? Format.number(plate) : "\(count) × \(Format.number(plate))")
            remaining -= Double(count) * plate
        }
        var label = parts.isEmpty ? "Empty bar" : parts.joined(separator: " + ") + " / side"
        if remaining >= 0.005 { label += " · \(Format.number(remaining)) lb short per side" }
        return label
    }
}

struct PlanField: Codable, Equatable, Hashable {
    var prop: String
    /// Read by VoiceOver, e.g. "Weight in pounds".
    var label: String
    /// Shown under the number, e.g. "lb".
    var unit: String
    var step: Double
    var max: Double
    var required: Bool
}

struct PlanSet: Codable, Equatable {
    var done: Bool
    var values: [String: Double]
    /// "target", "previous" or "last" for an open set.
    var source: String?
    /// "Target", "Set 1" or "Last time".
    var sourceLabel: String?
    var watchEventID: String?
    var completedAt: String?
    var target: [String: Double]?
}

struct ExerciseKey: Codable, Hashable {
    var session: String
    var name: String
}

/// A set as the watch shows it: the phone's plan with the sets logged here
/// that the phone hasn't confirmed yet.
struct SetState: Equatable {
    var index: Int
    var done: Bool
    var values: [String: Double]
    var sourceLabel: String?
}

/// A set logged on the watch, kept until the phone's plan shows it.
struct PendingSet: Codable, Equatable {
    var id: String
    var date: String
    var session: String
    var exercise: String
    var setIndex: Int
    var values: [String: Double]
    var loggedAt: Date
}

/// What the watch sends. The phone reads these in src/watch/watchPlan.js.
struct SetEvent: Encodable {
    let v = 1
    let type = "set"
    var id: String
    var date: String
    var session: String
    var exercise: String
    var setIndex: Int
    var values: [String: Double]
    var at: String
    var performedName: String?
}

struct GymEditEvent: Encodable {
    let v = 1
    var type: String
    var id = UUID().uuidString
    var date: String
    var session: String
    var exercise: String
    var at = Date().ISO8601Format(.iso8601(timeZone: .gmt, includingFractionalSeconds: true))
    var performedName: String?
    var setIndex: Int?
    var targetID: String?
    var partner: String?
    var enabled: Bool?
    var workingWeight: Double?
}

struct FinishEvent: Encodable {
    let v = 1
    let type = "finish"
    var id: String
    var date: String
    var at: String
    var startedAt: String
    var durationSeconds: Int
    var averageHeartRate: Double?
    var activeEnergy: Double?
}

enum Format {
    static func number(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)).grouping(.never))
    }

    /// "185 × 8" for weight and reps, the way the phone writes it; otherwise
    /// each number with its unit.
    static func summary(_ values: [String: Double], fields: [PlanField]) -> String {
        let props = fields.map(\.prop)
        if props == ["weight", "reps"], let weight = values["weight"], let reps = values["reps"] {
            return "\(number(weight))\u{00A0}×\u{00A0}\(number(reps))"
        }
        return fields.compactMap { field -> String? in
            guard let value = values[field.prop], value > 0 else { return nil }
            return "\(number(value))\u{00A0}\(field.unit)"
        }.joined(separator: " · ")
    }
}
