import Foundation
import HealthKit
import WorkoutKit
import Capacitor

/// Runs on the Apple Watch: planned runs scheduled in the watch's Workout
/// app, and runs recorded on the watch read back from Apple Health. The page
/// decides what to schedule and what to log (src/watch/useWatchRuns.js);
/// this does what iOS has to.
@objc(RunsPlugin)
public class RunsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RunsPlugin"
    public let jsName = "OTRuns"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recentRuns", returnType: CAPPluginReturnPromise)
    ]

    private let health = HKHealthStore()

    /// { supported, scheduling, health }: whether this iPhone can schedule
    /// workouts, whether 0VERTRAINED may ("authorized", "denied",
    /// "notDetermined", "restricted"), and whether it has Apple Health.
    @objc func status(_ call: CAPPluginCall) {
        Task {
            call.resolve(await self.currentStatus())
        }
    }

    /// Asks to schedule workouts and to read runs from Health, each only if
    /// iOS hasn't asked before. Resolves with the status afterwards.
    @objc func enable(_ call: CAPPluginCall) {
        Task {
            if #available(iOS 17.0, *), WorkoutScheduler.isSupported {
                _ = await WorkoutScheduler.shared.requestAuthorization()
            }
            if HKHealthStore.isHealthDataAvailable() {
                do {
                    try await self.health.requestAuthorization(toShare: [], read: Self.readTypes)
                } catch {
                    // Runs just aren't read; scheduling still works.
                }
            }
            call.resolve(await self.currentStatus())
        }
    }

    /// runs: a JSON array of the runs to have on the watch. Runs no longer
    /// in it come off, along with any from past days; new ones go on.
    @objc func schedule(_ call: CAPPluginCall) {
        guard let text = call.getString("runs"),
              let data = text.data(using: .utf8),
              let specs = try? JSONDecoder().decode([RunSpec].self, from: data) else {
            call.reject("No runs to schedule.")
            return
        }
        guard #available(iOS 17.0, *) else {
            call.resolve(["scheduled": 0, "removed": 0, "authorized": false])
            return
        }
        Task {
            call.resolve(await RunSchedule.apply(specs))
        }
    }

    /// Takes every run this app scheduled off the watch.
    @objc func clear(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else {
            call.resolve()
            return
        }
        Task {
            if WorkoutScheduler.isSupported {
                await WorkoutScheduler.shared.removeAllWorkouts()
            }
            call.resolve()
        }
    }

    /// days: how far back to look. Resolves { runs: [{ id, date, start,
    /// seconds, meters, avgHr }] }, newest first. Health doesn't say whether
    /// reading was allowed; when it wasn't, there are simply no runs.
    @objc func recentRuns(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["runs": [[String: Any]]()])
            return
        }
        let days = max(1, min(call.getInt("days") ?? 7, 31))
        let calendar = Calendar.current
        let start = calendar.date(byAdding: .day, value: -days, to: calendar.startOfDay(for: Date())) ?? Date()
        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
            HKQuery.predicateForWorkouts(with: .running),
            HKQuery.predicateForSamples(withStart: start, end: nil, options: .strictStartDate)
        ])
        let newestFirst = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: 50, sortDescriptors: [newestFirst]) { _, samples, _ in
            let runs = (samples as? [HKWorkout] ?? []).map(Self.describe)
            call.resolve(["runs": runs])
        }
        Task {
            // Heart rate was added after runners first said yes. iOS shows
            // its sheet only for what it hasn't asked about, so this asks
            // once for heart rate and is silent after that.
            try? await self.health.requestAuthorization(toShare: [], read: Self.readTypes)
            self.health.execute(query)
        }
    }

    private static var readTypes: Set<HKObjectType> {
        [HKObjectType.workoutType(), HKQuantityType(.distanceWalkingRunning), HKQuantityType(.heartRate)]
    }

    private func currentStatus() async -> [String: Any] {
        var status: [String: Any] = [
            "supported": false,
            "scheduling": "unsupported",
            "health": HKHealthStore.isHealthDataAvailable()
        ]
        if #available(iOS 17.0, *), WorkoutScheduler.isSupported {
            status["supported"] = true
            status["scheduling"] = RunSchedule.name(await WorkoutScheduler.shared.authorizationState)
        }
        return status
    }

    private static func describe(_ workout: HKWorkout) -> [String: Any] {
        var run: [String: Any] = [
            "id": workout.uuid.uuidString,
            "date": RunSchedule.dayKey(workout.startDate),
            "start": ISO8601DateFormatter().string(from: workout.startDate),
            "seconds": workout.duration
        ]
        if let meters = distance(of: workout) {
            run["meters"] = meters
        }
        if let bpm = averageHeartRate(of: workout) {
            run["avgHr"] = bpm
        }
        return run
    }

    private static func distance(of workout: HKWorkout) -> Double? {
        if #available(iOS 16.0, *) {
            return workout.statistics(for: HKQuantityType(.distanceWalkingRunning))?.sumQuantity()?.doubleValue(for: .meter())
        }
        return workout.totalDistance?.doubleValue(for: .meter())
    }

    private static func averageHeartRate(of workout: HKWorkout) -> Double? {
        guard #available(iOS 16.0, *) else { return nil }
        let perMinute = HKUnit.count().unitDivided(by: .minute())
        return workout.statistics(for: HKQuantityType(.heartRate))?.averageQuantity()?.doubleValue(for: perMinute)
    }
}

/// Keeps the Workout app's list of this app's runs in step with the plan.
enum RunSchedule {
    @available(iOS 17.0, *)
    static func apply(_ specs: [RunSpec]) async -> [String: Any] {
        let scheduler = WorkoutScheduler.shared
        guard WorkoutScheduler.isSupported, await scheduler.authorizationState == .authorized else {
            return ["scheduled": 0, "removed": 0, "authorized": false]
        }
        var wanted: [(plan: WorkoutPlan, date: DateComponents, day: String)] = []
        for spec in specs {
            guard wanted.count < WorkoutScheduler.maxAllowedScheduledWorkoutCount,
                  let plan = RunWorkout.plan(for: spec),
                  let date = RunWorkout.dateComponents(for: spec) else { continue }
            wanted.append((plan: plan, date: date, day: spec.date))
        }
        let today = dayKey(Date())
        let existing = await scheduler.scheduledWorkouts
        var removed = 0
        for item in existing {
            let day = dayKey(item.date)
            let keep = wanted.contains { $0.plan.id == item.plan.id && $0.day == day }
            // Past days come off, done or not; a changed or dropped run comes
            // off unless it's already been run today.
            if day < today || (!keep && !item.complete) {
                await scheduler.remove(item.plan, at: item.date)
                removed += 1
            }
        }
        var scheduled = 0
        for item in wanted where !existing.contains(where: { $0.plan.id == item.plan.id && dayKey($0.date) == item.day }) {
            await scheduler.schedule(item.plan, at: item.date)
            scheduled += 1
        }
        return ["scheduled": scheduled, "removed": removed, "authorized": true]
    }

    @available(iOS 17.0, *)
    static func name(_ state: WorkoutScheduler.AuthorizationState) -> String {
        switch state {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        @unknown default: return "unknown"
        }
    }

    /// "2026-11-30" for a date in the phone's time zone.
    static func dayKey(_ date: Date) -> String {
        dayKey(Calendar.current.dateComponents([.year, .month, .day], from: date))
    }

    static func dayKey(_ components: DateComponents) -> String {
        String(format: "%04d-%02d-%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0)
    }
}
