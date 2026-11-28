import Foundation
import WatchConnectivity
import WatchKit
import WidgetKit

/// The week's plans from the phone, the sets logged here that the phone
/// hasn't confirmed yet, and the rest timer. Today's plan is the one for the
/// watch's date, so a new day starts at midnight without the phone.
///
/// Sets go to the phone with transferUserInfo, which the system queues and
/// delivers when it can, so logging works with the phone out of reach or the
/// phone app closed. The phone writes them into the log and sends the plan
/// back with them done; until then they show here from `pending`.
final class SessionStore: NSObject, ObservableObject {
    static let shared = SessionStore()

    @Published private(set) var week: WatchWeek?
    /// The date today's plan is for; moves on at midnight.
    @Published private(set) var dayKey = SessionStore.dateKey(Date())
    @Published private var journal = LiftJournal()
    typealias Rest = LiftJournal.Rest
    var rest: Rest? { journal.rest }
    var pending: [PendingSet] { journal.pending }
    var athleteOwner: String? { week?.owner }
    func isCurrentOwner(_ owner: String?) -> Bool {
        owner == athleteOwner || (owner == nil && athleteOwner == defaults.string(forKey: Key.legacyOwner))
    }
    var activeLift: LiftJournal.Session? { journal.active }
    var rehearsalAttempt: RehearsalAttempt? { journal.rehearsal }

    func startRehearsal(_ course: RehearsalCourse, owner: String, at now: Date) {
        guard athleteOwner == owner, journal.active == nil, journal.rehearsal == nil, course.valid else { return }
        journal.rehearsal = RehearsalAttempt(owner: owner, course: course, start: now)
        persist()
    }

    func editRehearsal(_ edit: (inout RehearsalAttempt) -> Void) {
        guard var attempt = journal.rehearsal, attempt.owner == athleteOwner else { return }
        let original = attempt
        edit(&attempt)
        guard original != attempt else { return }
        journal.rehearsal = attempt
        persist()
    }

    /// Clearing the attempt and queueing its terminal event are one journal write.
    func finishRehearsal(at end: Date) {
        guard journal.finishRehearsal(owner: athleteOwner, at: end) else { return }
        persist()
        flush()
    }
    var unsyncedCount: Int { journal.outbox.count }

