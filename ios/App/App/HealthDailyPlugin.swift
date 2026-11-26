import Foundation
import HealthKit
import Capacitor

/// The day's numbers from Apple Health: steps, weight, sleep, resting heart
/// rate and heart rate variability. The page decides which of the log's
/// fields they fill (src/health/useHealthDaily.js); this only reads.
@objc(HealthDailyPlugin)
public class HealthDailyPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthDailyPlugin"
    public let jsName = "OTHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "daily", returnType: CAPPluginReturnPromise)
    ]

    private let health = HKHealthStore()

    private static var readTypes: Set<HKObjectType> {
        [
            HKQuantityType(.stepCount),
            HKQuantityType(.bodyMass),
            HKQuantityType(.restingHeartRate),
            HKQuantityType(.heartRateVariabilitySDNN),
            HKCategoryType(.sleepAnalysis)
        ]
    }

    // Sleep analysis values that mean asleep: unspecified, core, deep, REM.
    // In bed (0) and awake (2) don't count.
    private static let asleepValues: Set<Int> = [1, 3, 4, 5]

    /// { available }: whether this iPhone has Apple Health.
    @objc func status(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    /// Asks to read the daily numbers, only for what iOS hasn't asked about.
    @objc func enable(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["available": false])
            return
        }
        Task {
            try? await self.health.requestAuthorization(toShare: [], read: Self.readTypes)
            call.resolve(["available": true])
        }
    }

    /// days: how many days back, today included. Resolves { days: [{ date,
    /// steps, weightLb, sleepHours, restingHr, hrv }] }, oldest first, each
    /// number only where Health has one. Health doesn't say whether reading
    /// was allowed; when it wasn't, the days are simply empty.
    @objc func daily(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["days": [[String: Any]]()])
            return
        }
        let count = max(1, min(call.getInt("days") ?? 3, 14))
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        guard let start = calendar.date(byAdding: .day, value: -(count - 1), to: today),
              let end = calendar.date(byAdding: .day, value: 1, to: today) else {
            call.resolve(["days": [[String: Any]]()])
            return
        }
        Task {
            // iOS shows its sheet only for what it hasn't asked about yet.
            try? await self.health.requestAuthorization(toShare: [], read: Self.readTypes)
            let perMinute = HKUnit.count().unitDivided(by: .minute())
            let steps = await self.dailyStatistics(.stepCount, sum: true, unit: .count(), from: start, to: end)
            let restingHr = await self.dailyStatistics(.restingHeartRate, sum: false, unit: perMinute, from: start, to: end)
            let hrv = await self.dailyStatistics(.heartRateVariabilitySDNN, sum: false, unit: .secondUnit(with: .milli), from: start, to: end)
            let weight = await self.latestPerDay(.bodyMass, unit: .pound(), from: start, to: end)
            let sleep = await self.sleepHoursPerDay(from: start, to: end)

            var days: [[String: Any]] = []
            for offset in 0..<count {
                guard let date = calendar.date(byAdding: .day, value: offset, to: start) else { continue }
                let key = RunSchedule.dayKey(date)
                var day: [String: Any] = ["date": key]
                if let value = steps[key] { day["steps"] = value.rounded() }
                if let value = weight[key] { day["weightLb"] = (value * 10).rounded() / 10 }
                if let value = sleep[key] { day["sleepHours"] = (value * 10).rounded() / 10 }
                if let value = restingHr[key] { day["restingHr"] = value.rounded() }
                if let value = hrv[key] { day["hrv"] = value.rounded() }
                days.append(day)
            }
            call.resolve(["days": days])
        }
    }

    // A quantity per calendar day: the day's total, or the day's average.
    private func dailyStatistics(_ id: HKQuantityTypeIdentifier, sum: Bool, unit: HKUnit, from start: Date, to end: Date) async -> [String: Double] {
        await withCheckedContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
            let query = HKStatisticsCollectionQuery(
                quantityType: HKQuantityType(id),
                quantitySamplePredicate: predicate,
                options: sum ? .cumulativeSum : .discreteAverage,
                anchorDate: start,
                intervalComponents: DateComponents(day: 1)
            )
            query.initialResultsHandler = { _, collection, _ in
                var values: [String: Double] = [:]
                collection?.enumerateStatistics(from: start, to: end) { statistics, _ in
                    let quantity = sum ? statistics.sumQuantity() : statistics.averageQuantity()
                    if let value = quantity?.doubleValue(for: unit), value > 0 {
                        values[RunSchedule.dayKey(statistics.startDate)] = value
                    }
                }
                continuation.resume(returning: values)
            }
            self.health.execute(query)
        }
    }

    // The last reading of each day, for something read now and then (weight).
    private func latestPerDay(_ id: HKQuantityTypeIdentifier, unit: HKUnit, from start: Date, to end: Date) async -> [String: Double] {
        await withCheckedContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
            let newestFirst = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
            let query = HKSampleQuery(sampleType: HKQuantityType(id), predicate: predicate, limit: 500, sortDescriptors: [newestFirst]) { _, samples, _ in
                var values: [String: Double] = [:]
                for case let sample as HKQuantitySample in samples ?? [] {
                    let key = RunSchedule.dayKey(sample.endDate)
                    if values[key] == nil {
                        values[key] = sample.quantity.doubleValue(for: unit)
                    }
                }
                continuation.resume(returning: values)
            }
            self.health.execute(query)
        }
    }

    // Hours asleep, counted toward the day a stretch of sleep ends on. Watch,
    // phone and ring can all record the same night, so overlapping stretches
    // are merged rather than added.
    private func sleepHoursPerDay(from start: Date, to end: Date) async -> [String: Double] {
        let lookBack = Calendar.current.date(byAdding: .hour, value: -18, to: start) ?? start
        return await withCheckedContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(withStart: lookBack, end: end, options: [])
            let query = HKSampleQuery(sampleType: HKCategoryType(.sleepAnalysis), predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
                var stretches: [String: [(start: Date, end: Date)]] = [:]
                for case let sample as HKCategorySample in samples ?? [] where Self.asleepValues.contains(sample.value) {
                    guard sample.endDate >= start else { continue }
                    stretches[RunSchedule.dayKey(sample.endDate), default: []].append((start: sample.startDate, end: sample.endDate))
                }
                var hours: [String: Double] = [:]
                for (key, list) in stretches {
                    let seconds = Self.mergedSeconds(list)
                    if seconds > 0 { hours[key] = seconds / 3600 }
                }
                continuation.resume(returning: hours)
            }
            self.health.execute(query)
        }
    }

    private static func mergedSeconds(_ stretches: [(start: Date, end: Date)]) -> TimeInterval {
        let sorted = stretches.sorted { $0.start < $1.start }
        var total: TimeInterval = 0
        var current: (start: Date, end: Date)?
        for stretch in sorted {
            if let open = current, stretch.start <= open.end {
                current = (start: open.start, end: max(open.end, stretch.end))
            } else {
                if let open = current { total += open.end.timeIntervalSince(open.start) }
                current = stretch
            }
        }
        if let open = current { total += open.end.timeIntervalSince(open.start) }
        return total
    }
}
