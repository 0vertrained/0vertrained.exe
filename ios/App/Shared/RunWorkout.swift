import Foundation
import HealthKit
import WorkoutKit

/// A planned run as the page builds it (src/watch/runWorkouts.js). The
/// iPhone app schedules it in the watch's Workout app; the watch app opens
/// today's there. Both build the same workout from it, here.
struct RunSpec: Codable, Equatable, Identifiable {
    /// A UUID that stays the same until the run changes.
    var id: String
    /// "2026-11-30", in the phone's time zone.
    var date: String
    /// "07:00": when the Workout app lists it for.
    var time: String?
    var name: String
    /// "35 min · 10:11–11:12/mi"
    var summary: String?
    /// "outdoor" or "indoor".
    var location: String?
    var warmup: RunStep?
    var blocks: [RunBlock]
    var cooldown: RunStep?
}

/// Steps repeated `iterations` times.
struct RunBlock: Codable, Equatable {
    var iterations: Int
    var steps: [RunStep]
}

struct RunStep: Codable, Equatable {
    /// "work" or "recovery" inside a block.
    var purpose: String?
    var goal: RunGoal
    var alert: RunAlert?
}

struct RunGoal: Codable, Equatable {
    /// "time", "distance" or "open".
    var kind: String
    var seconds: Double?
    var meters: Double?
}

struct RunAlert: Codable, Equatable {
    /// "pace" or "hrZone".
    var kind: String
    /// Seconds per mile at the quick end of the range.
    var fast: Double?
    /// Seconds per mile at the easy end.
    var slow: Double?
    /// Heart-rate zone, 1 to 5.
    var zone: Int?
}

/// The WorkoutKit workout for a run. An alert the Workout app can't use for
/// this run is left off rather than failing the whole run.
@available(iOS 17.0, watchOS 10.0, *)
enum RunWorkout {
    private static let metersPerMile = 1609.344

    static func plan(for spec: RunSpec) -> WorkoutPlan? {
        guard let id = UUID(uuidString: spec.id) else { return nil }
        let location: HKWorkoutSessionLocationType = spec.location == "indoor" ? .indoor : .outdoor
        let blocks = spec.blocks.compactMap { makeBlock($0, location: location) }
        guard !blocks.isEmpty else { return nil }
        let workout = CustomWorkout(
            activity: .running,
            location: location,
            displayName: spec.name,
            warmup: spec.warmup.map { makeStep($0, location: location) },
            blocks: blocks,
            cooldown: spec.cooldown.map { makeStep($0, location: location) }
        )
        return WorkoutPlan(.custom(workout), id: id)
    }

    /// When the run is listed for: its day, at its time.
    static func dateComponents(for spec: RunSpec) -> DateComponents? {
        let day = spec.date.split(separator: "-").compactMap { Int($0) }
        guard day.count == 3 else { return nil }
        let clock = (spec.time ?? "07:00").split(separator: ":").compactMap { Int($0) }
        var components = DateComponents()
        components.year = day[0]
        components.month = day[1]
        components.day = day[2]
        components.hour = clock.first ?? 7
        components.minute = clock.count > 1 ? clock[1] : 0
        return components
    }

    private static func makeBlock(_ block: RunBlock, location: HKWorkoutSessionLocationType) -> IntervalBlock? {
        guard block.iterations >= 1, !block.steps.isEmpty else { return nil }
        let steps = block.steps.map { item in
            IntervalStep(item.purpose == "recovery" ? .recovery : .work, step: makeStep(item, location: location))
        }
        return IntervalBlock(steps: steps, iterations: block.iterations)
    }

    private static func makeStep(_ item: RunStep, location: HKWorkoutSessionLocationType) -> WorkoutStep {
        var cue: (any WorkoutAlert)? = nil
        if let wanted = item.alert.flatMap(makeAlert),
           CustomWorkout.supportsAlert(wanted, activity: .running, location: location) {
            cue = wanted
        }
        return WorkoutStep(goal: makeGoal(item.goal), alert: cue)
    }

    private static func makeGoal(_ goal: RunGoal) -> WorkoutGoal {
        if goal.kind == "time", let seconds = goal.seconds, seconds > 0 {
            return .time(seconds, .seconds)
        }
        if goal.kind == "distance", let meters = goal.meters, meters > 0 {
            return .distance(meters, .meters)
        }
        return .open
    }

    private static func makeAlert(_ alert: RunAlert) -> (any WorkoutAlert)? {
        switch alert.kind {
        case "pace":
            guard let fast = alert.fast, let slow = alert.slow, fast > 0, slow > 0 else { return nil }
            // A pace in seconds per mile is a speed in metres per second;
            // the slower pace is the lower speed.
            let lower = Measurement(value: metersPerMile / max(fast, slow), unit: UnitSpeed.metersPerSecond)
            let upper = Measurement(value: metersPerMile / min(fast, slow), unit: UnitSpeed.metersPerSecond)
            return SpeedRangeAlert(target: lower...upper, metric: .current)
        case "hrZone":
            guard let zone = alert.zone, (1...5).contains(zone) else { return nil }
            return HeartRateZoneAlert(zone: zone)
        default:
            return nil
        }
    }
}