    private enum Key {
        static let week = "ovt.week"
        static let plan = "ovt.plan"
        static let pending = "ovt.pending"
        static let outbox = "ovt.outbox"
        static let journal = "ovt.liftJournal.v1"
        static let legacyOwner = "ovt.liftJournal.firstAthlete"
    }
    private let defaults = UserDefaults.standard
    private var inFlight: Set<String> = []
    private var retry: DispatchWorkItem?
    private var restWork: DispatchWorkItem?
    private let timestamp: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private override init() {
        super.init()
        restore()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
        NotificationCenter.default.addObserver(self, selector: #selector(calendarDayChanged), name: .NSCalendarDayChanged, object: nil)
    }

    @objc private func calendarDayChanged() {
        DispatchQueue.main.async { self.refreshDay() }
    }

    /// Moves to the new day's plan once the date changes. Called at midnight
    /// and whenever the app comes to the front.
    func refreshDay() {
        let key = Self.dateKey(Date())
        if key != dayKey { dayKey = key }
        if let rest, rest.endsAt <= Date() { endRest() }
        flush()
    }

    var today: WatchPlan? { journal.day(Self.dateKey(Date()), week: week) }

    func beginLift(at now: Date = Date()) {
        guard journal.rehearsal == nil, journal.active == nil, let plan = today, !plan.sessions.isEmpty else { return }
        journal.begin(plan, at: now)
        persist()
    }

    func beginHealthLift(at start: Date) -> String? {
        beginLift(at: start)
        guard var active = journal.active else { return nil }
        active.healthStartedAt = start
        journal.active = active
        persist()
        return active.id
    }

    func commitGymEdit<Event: Encodable>(_ event: Event, undoing id: String? = nil, _ mutate: (inout WatchPlan) -> Void) {
        beginLift()
        guard var session = journal.active else { return }
        mutate(&session.plan)
        session.mirrorRevision = UUID().uuidString
        journal.active = session
        if let id { journal.pending.removeAll { $0.id == id } }
        send(event)
    }

    /// The local calendar day, written as the phone writes it: 2026-11-26.
    static func dateKey(_ date: Date) -> String {
        dayFormatter.string(from: date)
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.autoupdatingCurrent
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    func sets(for key: ExerciseKey) -> [SetState] {
        guard let exercise = today?.exercise(key) else { return [] }
        var states: [SetState] = []
        for (index, set) in exercise.sets.enumerated() {
            if set.done {
                states.append(SetState(index: index, done: true, values: set.values, sourceLabel: nil))
            } else if let local = journal.pendingSet(on: today?.date ?? dayKey, key: key, index: index) {
                states.append(SetState(index: index, done: true, values: local.values, sourceLabel: nil))
            } else if set.source != "target", let previous = states.last, previous.done, !previous.values.isEmpty {
                // Unless the target fills it, a set follows the one before
                // it, as on the phone, including a set logged here.
                states.append(SetState(index: index, done: false, values: previous.values, sourceLabel: "Set \(index)"))
            } else {
                states.append(SetState(index: index, done: false, values: set.values, sourceLabel: set.sourceLabel))
            }
        }
        return states
    }

    func nextOpenSet(for key: ExerciseKey) -> SetState? {
        sets(for: key).first { !$0.done }
    }

    func rememberExercise(_ key: ExerciseKey) {
        guard var active = journal.active, active.exercise != key, active.plan.exercise(key) != nil else { return }
        active.exercise = key
        journal.active = active
        persist()
    }

    /// The next exercise with a set left, in program order, after this one.
    func nextExercise(after key: ExerciseKey) -> ExerciseKey? {
        guard let plan = today else { return nil }
        let keys = plan.keys
        guard let start = keys.firstIndex(of: key) else { return nil }
        let ordered = Array(keys[(start + 1)...]) + Array(keys[..<start])
        return ordered.first { candidate in
            guard let exercise = plan.exercise(candidate), exercise.skipped != true else { return false }
            return nextOpenSet(for: candidate) != nil
        }
    }

    /// Every exercise is logged or skipped.
    var allLogged: Bool {
        guard let plan = today else { return false }
        return plan.keys.allSatisfy { key in
            plan.exercise(key)?.skipped == true || nextOpenSet(for: key) == nil
        }
    }

    // MARK: - Logging

    @discardableResult
    func logSet(_ key: ExerciseKey, setIndex: Int, values: [String: Double]) -> String? {
        beginLift()
        guard var session = journal.active,
              let section = session.plan.sessions.firstIndex(where: { $0.id == key.session }),
              let row = session.plan.sessions[section].exercises.firstIndex(where: { $0.name == key.name }) else { return nil }
        var exercise = session.plan.sessions[section].exercises[row]
        guard exercise.sets.indices.contains(setIndex), !exercise.sets[setIndex].done else { return nil }
        let id = UUID().uuidString
        let now = Date()
        let at = timestamp.string(from: now)
        exercise.sets[setIndex].done = true
        exercise.sets[setIndex].values = values
        exercise.sets[setIndex].watchEventID = id
        exercise.sets[setIndex].completedAt = at
        session.plan.sessions[section].exercises[row] = exercise
        session.exercise = key
        session.mirrorRevision = id
        journal.active = session
        journal.pending.append(PendingSet(id: id, date: session.plan.date, session: key.session, exercise: key.name,
                                         setIndex: setIndex, values: values, loggedAt: now))
        send(SetEvent(id: id, date: session.plan.date, session: key.session, exercise: key.name,
                      setIndex: setIndex, values: values, at: at, performedName: exercise.display))
        return id
    }

    /// A bench-display edit is a target until the athlete logs the set.
    func setNextMirrorTarget(_ key: ExerciseKey, index: Int, values: [String: Double]) -> Bool {
        guard var lift = journal.active, nextOpenSet(for: key)?.index == index else { return false }
        lift.plan.mutateExercise(key) { exercise in
            exercise.sets[index].values = values
            exercise.sets[index].source = "target"
            exercise.sets[index].sourceLabel = "Bench display"
        }
        lift.mirrorRevision = UUID().uuidString
        lift.exercise = key
        journal.active = lift
        persist()
        return true
    }

    func finish(_ summary: WorkoutSummary) {
        guard let session = journal.active else { return }
        let finish = FinishEvent(id: session.id, date: session.plan.date, at: timestamp.string(from: summary.endedAt),
            startedAt: timestamp.string(from: session.startedAt),
            durationSeconds: max(0, Int(summary.endedAt.timeIntervalSince(session.startedAt))),
            averageHeartRate: summary.averageHeartRate, activeEnergy: summary.activeEnergy)
        enqueue(finish)
        journal.close(at: summary.endedAt)
        restWork?.cancel()
        persist()
        flush()
    }

    func finishWithoutHealth() {
        guard let session = journal.active else { return }
        finish(WorkoutSummary(startedAt: session.startedAt, endedAt: Date(), averageHeartRate: nil, activeEnergy: nil))
    }

    private func enqueue<Event: Encodable>(_ event: Event) {
        guard let raw = try? JSONEncoder().encode(event),
              var object = try? JSONSerialization.jsonObject(with: raw) as? [String: Any] else { return }
        if let session = journal.active {
            object["owner"] = session.plan.owner ?? athleteOwner
            object["workoutID"] = session.id
            // Keep the exercise identity and input types, even when the athlete
            // edits their phone program before this workout reconnects.
            let sessions = session.plan.sessions.map { section -> [String: Any] in
                let exercises = section.exercises.map { ex -> [String: Any] in
                    ["name": ex.name, "display": ex.display, "count": ex.sets.count, "reps": ex.sets.first?.values["reps"] ?? 8, "fields": ex.fields.map(\.prop),
                     "swaps": (ex.swaps ?? []).map(\.name), "pairNext": ex.pairNext ?? false, "targetRir": ex.targetRir ?? ""]
                }
                return ["id": section.id, "title": section.title, "exercises": exercises]
            }
            object["offlinePlan"] = ["title": session.plan.title ?? "Lifting", "sessions": sessions] as [String: Any]
        }
        if let data = try? JSONSerialization.data(withJSONObject: object), let json = String(data: data, encoding: .utf8) {
            journal.outbox.append(json)
        }
    }

    func send<Event: Encodable>(_ event: Event) {
        enqueue(event)
        persist()
        flush()
    }

    private func journalKey(for owner: String?) -> String { owner.map { Key.journal + ".athlete." + $0 } ?? Key.journal }

    private func storedJournal(for owner: String?) -> LiftJournal? {
        guard let data = defaults.data(forKey: journalKey(for: owner)) else { return nil }
        return try? JSONDecoder().decode(LiftJournal.self, from: data)
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(journal) { defaults.set(data, forKey: journalKey(for: athleteOwner)) }
    }

    private func flush() {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated,
              !journal.outbox.isEmpty, inFlight.isEmpty else { return }
        let wc = WCSession.default
        if wc.receivedApplicationContext["journalVersion"] as? Int == 1 {
            // One ordered batch at a time. Never retire it on transport success:
            // the iPhone acknowledges after its workout log has accepted the edits.
            var bytes = 0
            let batch = journal.outbox.prefix { raw in
                bytes += raw.utf8.count
                return bytes <= 40_000
            }
            let events = batch.isEmpty ? [journal.outbox[0]] : Array(batch)
            inFlight = Set(events.compactMap(LiftJournal.eventID))
            if let first = events.first, first.utf8.count > 40_000, let id = LiftJournal.eventID(first) {
                if !wc.outstandingFileTransfers.contains(where: { $0.file.metadata?["batchID"] as? String == id }) {
                    let url = FileManager.default.temporaryDirectory.appendingPathComponent("lift-" + UUID().uuidString)
                    do {
                        try JSONEncoder().encode(events).write(to: url, options: .atomic)
                        wc.transferFile(url, metadata: ["batchID": id])
                    } catch { inFlight.removeAll() }
                }
            } else if !wc.outstandingUserInfoTransfers.contains(where: { ($0.userInfo["events"] as? [String]) == events }) {
                wc.transferUserInfo(["events": events])
            }
        } else {
            let existing = Set(wc.outstandingUserInfoTransfers.compactMap { $0.userInfo["event"] as? String })
            for raw in journal.outbox where !existing.contains(raw) { wc.transferUserInfo(["event": raw]) }
            inFlight = Set(journal.outbox.compactMap(LiftJournal.eventID))
        }
        retry?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.inFlight.removeAll()
            self?.flush()
        }
        retry = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 90, execute: work)
    }

