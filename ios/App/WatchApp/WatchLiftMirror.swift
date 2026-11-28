import Combine
import Foundation
import HealthKit

/// The primary session stays on the Watch, including when its companion is offline.
final class WatchLiftMirror {
    static let shared = WatchLiftMirror()
    static let editApplied = Notification.Name("OTMirrorEditApplied")
    var liveReps: Int? { didSet { if oldValue != liveReps { scheduleSnapshot() } } }

    private struct WristDraft {
        var cursor: LiftMirrorCursor
        var revision: String
        var values: [String: Double]
    }
    private var draft: WristDraft?
    private weak var session: HKWorkoutSession?
    private var timer: Timer?
    private var observation: AnyCancellable?
    private var queued: DispatchWorkItem?
    private var cardio = false
    private var linked = false
    private var connecting = false
    private var nextAttempt = Date.distantPast
    private var retryDelay: TimeInterval = 4
    private var previousReceipt: LiftMirrorPacket?

    func start(_ session: HKWorkoutSession, cardio: Bool = false) {
        stop()
        self.session = session
        self.cardio = cardio
        guard SessionStore.shared.athleteOwner != nil, cardio || SessionStore.shared.activeLift != nil else { return }
        let journalChanges = SessionStore.shared.objectWillChange.eraseToAnyPublisher()
        let changes = cardio ? journalChanges.merge(with: CardioWorkoutManager.shared.objectWillChange).eraseToAnyPublisher() : journalChanges
        observation = changes.sink { [weak self] _ in self?.scheduleSnapshot() }
        timer = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { [weak self] _ in self?.tick() }
        tick()
    }

    func stop() {
        queued?.cancel()
        queued = nil
        observation = nil
        timer?.invalidate()
        timer = nil
        session = nil
        linked = false
        connecting = false
        nextAttempt = .distantPast
        retryDelay = 4
        previousReceipt = nil
        draft = nil
        liveReps = nil
    }

    func stop(session remote: HKWorkoutSession?) {
        if let remote, session === remote { stop() }
    }

    func disconnected(_ remote: HKWorkoutSession) {
        guard session === remote else { return }
        linked = false
        nextAttempt = Date().addingTimeInterval(retryDelay)
        retryDelay = min(retryDelay * 2, 60)
    }

    private func tick() {
        guard let session, cardio ? CardioWorkoutManager.shared.canMirror : WorkoutManager.shared.phase == .running else { return }
        if linked {
            sendSnapshot()
        } else if !connecting && Date() >= nextAttempt {
            connecting = true
            session.startMirroringToCompanionDevice { [weak self, weak session] success, _ in
                DispatchQueue.main.async {
                    guard let self, let session, self.session === session else { return }
                    self.connecting = false
                    if success {
                        self.linked = true
                        self.retryDelay = 4
                        self.sendSnapshot()
                    } else {
                        self.disconnected(session)
                    }
                }
            }
        }
    }

    private func scheduleSnapshot() {
        guard linked, queued == nil else { return }
        let work = DispatchWorkItem { [weak self] in
            self?.queued = nil
            self?.sendSnapshot()
        }
        queued = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
    }

    /// The crown edits the visible set before Log is tapped. Scope that draft
    /// to the durable revision, so a remote edit cannot overwrite a newer one.
    func updateDraft(for key: ExerciseKey, index: Int, edits: [String: Double]) {
        guard let state = makeSnapshot(includeDraft: false),
              state.cursor.section == key.session, state.cursor.exercise == key.name,
              state.cursor.index == index else { return }
        let visible = edits.filter { edit in state.fields.contains { $0.prop == edit.key } }
        guard !visible.isEmpty else { clearDraft(for: key); return }
        if draft?.cursor == state.cursor && draft?.values == visible { return }
        draft = WristDraft(cursor: state.cursor, revision: UUID().uuidString, values: visible)
        scheduleSnapshot()
    }

    func clearDraft(for key: ExerciseKey) {
        guard draft?.cursor.section == key.session, draft?.cursor.exercise == key.name else { return }
        draft = nil
        scheduleSnapshot()
    }

