import Foundation
import HealthKit
import Capacitor

/// Writes to Apple Health, once it's turned on in Settings: the weight you
/// type, each day's food totals, and lifts logged on this iPhone as
/// strength workouts, with your effort rating (iOS 18 and later). Every
/// sample carries a sync identifier, so saving a day again replaces what
/// was saved for it before. The page decides what to save and when
/// (src/health/healthWrite.js).
@objc(HealthWritePlugin)
public class HealthWritePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthWritePlugin"
    public let jsName = "OTHealthWrite"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveWeight", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveFood", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveLift", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "rateWorkout", returnType: CAPPluginReturnPromise)
    ]

    private let health = HKHealthStore()

    private static var shareTypes: Set<HKSampleType> {
        var types: Set<HKSampleType> = [
            HKQuantityType(.bodyMass),
            HKQuantityType(.dietaryEnergyConsumed),
            HKQuantityType(.dietaryProtein),
            HKQuantityType(.dietaryCarbohydrates),
            HKQuantityType(.dietaryFatTotal),
            HKObjectType.workoutType()
        ]
        if #available(iOS 18.0, *) {
            types.insert(HKQuantityType(.workoutEffortScore))
        }
        return types
    }

    // The food totals: the page's field, Health's type and unit.
    private static let foodParts: [(field: String, id: HKQuantityTypeIdentifier, unit: HKUnit)] = [
        ("calories", .dietaryEnergyConsumed, .kilocalorie()),
        ("protein", .dietaryProtein, .gram()),
        ("carbs", .dietaryCarbohydrates, .gram()),
        ("fat", .dietaryFatTotal, .gram())
    ]

    /// { available, weight, food, workouts }: "allowed", "denied" or
    /// "notDetermined" for each.
    @objc func status(_ call: CAPPluginCall) {
        call.resolve(currentStatus())
    }

    /// Asks to save weight, food and workouts, only for what iOS hasn't
    /// asked about. Resolves with the status afterwards.
    @objc func enable(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(currentStatus())
            return
        }
        Task {
            try? await self.health.requestAuthorization(toShare: Self.shareTypes, read: [HKObjectType.workoutType()])
            call.resolve(self.currentStatus())
        }
    }

    /// date ("2026-11-26") and pounds. Replaces that day's earlier save.
    @objc func saveWeight(_ call: CAPPluginCall) {
        guard let key = call.getString("date"), let day = Self.day(key),
              let pounds = call.getDouble("pounds"), pounds > 0 else {
            call.reject("No weight to save.")
            return
        }
        let at = Self.moment(on: day)
        let sample = HKQuantitySample(
            type: HKQuantityType(.bodyMass),
            quantity: HKQuantity(unit: .pound(), doubleValue: pounds),
            start: at,
            end: at,
            metadata: Self.sync("weight.\(key)", call)
        )
        save([sample], call)
    }

    /// date and the day's calories, protein, carbs and fat. Replaces the
    /// day's earlier totals; one that's now zero takes the earlier away.
    @objc func saveFood(_ call: CAPPluginCall) {
        guard let key = call.getString("date"), let day = Self.day(key) else {
            call.reject("No day to save.")
            return
        }
        let at = Self.moment(on: day)
        var samples: [HKObject] = []
        var cleared: [(type: HKQuantityType, sync: String)] = []
        for part in Self.foodParts {
            let sync = "food.\(part.field).\(key)"
            if let amount = call.getDouble(part.field), amount > 0 {
                samples.append(HKQuantitySample(
                    type: HKQuantityType(part.id),
                    quantity: HKQuantity(unit: part.unit, doubleValue: amount),
                    start: at,
                    end: at,
                    metadata: Self.sync(sync, call)
                ))
            } else {
                cleared.append((type: HKQuantityType(part.id), sync: Self.identifier(sync, call)))
            }
        }
        let toSave = samples
        let toClear = cleared
        Task {
            for item in toClear {
                await self.deleteSynced(item.type, identifier: item.sync)
            }
            guard !toSave.isEmpty else {
                call.resolve(["saved": true])
                return
            }
            self.save(toSave, call)
        }
    }

    /// id (the day and session), start and end (ms since 1970), and effort
    /// (1 to 10, optional): a strength workout in Health for a lift logged
    /// on this iPhone. Resolves { saved, rated }.
    @objc func saveLift(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty,
              let startMs = call.getDouble("start"), let endMs = call.getDouble("end"), endMs > startMs else {
            call.reject("No lift to save.")
            return
        }
        let start = Date(timeIntervalSince1970: startMs / 1000)
        let end = Date(timeIntervalSince1970: endMs / 1000)
        let effort = call.getDouble("effort")
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .traditionalStrengthTraining
        configuration.locationType = .indoor
        let builder = HKWorkoutBuilder(healthStore: health, configuration: configuration, device: .local())
        builder.beginCollection(withStart: start) { began, _ in
            guard began else {
                call.resolve(["saved": false, "rated": false])
                return
            }
            builder.addMetadata(Self.sync("lift.\(id)", call)) { _, _ in
                builder.endCollection(withEnd: end) { ended, _ in
                    guard ended else {
                        call.resolve(["saved": false, "rated": false])
                        return
                    }
                    builder.finishWorkout { workout, _ in
                        guard let workout else {
                            call.resolve(["saved": false, "rated": false])
                            return
                        }
                        Task {
                            var rated = false
                            if let effort {
                                rated = await self.relate(effort: effort, to: workout)
                            }
                            call.resolve(["saved": true, "rated": rated])
                        }
                    }
                }
            }
        }
    }

    /// start and end (ms since 1970) of a lift the watch tracked, and
    /// effort (1 to 10): rates the strength workout in Health that matches
    /// it best. Resolves { rated }.
    @objc func rateWorkout(_ call: CAPPluginCall) {
        guard let startMs = call.getDouble("start"), let endMs = call.getDouble("end"), endMs > startMs,
              let effort = call.getDouble("effort") else {
            call.reject("No workout to rate.")
            return
        }
        let start = Date(timeIntervalSince1970: startMs / 1000)
        let end = Date(timeIntervalSince1970: endMs / 1000)
        Task {
            let near = NSCompoundPredicate(andPredicateWithSubpredicates: [
                HKQuery.predicateForWorkouts(with: .traditionalStrengthTraining),
                HKQuery.predicateForSamples(withStart: start.addingTimeInterval(-600), end: end.addingTimeInterval(600), options: [])
            ])
            let owner = call.getString("owner")
            let candidates = await self.workouts(near)
            let found = candidates.filter { workout in
                guard let recorded = workout.metadata?["OTAthleteOwner"] as? String else {
                    // Pre-account Watch workouts belong to the original pairing.
                    return call.getString("prefix") == nil
                }
                return recorded == owner
            }
            let best = found.max { Self.overlap($0, start, end) < Self.overlap($1, start, end) }
            guard let workout = best, Self.overlap(workout, start, end) > 0 else {
                call.resolve(["rated": false])
                return
            }
            let rated = await self.relate(effort: effort, to: workout)
            call.resolve(["rated": rated])
        }
    }

    // MARK: - Helpers

    private func currentStatus() -> [String: Any] {
        guard HKHealthStore.isHealthDataAvailable() else {
            return ["available": false, "weight": "denied", "food": "denied", "workouts": "denied"]
        }
        return [
            "available": true,
            "weight": Self.name(health.authorizationStatus(for: HKQuantityType(.bodyMass))),
            "food": Self.name(health.authorizationStatus(for: HKQuantityType(.dietaryEnergyConsumed))),
            "workouts": Self.name(health.authorizationStatus(for: HKObjectType.workoutType()))
        ]
    }

    private static func name(_ status: HKAuthorizationStatus) -> String {
        switch status {
        case .sharingAuthorized: return "allowed"
        case .sharingDenied: return "denied"
        case .notDetermined: return "notDetermined"
        @unknown default: return "notDetermined"
        }
    }

    private func save(_ objects: [HKObject], _ call: CAPPluginCall) {
        health.save(objects) { saved, _ in
            call.resolve(["saved": saved])
        }
    }

    private func deleteSynced(_ type: HKQuantityType, identifier: String) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let ours = HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeySyncIdentifier, allowedValues: [identifier])
            health.deleteObjects(of: type, predicate: ours) { _, _, _ in
                continuation.resume()
            }
        }
    }

    private func workouts(_ predicate: NSPredicate) async -> [HKWorkout] {
        await withCheckedContinuation { continuation in
            let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: 20, sortDescriptors: nil) { _, samples, _ in
                continuation.resume(returning: samples as? [HKWorkout] ?? [])
            }
            health.execute(query)
        }
    }

    private static func overlap(_ workout: HKWorkout, _ start: Date, _ end: Date) -> TimeInterval {
        max(0, min(workout.endDate, end).timeIntervalSince(max(workout.startDate, start)))
    }

    private func relate(effort: Double, to workout: HKWorkout) async -> Bool {
        guard #available(iOS 18.0, *) else { return false }
        let score = HKQuantitySample(
            type: HKQuantityType(.workoutEffortScore),
            quantity: HKQuantity(unit: .appleEffortScore(), doubleValue: min(10, max(1, effort.rounded()))),
            start: workout.startDate,
            end: workout.endDate
        )
        do {
            try await health.relateWorkoutEffortSample(score, with: workout, activity: nil)
            return true
        } catch {
            return false
        }
    }

    /// Health's sync identifier and a version that only goes up, so a newer
    /// save replaces an older one with the same identifier.
    private static func identifier(_ name: String, _ call: CAPPluginCall) -> String {
        "\(call.getString("prefix") ?? "ovt").\(name)"
    }

    private static func sync(_ name: String, _ call: CAPPluginCall) -> [String: Any] {
        var metadata: [String: Any] = [
            HKMetadataKeySyncIdentifier: identifier(name, call),
            HKMetadataKeySyncVersion: NSNumber(value: Int64(Date().timeIntervalSince1970 * 1000))
        ]
        if let owner = call.getString("owner") { metadata["OTAthleteOwner"] = owner }
        return metadata
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static func day(_ key: String) -> Date? {
        dayFormatter.date(from: key)
    }

    /// Now for today, else noon of that day.
    private static func moment(on day: Date) -> Date {
        let calendar = Calendar.current
        if calendar.isDateInToday(day) { return Date() }
        return calendar.date(bySettingHour: 12, minute: 0, second: 0, of: day) ?? day
    }
}