    private func confirmed(_ ids: Set<String>) {
        guard !ids.isEmpty else { return }
        journal.acknowledge(ids)
        inFlight.subtract(ids)
        persist()
        flush()
    }

    // MARK: - Rest

    func startRest(seconds: Int, next: String?) {
        journal.rest = Rest(endsAt: Date().addingTimeInterval(TimeInterval(seconds)), seconds: seconds, next: next)
        persist()
        scheduleRestEnd()
    }

    func addRest(_ seconds: Int) {
        guard var current = rest else { return }
        current.endsAt.addTimeInterval(TimeInterval(seconds))
        current.seconds += seconds
        journal.rest = current
        persist()
        scheduleRestEnd()
    }

    func endRest() {
        restWork?.cancel()
        restWork = nil
        journal.rest = nil
        persist()
    }

    /// While a workout is running the app keeps running with the wrist down,
    /// so this tap lands on time.
    private func scheduleRestEnd() {
        restWork?.cancel()
        guard let rest else { return }
        let work = DispatchWorkItem { [weak self] in
            WKInterfaceDevice.current().play(.notification)
            self?.endRest()
        }
        restWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0, rest.endsAt.timeIntervalSinceNow), execute: work)
    }

    // MARK: - Storage

    private func receive(_ context: [String: Any]) {
        let incoming: WatchWeek
        if let packed = context["week"] as? Data,
           let json = Self.unpack(packed),
           let decoded = try? JSONDecoder().decode(WatchWeek.self, from: json) {
            incoming = decoded
        } else if let json = context["plan"] as? String, let data = json.data(using: .utf8) {
            // An iPhone app from before compression sends plain JSON: a week,
            // or from before weeks, one day.
            if let decoded = try? JSONDecoder().decode(WatchWeek.self, from: data), !decoded.days.isEmpty {
                incoming = decoded
            } else if let plan = try? JSONDecoder().decode(WatchPlan.self, from: data) {
                incoming = Self.singleDay(plan)
            } else {
                return
            }
        } else {
            return
        }
        if let had = week?.sentAt, let got = incoming.sentAt, got < had { return }
        // Once the phone sends scoped plans, an older unscoped transfer must
        // never replace an athlete's current week.
        if athleteOwner != nil && incoming.owner == nil { return }
        if let next = incoming.owner, next != athleteOwner {
            if defaults.string(forKey: Key.legacyOwner) == nil { defaults.set(next, forKey: Key.legacyOwner) }
            if athleteOwner != nil {
                RehearsalTracker.shared.stop()
                finishRehearsal(at: Date())
                WorkoutManager.shared.endForAccountChange()
                CardioWorkoutManager.shared.closeForAccountChange()
                persist()
                journal = storedJournal(for: next) ?? LiftJournal()
            } else if let saved = storedJournal(for: next) {
                journal = saved
            } else if next != defaults.string(forKey: Key.legacyOwner) {
                journal = LiftJournal()
            } else {
                journal.active?.plan.owner = next
                journal.lastFinish?.plan.owner = next
            }
            restWork?.cancel()
            retry?.cancel()
            inFlight.removeAll()
        }
        week = incoming
        if let data = try? JSONEncoder().encode(incoming) {
            defaults.set(data, forKey: Key.week)
        }
        journal.receive(incoming, calendarDay: dayKey)
        confirmed(Set(incoming.seen ?? []))
        persist()
        Self.saveCards(incoming)
        flush()
    }

    // MARK: - The watch face

    /// The week as day cards for the complication (WatchWidgets), which
    /// reloads when they change.
    private static func saveCards(_ week: WatchWeek) {
        let cards = week.days.map(card)
        if DayCards.save(cards) {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    private static func card(_ day: WatchPlan) -> DayCard {
        let exercises = day.sessions.reduce(0) { $0 + $1.exercises.count }
        let runs = day.cardioWorkouts
        var parts: [String] = []
        if exercises > 0 { parts.append(exercises == 1 ? "1 exercise" : "\(exercises) exercises") }
        for run in runs {
            let length = run.summary?.components(separatedBy: " · ").first ?? ""
            parts.append(length.isEmpty ? run.name : "\(run.name), \(length)")
        }
        let kind = exercises > 0 ? (runs.isEmpty ? "lift" : "both") : runs.first.map { $0.activity ?? "run" } ?? "rest"
        let named = [day.title, day.sessions.first?.title, runs.first?.name].compactMap { $0 }.first { !$0.isEmpty }
        let title = kind == "rest" ? "Rest day" : named ?? "Training"
        return DayCard(date: day.date, title: title, detail: parts.joined(separator: " · "), kind: kind)
    }

    private static func singleDay(_ plan: WatchPlan) -> WatchWeek {
        WatchWeek(week: nil, owner: plan.owner, sentAt: plan.sentAt, seen: plan.seen, days: [plan])
    }

    /// The phone compresses the week (ios/App/App/WatchLink.swift).
    private static func unpack(_ data: Data) -> Data? {
        guard let raw = try? (data as NSData).decompressed(using: .zlib) else { return nil }
        return raw as Data
    }

    private func restore() {
        if let data = defaults.data(forKey: Key.week) {
            week = try? JSONDecoder().decode(WatchWeek.self, from: data)
        } else if let json = defaults.string(forKey: Key.plan),
                  let data = json.data(using: .utf8),
                  let plan = try? JSONDecoder().decode(WatchPlan.self, from: data) {
            week = Self.singleDay(plan)
        }
        if let saved = storedJournal(for: athleteOwner) {
            journal = saved
        } else if athleteOwner == nil {
            if let data = defaults.data(forKey: Key.pending) {
                journal.pending = (try? JSONDecoder().decode([PendingSet].self, from: data)) ?? []
            }
            journal.outbox = defaults.stringArray(forKey: Key.outbox) ?? []
            // Older builds removed a set from the queue as soon as the OS
            // accepted it. Replay unconfirmed sets using the original event ID.
            let queued = Set(journal.outbox.compactMap(LiftJournal.eventID))
            for set in journal.pending where !queued.contains(set.id) {
                enqueue(SetEvent(id: set.id, date: set.date, session: set.session, exercise: set.exercise,
                                 setIndex: set.setIndex, values: set.values, at: timestamp.string(from: set.loggedAt)))
            }
            persist()
        }
        if let rest, rest.endsAt > Date() { scheduleRestEnd() } else if rest != nil { endRest() }
        if let week { Self.saveCards(week) }
    }

}

extension SessionStore: WCSessionDelegate {
    func session(_ session: WCSession, didReceive file: WCSessionFile) {
        guard file.metadata?["week"] as? Bool == true, let packed = try? Data(contentsOf: file.fileURL) else { return }
        DispatchQueue.main.async { self.receive(["week": packed]) }
    }

    func session(_ session: WCSession, didFinish fileTransfer: WCSessionFileTransfer, error: Error?) {
        try? FileManager.default.removeItem(at: fileTransfer.file.fileURL)
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        guard activationState == .activated else { return }
        let context = session.receivedApplicationContext
        DispatchQueue.main.async {
            self.receive(context)
            self.flush()
        }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        DispatchQueue.main.async { replyHandler(["accepted": ClimbWrist.shared.receive(message)]) }
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        guard let ids = userInfo["receipts"] as? [String] else { return }
        let owner = userInfo["owner"] as? String
        DispatchQueue.main.async {
            if self.isCurrentOwner(owner) {
                self.confirmed(Set(ids))
            }
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        DispatchQueue.main.async {
            self.receive(applicationContext)
        }
    }
}