    private func makeSnapshot(includeDraft: Bool = true) -> LiftMirrorSnapshot? {
        if cardio { return CardioWorkoutManager.shared.mirrorSnapshot() }
        let store = SessionStore.shared
        guard WorkoutManager.shared.phase == .running, let lift = store.activeLift, let owner = store.athleteOwner,
              lift.plan.owner == nil || lift.plan.owner == owner else { return nil }
        let plan = lift.plan
        let key = lift.exercise.flatMap { plan.exercise($0)?.skipped != true && store.nextOpenSet(for: $0) != nil ? $0 : nil }
            ?? plan.keys.first { plan.exercise($0)?.skipped != true && store.nextOpenSet(for: $0) != nil }
        let exercise = key.flatMap(plan.exercise)
        let current = key.flatMap(store.nextOpenSet)
        let following = key.flatMap { store.supersetTransition(after: $0)?.next ?? store.nextExercise(after: $0) }
        var cursor = LiftMirrorCursor(owner: owner, workoutID: lift.id, revision: lift.mirrorRevision ?? lift.id,
                                      section: key?.session, exercise: key?.name, index: current?.index, lastSetID: store.lastWatchSet?.id)
        var values = current?.values ?? [:]
        if includeDraft, let draft, draft.cursor == cursor {
            values.merge(draft.values) { _, edited in edited }
            cursor.revision = draft.revision
        }
        let fields = (exercise?.fields ?? []).map {
            LiftMirrorField(prop: $0.prop, label: $0.label, unit: $0.unit, max: $0.max, step: $0.step, required: $0.required)
        }
        return LiftMirrorSnapshot(cursor: cursor, title: plan.title ?? "Lifting", display: exercise?.display,
                                  total: exercise?.sets.count ?? 0, fields: fields, values: values,
                                  next: following.flatMap(plan.exercise)?.display, heartRate: WorkoutManager.shared.heartRate,
                                  restUntil: store.rest.map { $0.endsAt.timeIntervalSince1970 * 1000 },
                                  liveReps: liveReps, startedAt: lift.startedAt.timeIntervalSince1970 * 1000)
    }

    private func send(_ packet: LiftMirrorPacket) {
        guard let session, let data = packet.encode() else { return }
        session.sendToRemoteWorkoutSession(data: data) { [weak self, weak session] success, _ in
            guard !success else { return }
            DispatchQueue.main.async { if let session { self?.disconnected(session) } }
        }
    }

    private func sendSnapshot() {
        if let state = makeSnapshot() { send(LiftMirrorPacket(kind: .state, state: state)) }
    }

    func receive(_ packets: [Data], from remote: HKWorkoutSession) {
        guard session === remote, cardio ? CardioWorkoutManager.shared.canMirror : WorkoutManager.shared.phase == .running else { return }
        linked = true
        retryDelay = 4
        for data in packets {
            guard let packet = LiftMirrorPacket.decode(data) else { continue }
            switch packet.kind {
            case .hello: sendSnapshot()
            case .command:
                guard let command = packet.command, let state = makeSnapshot(),
                      command.cursor.owner == state.cursor.owner, command.cursor.workoutID == state.cursor.workoutID else { continue }
                if let previousReceipt, previousReceipt.requestID == command.id {
                    send(previousReceipt)
                    continue
                }
                let applied = command.valid(for: state) && apply(command)
                let receipt = LiftMirrorPacket(kind: .receipt, state: makeSnapshot(), requestID: command.id, accepted: applied)
                previousReceipt = receipt
                send(receipt)
            default: break
            }
        }
    }

    private func apply(_ command: LiftMirrorCommand) -> Bool {
        let store = SessionStore.shared
        var focus: ExerciseKey?
        if command.action == .undo {
            focus = store.undoLastWatchSet()
            guard let focus else { return false }
            store.rememberExercise(focus)
        } else {
            guard let section = command.cursor.section, let name = command.cursor.exercise, let index = command.cursor.index else { return false }
            let key = ExerciseKey(session: section, name: name)
            guard let exercise = store.today?.exercise(key) else { return false }
            let values = command.values.filter { $0.value > 0 || $0.key == "assistance" }
            focus = key
            if command.action == .setTarget {
                guard store.setNextMirrorTarget(key, index: index, values: values) else { return false }
            } else {
                guard store.logSet(key, setIndex: index, values: values) != nil else { return false }
                store.endRest()
                if !store.allLogged {
                    let pair = store.supersetTransition(after: key)
                    focus = pair?.next ?? (store.nextOpenSet(for: key) != nil ? key : store.nextExercise(after: key))
                    if let focus {
                        store.rememberExercise(focus)
                        if pair?.rest != false {
                            let next = store.today?.exercise(focus)?.display ?? focus.name
                            store.startRest(seconds: exercise.restSeconds, next: "Next: " + next)
                        }
                    }
                }
            }
        }
        if let focus { NotificationCenter.default.post(name: Self.editApplied, object: focus) }
        return true
    }
}
