import Foundation
import HealthKit

struct WorkoutSummary {
    var startedAt: Date
    var endedAt: Date
    var averageHeartRate: Double?
    var activeEnergy: Double?
}

/// A strength workout in HealthKit. While it runs the watch tracks heart rate
/// and energy, the app keeps running with the wrist down (so rest taps land on
/// time), and at the end the workout is saved to Health and Fitness.
final class WorkoutManager: NSObject, ObservableObject {
    enum Phase: Equatable {
        case idle, starting, running, ending
    }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var startDate: Date?
    @Published private(set) var heartRate: Double?
    @Published var problem: String?

    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var averageHeartRate: Double?
    private var activeEnergy: Double?
    private var onEnded: ((WorkoutSummary) -> Void)?

    private var shareTypes: Set<HKSampleType> { [HKObjectType.workoutType()] }
    private var readTypes: Set<HKObjectType> {
        [HKQuantityType(.heartRate), HKQuantityType(.activeEnergyBurned), HKObjectType.workoutType()]
    }

    /// Whether workouts can be saved, which starting one needs.
    var canSave: Bool {
        HKHealthStore.isHealthDataAvailable()
            && healthStore.authorizationStatus(for: HKObjectType.workoutType()) == .sharingAuthorized
    }

    /// Asks for Health access the first time, then starts.
    func start() {
        guard phase == .idle else { return }
        guard HKHealthStore.isHealthDataAvailable() else {
            problem = "Health isn't available on this watch."
            return
        }
        problem = nil
        phase = .starting
        healthStore.requestAuthorization(toShare: shareTypes, read: readTypes) { [weak self] _, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                guard self.canSave else {
                    self.phase = .idle
                    self.problem = "To track workouts, allow 0VERTRAINED in the Health app on your iPhone, under Sharing > Apps."
                    return
                }
                self.begin()
            }
        }
    }

    /// Starts without asking, if Health access was already given. Logging a
    /// set calls this so rest taps work even if Start was skipped.
    func startIfAllowed() {
        guard phase == .idle, canSave else { return }
        begin()
    }

    func end(then completion: @escaping (WorkoutSummary) -> Void) {
        guard phase == .running, let session else { return }
        phase = .ending
        onEnded = completion
        session.end()
    }

    private func begin() {
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .traditionalStrengthTraining
        configuration.locationType = .indoor
        do {
            let session = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: configuration)
            session.delegate = self
            builder.delegate = self
            self.session = session
            self.builder = builder

            let start = Date()
            session.startActivity(with: start)
            builder.beginCollection(withStart: start) { [weak self] _, error in
                guard error != nil else { return }
                DispatchQueue.main.async { self?.problem = "Heart rate isn't being recorded for this workout." }
            }
            startDate = start
            phase = .running
        } catch {
            phase = .idle
            problem = "The workout couldn't start. Try again."
        }
    }

    private func finished(at date: Date) {
        let summary = WorkoutSummary(
            startedAt: startDate ?? date,
            endedAt: date,
            averageHeartRate: averageHeartRate,
            activeEnergy: activeEnergy
        )
        session = nil
        builder = nil
        startDate = nil
        heartRate = nil
        averageHeartRate = nil
        activeEnergy = nil
        phase = .idle
        let completion = onEnded
        onEnded = nil
        completion?(summary)
    }

    private func update(_ statistics: HKStatistics) {
        switch statistics.quantityType {
        case HKQuantityType(.heartRate):
            let perMinute = HKUnit.count().unitDivided(by: HKUnit.minute())
            heartRate = statistics.mostRecentQuantity()?.doubleValue(for: perMinute)
            averageHeartRate = statistics.averageQuantity()?.doubleValue(for: perMinute)
        case HKQuantityType(.activeEnergyBurned):
            activeEnergy = statistics.sumQuantity()?.doubleValue(for: HKUnit.kilocalorie())
        default:
            break
        }
    }
}

extension WorkoutManager: HKWorkoutSessionDelegate {
    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
        guard toState == .ended, let builder else { return }
        builder.endCollection(withEnd: date) { _, _ in
            builder.finishWorkout { _, _ in
                DispatchQueue.main.async { self.finished(at: date) }
            }
        }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        DispatchQueue.main.async {
            self.problem = "The workout stopped unexpectedly."
            if self.phase == .running || self.phase == .ending {
                self.finished(at: Date())
            }
        }
    }
}

extension WorkoutManager: HKLiveWorkoutBuilderDelegate {
    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        for type in collectedTypes {
            guard let quantityType = type as? HKQuantityType,
                  let statistics = workoutBuilder.statistics(for: quantityType) else { continue }
            DispatchQueue.main.async { self.update(statistics) }
        }
    }
}
