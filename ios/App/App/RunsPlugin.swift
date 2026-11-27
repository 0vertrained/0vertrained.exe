import Foundation
import HealthKit
import WorkoutKit
import Capacitor

/// Runs on the Apple Watch: planned runs scheduled in the watch's Workout
/// app, and runs recorded on the watch read back from Apple Health, with
/// each run's distance and heart rate over time and its effort, and Apple's
/// cardio fitness estimate. The page decides what to schedule and what to
/// log (src/watch/useWatchRuns.js); this does what iOS has to.
@objc(RunsPlugin)
public class RunsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RunsPlugin"
    public let jsName = "OTRuns"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recentRuns", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "runDetail", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cardioFitness", returnType: CAPPluginReturnPromise)
    ]

    /// Seconds between the points runDetail keeps: plenty for splits.
    private static let pointSpacing: TimeInterval = 3

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

    /// id: a run's Health workout id, from recentRuns. Resolves { distance,
    /// heartRate, pauses, effort? }: distance as [seconds from the start,
    /// meters so far], heart rate as [seconds, bpm], pauses as [from, to] in
    /// seconds, and the effort as { value, estimated }, your rating of the
    /// run where there is one, else Apple's estimate (iOS 18 and later). The
    /// page cuts the run into splits (src/watch/runSplits.js).
    @objc func runDetail(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable(),
              let text = call.getString("id"),
              let id = UUID(uuidString: text) else {
            call.reject("No run to read.")
            return
        }
        Task {
            try? await self.health.requestAuthorization(toShare: [], read: Self.readTypes)
            guard let workout = await self.workout(id) else {
                call.resolve([:])
                return
            }
            let perMinute = HKUnit.count().unitDivided(by: .minute())
            let distance = await self.series(.distanceWalkingRunning, of: workout, unit: .meter(), runningTotal: true)
            let heartRate = await self.series(.heartRate, of: workout, unit: perMinute, runningTotal: false)
            var detail: [String: Any] = [
                "distance": distance,
                "heartRate": heartRate,
                "pauses": Self.pauses(of: workout)
            ]
            if let effort = await self.effort(of: workout) {
                detail["effort"] = effort
            }
            call.resolve(detail)
        }
    }

    /// days: how far back. Resolves { points: [{ date, value }] }: Apple's
    /// cardio fitness (VO2 max) estimates in mL/kg/min, the last of each
    /// day, oldest first.
    @objc func cardioFitness(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["points": [[String: Any]]()])
            return
        }
        let days = max(7, min(call.getInt("days") ?? 365, 730))
        let start = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date()
        Task {
            try? await self.health.requestAuthorization(toShare: [], read: Self.readTypes)
            let unit = HKUnit(from: "ml/kg*min")
            let samples = await self.quantitySamples(.vo2Max, predicate: HKQuery.predicateForSamples(withStart: start, end: nil, options: .strictStartDate))
            var order: [String] = []
            var latest: [String: Double] = [:]
            for sample in samples {
                let key = RunSchedule.dayKey(sample.endDate)
                if latest[key] == nil { order.append(key) }
                latest[key] = sample.quantity.doubleValue(for: unit)
            }
            let points: [[String: Any]] = order.map { key in
                ["date": key, "value": ((latest[key] ?? 0) * 10).rounded() / 10]
            }
            call.resolve(["points": points])
        }
    }

    private static var readTypes: Set<HKObjectType> {
        var types: Set<HKObjectType> = [
            HKObjectType.workoutType(),
            HKQuantityType(.distanceWalkingRunning),
            HKQuantityType(.heartRate),
            HKQuantityType(.vo2Max)
        ]
        if #available(iOS 18.0, *) {
            types.insert(HKQuantityType(.workoutEffortScore))
            types.insert(HKQuantityType(.estimatedWorkoutEffortScore))
        }
        return types
    }

    private func workout(_ id: UUID) async -> HKWorkout? {
        await withCheckedContinuation { continuation in
            let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: HKQuery.predicateForObject(with: id), limit: 1, sortDescriptors: nil) { _, samples, _ in
                continuation.resume(returning: samples?.first as? HKWorkout)
            }
            self.health.execute(query)
        }
    }

    private func quantitySamples(_ id: HKQuantityTypeIdentifier, predicate: NSPredicate) async -> [HKQuantitySample] {
        await withCheckedContinuation { continuation in
            let oldestFirst = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
            let query = HKSampleQuery(sampleType: HKQuantityType(id), predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [oldestFirst]) { _, samples, _ in
                continuation.resume(returning: samples as? [HKQuantitySample] ?? [])
            }
            self.health.execute(query)
        }
    }

    /// The workout's own samples; for one that didn't link them, the
    /// samples its device recorded while it ran.
    private func samples(_ id: HKQuantityTypeIdentifier, of workout: HKWorkout) async -> [HKQuantitySample] {
        let linked = await quantitySamples(id, predicate: HKQuery.predicateForObjects(from: workout))
        if !linked.isEmpty { return linked }
        let during = NSCompoundPredicate(andPredicateWithSubpredicates: [
            HKQuery.predicateForSamples(withStart: workout.startDate, end: workout.endDate, options: .strictStartDate),
            HKQuery.predicateForObjects(from: workout.sourceRevision.source)
        ])
        return await quantitySamples(id, predicate: during)
    }

    /// [seconds from the start, value] oldest first, a point every few
    /// seconds at most: a running total for distance, the reading for
    /// heart rate.
    private func series(_ id: HKQuantityTypeIdentifier, of workout: HKWorkout, unit: HKUnit, runningTotal: Bool) async -> [[Double]] {
        let list = await samples(id, of: workout)
        var points: [[Double]] = []
        var total = 0.0
        var lastKept = -Double.greatestFiniteMagnitude
        for (index, sample) in list.enumerated() {
            let value = sample.quantity.doubleValue(for: unit)
            let at: TimeInterval
            if runningTotal {
                total += value
                at = sample.endDate.timeIntervalSince(workout.startDate)
            } else {
                let middle = sample.startDate.addingTimeInterval(sample.endDate.timeIntervalSince(sample.startDate) / 2)
                at = middle.timeIntervalSince(workout.startDate)
            }
            let isLast = index == list.count - 1
            guard at - lastKept >= Self.pointSpacing || isLast else { continue }
            let reading = runningTotal ? total : value
            points.append([(at * 10).rounded() / 10, (reading * 10).rounded() / 10])
            lastKept = at
        }
        return points
    }

    /// Paused stretches, in seconds from the start: paused by you or by the
    /// watch when you stopped moving.
    private static func pauses(of workout: HKWorkout) -> [[Double]] {
        var stretches: [[Double]] = []
        var pausedAt: Date?
        let events = (workout.workoutEvents ?? []).sorted { $0.dateInterval.start < $1.dateInterval.start }
        for event in events {
            switch event.type {
            case .pause, .motionPaused:
                if pausedAt == nil { pausedAt = event.dateInterval.start }
            case .resume, .motionResumed:
                if let from = pausedAt {
                    stretches.append([from.timeIntervalSince(workout.startDate), event.dateInterval.start.timeIntervalSince(workout.startDate)])
                    pausedAt = nil
                }
            default:
                break
            }
        }
        if let from = pausedAt {
            stretches.append([from.timeIntervalSince(workout.startDate), workout.endDate.timeIntervalSince(workout.startDate)])
        }
        return stretches
    }

    /// { value, estimated }: your rating of the run, else Apple's estimate.
    private func effort(of workout: HKWorkout) async -> [String: Any]? {
        guard #available(iOS 18.0, *) else { return nil }
        let unit = HKUnit.appleEffortScore()
        let during = HKQuery.predicateForSamples(withStart: workout.startDate, end: workout.endDate, options: [])
        if let rated = await quantitySamples(.workoutEffortScore, predicate: during).last {
            return ["value": rated.quantity.doubleValue(for: unit), "estimated": false]
        }
        if let estimate = await quantitySamples(.estimatedWorkoutEffortScore, predicate: during).last {
            return ["value": estimate.quantity.doubleValue(for: unit), "estimated": true]
        }
        return nil
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
