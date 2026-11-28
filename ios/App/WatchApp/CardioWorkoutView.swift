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
    private var measuredMeters: Double?
    @Published var problem: String?

    typealias Record = CardioProgress

    var isActive: Bool { starting || record != nil }
    var startDate: Date? { record?.start }
    var hasSavedRecord: Bool {
        guard let data = UserDefaults.standard.data(forKey: key),
              let saved = try? JSONDecoder().decode(Record.self, from: data) else { return false }
        return SessionStore.shared.isCurrentOwner(saved.owner)
    }

    func start(_ spec: RunSpec, rehearsal: RehearsalCourse? = nil) {
        let store = SessionStore.shared
        guard !isActive, !WorkoutManager.shared.blocksCardioStart, store.activeLift == nil, store.rehearsalAttempt == nil else { return }
        if let rehearsal, !rehearsal.valid || rehearsal.date != store.today?.date || store.athleteOwner == nil { return }
        guard !spec.orderedSteps.isEmpty, HKHealthStore.isHealthDataAvailable() else {
            problem = "Health or workout steps are unavailable."
            return
        }
        let token = generation
        let owner = SessionStore.shared.athleteOwner
        starting = true
        problem = nil
        var read: Set<HKObjectType> = [HKQuantityType(.heartRate), HKQuantityType(.activeEnergyBurned)]
        if let type = Self.distanceType(spec.healthActivity) { read.insert(type) }
        health.requestAuthorization(toShare: [HKObjectType.workoutType()], read: read) { _, _ in
            DispatchQueue.main.async {
                guard token == self.generation else { return }
                defer { self.starting = false }
                guard owner == store.athleteOwner else { return }
                guard store.activeLift == nil, store.rehearsalAttempt == nil, !WorkoutManager.shared.blocksCardioStart else { return }
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
                    if let rehearsal, let owner {
                        store.startRehearsal(rehearsal, owner: owner, at: now)
                        RehearsalTracker.shared.start()
                    }
                    if spec.sessionId == "climb:" + spec.id, UUID(uuidString: spec.id) != nil, spec.location == "indoor" {
                        self.record?.workoutID = spec.id
                        ClimbWrist.shared.invite = nil
                    } else {
                        self.record?.workoutID = rehearsal == nil ? UUID().uuidString : store.rehearsalAttempt?.id
                    }
                    self.persist()
                    session.startActivity(with: now)
                    builder.beginCollection(withStart: now) { _, error in
                        if error != nil { DispatchQueue.main.async { if self.session === session { self.problem = "Health could not start collecting workout measurements." } } }
                    }
                    var metadata: [String: Any] = ["OTPlanID": spec.id]
                    if let owner { metadata["OTAthleteOwner"] = owner }
                    metadata["OTCardioID"] = self.record?.workoutID
                    if spec.sessionId == "climb:" + spec.id, spec.location == "indoor" { metadata["OTClimbStartDay"] = spec.date }
                    if let id = spec.sessionId { metadata["OTSessionID"] = id }
                    builder.addMetadata(metadata) { _, _ in }
                    WatchLiftMirror.shared.start(session, cardio: true)
                } catch {
                    self.problem = "The workout could not start. Try again."
                }
            }
        }
    }

    func closeForAccountChange() {
        WatchLiftMirror.shared.stop(session: session)
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

    @discardableResult
    func restore(_ session: HKWorkoutSession) -> Bool {
        if self.session === session { return true }
        guard self.session == nil, session.state != .ended, let actualStart = session.startDate else { return false }
        let store = SessionStore.shared
        let metadata = session.associatedWorkoutBuilder().metadata
        let taggedOwner = metadata["OTAthleteOwner"] as? String
        let taggedID = metadata["OTCardioID"] as? String
        guard taggedOwner == nil || taggedOwner == store.athleteOwner else { return false }
        var saved: Record
        if let attempt = store.rehearsalAttempt, attempt.owner == store.athleteOwner, taggedID == nil || taggedID == attempt.id,
           session.workoutConfiguration.activityType == .running, abs(actualStart.timeIntervalSince(attempt.start)) < 2 {
            saved = Record(spec: attempt.course.run, start: attempt.start, index: 0, beganStep: attempt.start,
                           owner: attempt.owner, workoutID: attempt.id)
        } else {
            guard let data = UserDefaults.standard.data(forKey: key),
                  let existing = try? JSONDecoder().decode(Record.self, from: data),
                  store.isCurrentOwner(existing.owner), taggedID == nil || taggedID == existing.workoutID,
                  existing.spec.healthActivity == session.workoutConfiguration.activityType,
                  abs(actualStart.timeIntervalSince(existing.start)) < 2 else { return false }
            saved = existing
        }
        if saved.workoutID == nil { saved.workoutID = UUID().uuidString }
        record = saved
        persist()
        attach(session)
        if matchesRehearsal {
            RehearsalTracker.shared.start()
        } else if saved.spec.sessionId?.hasPrefix("rehearsal:") == true {
            finish()
            return true
        }
        if let builder {
            updateMetrics(builder, types: Set([HKQuantityType(.heartRate), Self.distanceType(saved.spec.healthActivity)].compactMap { $0 }))
        }
        WatchLiftMirror.shared.start(session, cardio: true)
        tick()
        return true
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

    var matchesRehearsal: Bool {
        guard let attempt = SessionStore.shared.rehearsalAttempt, let record else { return false }
        return attempt.owner == record.owner && record.spec.sessionId == "rehearsal:" + attempt.course.id && record.start == attempt.start
    }

    var canMirror: Bool { record != nil && !finishing }

    private static func distanceType(_ activity: HKWorkoutActivityType) -> HKQuantityType? {
        switch activity {
        case .running, .walking, .hiking: return HKQuantityType(.distanceWalkingRunning)
        case .cycling: return HKQuantityType(.distanceCycling)
        case .swimming: return HKQuantityType(.distanceSwimming)
        case .rowing:
            if #available(watchOS 11, *) { return HKQuantityType(.distanceRowing) }
            return nil
        case .crossCountrySkiing:
            if #available(watchOS 11, *) { return HKQuantityType(.distanceCrossCountrySkiing) }
            return nil
        default: return nil
        }
    }

    func mirrorSnapshot() -> LiftMirrorSnapshot? {
        guard canMirror, let record, let id = record.workoutID, let owner = SessionStore.shared.athleteOwner,
              record.owner == owner else { return nil }
        let attempt = matchesRehearsal ? SessionStore.shared.rehearsalAttempt : nil
        var cardio = CardioMirrorSnapshot(activity: record.spec.activity ?? "run",
            kind: attempt == nil ? "cardio" : "rehearsal", name: record.spec.name,
            distanceMeters: attempt?.distanceMeters ?? measuredMeters)
        if let attempt {
            let cp = attempt.atStop && !attempt.marks.isEmpty ? attempt.course.checkpoints[attempt.marks.count - 1] : attempt.next
            cardio.checkpointName = cp?.name
            cardio.checkpointMeters = cp?.meters
            cardio.checkpointTargetSeconds = cp?.targetSeconds
            cardio.checkpointInstruction = cp?.instruction
            cardio.atStation = attempt.atStop
        } else {
            let steps = record.spec.orderedSteps
            if steps.indices.contains(record.index) {
                let item = steps[record.index]
                cardio.stepLabel = item.label
                cardio.stepIndex = record.index + 1
                cardio.stepCount = steps.count
                cardio.stepStartedAt = record.beganStep.timeIntervalSince1970 * 1000
                cardio.stepTargetSeconds = item.step.goal.seconds
                cardio.stepTargetMeters = item.step.goal.meters
            }
        }
        let cursor = LiftMirrorCursor(owner: owner, workoutID: id, revision: id)
        return LiftMirrorSnapshot(cursor: cursor, title: record.spec.name, total: 0, fields: [], values: [:],
            heartRate: heartRate.map(Double.init), startedAt: record.start.timeIntervalSince1970 * 1000, cardio: cardio)
    }

    private func tick() {
        if matchesRehearsal { RehearsalTracker.shared.tick() }
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
        WatchLiftMirror.shared.stop(session: session)
        if matchesRehearsal {
            SessionStore.shared.finishRehearsal(at: Date())
            RehearsalTracker.shared.stop()
        }
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
        WatchLiftMirror.shared.stop(session: session)
        measuredMeters = nil
        if matchesRehearsal {
            SessionStore.shared.finishRehearsal(at: Date())
            RehearsalTracker.shared.stop()
        }
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

    func workoutSession(_ workoutSession: HKWorkoutSession, didReceiveDataFromRemoteWorkoutSession data: [Data]) {
        DispatchQueue.main.async { WatchLiftMirror.shared.receive(data, from: workoutSession) }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didDisconnectFromRemoteDeviceWithError error: Error?) {
        DispatchQueue.main.async { WatchLiftMirror.shared.disconnected(workoutSession) }
    }

    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf types: Set<HKSampleType>) {
        DispatchQueue.main.async {
            guard self.builder === workoutBuilder else { return }
            self.updateMetrics(workoutBuilder, types: types)
        }
    }

    private func updateMetrics(_ builder: HKLiveWorkoutBuilder, types: Set<HKSampleType>) {
        let hr = HKQuantityType(.heartRate)
        if types.contains(hr), let bpm = builder.statistics(for: hr)?.mostRecentQuantity()?.doubleValue(for: HKUnit.count().unitDivided(by: .minute())) {
            heartRate = Int(bpm.rounded())
        }
        if let activity = record?.spec.healthActivity, let distance = Self.distanceType(activity), types.contains(distance) {
            measuredMeters = builder.statistics(for: distance)?.sumQuantity()?.doubleValue(for: .meter())
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
                    if let id = record.workoutID, record.spec.sessionId == "climb:" + id {
                        ClimbWristMetrics(recording: id)
                    } else if steps.indices.contains(record.index) {
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
