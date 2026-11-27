import Foundation
import SwiftUI
import WatchKit
import HealthKit

/// The in-app route for equipment or goals the system Workout app cannot run.
final class CardioWorkoutManager: NSObject, ObservableObject, HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
    static let shared = CardioWorkoutManager()
    private let health = HKHealthStore()
    private let key = "ot.cardio.active.v1"
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var timer: Timer?
    private var generation = 0
    @Published private(set) var starting = false
    @Published private(set) var finishing = false
    @Published private(set) var record: Record?
    @Published private(set) var heartRate: Int?
    @Published var problem: String?

    typealias Record = CardioProgress

    var isActive: Bool { starting || record != nil }
    var startDate: Date? { record?.start }

    func start(_ spec: RunSpec) {
        guard !isActive, WorkoutManager.shared.phase == .idle else { return }
        guard !spec.orderedSteps.isEmpty, HKHealthStore.isHealthDataAvailable() else {
            problem = "Health or workout steps are unavailable."
            return
        }
        let token = generation
        let owner = SessionStore.shared.athleteOwner
        starting = true
        problem = nil
        health.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [HKQuantityType(.heartRate), HKQuantityType(.activeEnergyBurned)]) { _, _ in
            DispatchQueue.main.async {
                guard token == self.generation else { return }
                defer { self.starting = false }
                guard self.health.authorizationStatus(for: HKObjectType.workoutType()) == .sharingAuthorized else {
                    self.problem = "Allow workout access in Health, then try again."
                    return
                }
                let config = HKWorkoutConfiguration()
                config.activityType = spec.healthActivity
                config.locationType = spec.healthLocation
                do {
                    let session = try HKWorkoutSession(healthStore: self.health, configuration: config)
                    let builder = session.associatedWorkoutBuilder()
                    builder.dataSource = HKLiveWorkoutDataSource(healthStore: self.health, workoutConfiguration: config)
                    self.attach(session)
                    let now = Date()
                    self.record = Record(spec: spec, start: now, index: 0, beganStep: now, owner: owner)
                    self.persist()
                    session.startActivity(with: now)
                    builder.beginCollection(withStart: now) { _, error in
                        if error != nil { DispatchQueue.main.async { self.problem = "Health could not start collecting workout measurements." } }
                    }
                    var metadata: [String: Any] = ["OTPlanID": spec.id]
                    if let owner { metadata["OTAthleteOwner"] = owner }
                    if let id = spec.sessionId { metadata["OTSessionID"] = id }
                    builder.addMetadata(metadata) { _, _ in }
                } catch {
                    self.problem = "The workout could not start. Try again."
                }
            }
        }
    }

    func closeForAccountChange() {
        generation += 1
        starting = false
        problem = nil
        if let session, let builder {
            // Save the original athlete's Health workout. Its metadata captured
            // that athlete at start, and no callback can present it to the next.
            session.delegate = nil
            builder.delegate = nil
            if session.state != .ended {
                session.end()
                builder.endCollection(withEnd: Date()) { _, _ in builder.finishWorkout { _, _ in } }
            }
        }
        clear(nil)
    }

    func restore(_ session: HKWorkoutSession) {
        guard let data = UserDefaults.standard.data(forKey: key),
              let saved = try? JSONDecoder().decode(Record.self, from: data),
              saved.owner == nil || saved.owner == SessionStore.shared.athleteOwner,
              saved.spec.healthActivity == session.workoutConfiguration.activityType,
              let actualStart = session.startDate, abs(actualStart.timeIntervalSince(saved.start)) < 5 else { return }
        record = saved
        attach(session)
        tick()
    }

    private func attach(_ session: HKWorkoutSession) {
        self.session = session
        builder = session.associatedWorkoutBuilder()
        session.delegate = self
        builder?.delegate = self
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
    }

    private func persist() {
        if let record, let data = try? JSONEncoder().encode(record) { UserDefaults.standard.set(data, forKey: key) }
        else { UserDefaults.standard.removeObject(forKey: key) }
    }

    private func tick() {
        guard !finishing, var active = record, active.catchUp(at: Date()) else { return }
        record = active
        persist()
        WKInterfaceDevice.current().play(.notification)
    }

    func advance() {
        guard !finishing, var active = record, active.next(at: Date()) else { return }
        record = active
        persist()
    }

    func finish() {
        guard let session, !finishing else { return }
        tick()
        finishing = true
        if let record, let builder {
            let segments = record.segments(until: Date())
            if let data = try? JSONSerialization.data(withJSONObject: segments), let json = String(data: data, encoding: .utf8) {
                builder.addMetadata(["OTCardioSteps": json]) { _, _ in session.end() }
                return
            }
        }
        session.end()
    }

    private func clear(_ error: Error?) {
        timer?.invalidate()
        timer = nil
        session = nil
        builder = nil
        record = nil
        finishing = false
        heartRate = nil
        persist()
        if error != nil { problem = "The workout ended, but Health could not confirm the save." }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from oldState: HKWorkoutSessionState, date: Date) {
        guard workoutSession === session, toState == .ended, let builder else { return }
        builder.endCollection(withEnd: date) { _, error in
            guard error == nil else { DispatchQueue.main.async { if self.session === workoutSession { self.clear(error) } }; return }
            builder.finishWorkout { _, error in DispatchQueue.main.async { if self.session === workoutSession { self.clear(error) } } }
        }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        DispatchQueue.main.async { if self.session === workoutSession { self.clear(error) } }
    }

    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf types: Set<HKSampleType>) {
        let hr = HKQuantityType(.heartRate)
        if types.contains(hr), let bpm = workoutBuilder.statistics(for: hr)?.mostRecentQuantity()?.doubleValue(for: HKUnit.count().unitDivided(by: .minute())) {
            DispatchQueue.main.async { self.heartRate = Int(bpm.rounded()) }
        }
    }
}

struct CardioWorkoutView: View {
    @ObservedObject private var manager = CardioWorkoutManager.shared
    @State private var confirmEnd = false
    var body: some View {
        ScrollView {
            if let record = manager.record {
                let steps = record.spec.orderedSteps
                VStack(spacing: 8) {
                    Text(record.spec.name).font(.headline)
                    if steps.indices.contains(record.index) {
                        let item = steps[record.index]
                        Text("\(item.label) · \(record.index + 1) of \(steps.count)")
                        if item.step.goal.kind == "time", let seconds = item.step.goal.seconds {
                            let end = record.beganStep.addingTimeInterval(seconds)
                            Text(timerInterval: min(Date(), end)...end, countsDown: true).font(.title).monospacedDigit()
                        } else {
                            if let meters = item.step.goal.meters { Text("\(Int(meters)) m") }
                            Text(record.beganStep, style: .timer).monospacedDigit()
                        }
                        if let zone = item.step.alert?.zone { Text("Aim for heart rate zone \(zone)").font(.footnote) }
                        Button("Next step") { manager.advance() }
                    } else {
                        Text("Planned steps complete").foregroundStyle(Ledger.good)
                    }
                    if let bpm = manager.heartRate { Text("\(bpm) bpm").monospacedDigit() }
                    Text(record.start, style: .timer).font(.footnote)
                    Button(manager.finishing ? "Saving…" : "Finish cardio") { confirmEnd = true }
                        .disabled(manager.finishing)
                }
            } else if manager.starting { ProgressView("Starting workout") }
        }
        .confirmationDialog("Finish and save this workout?", isPresented: $confirmEnd) {
            Button("Finish workout") { manager.finish() }
        }
    }
}
