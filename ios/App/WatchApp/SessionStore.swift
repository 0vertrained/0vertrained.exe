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
    @Published private(set) var pending: [PendingSet] = []
    @Published private(set) var rest: Rest?

    struct Rest: Equatable {
        var endsAt: Date
        var seconds: Int
        /// What comes after the rest, e.g. "Set 3 · 185 × 8".
        var next: String?
    }

    private enum Key {
        static let week = "ovt.week"
        /// A single day's plan, as saved before weeks.
        static let plan = "ovt.plan"
        static let pending = "ovt.pending"
        static let outbox = "ovt.outbox"
    }

    private let defaults = UserDefaults.standard
    /// Events not yet handed to WatchConnectivity, kept across launches.
    private var outbox: [String] = []
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
        guard key != dayKey else { return }
        dayKey = key
        prunePending()
    }

    // MARK: - Reading the plan

    /// Today's plan, if the phone has sent one.
    var today: WatchPlan? {
        let key = Self.dateKey(Date())
        return week?.days.first { $0.date == key }
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
            } else if let local = pending.last(where: { $0.session == key.session && $0.exercise == key.name && $0.setIndex == index }) {
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

    func logSet(_ key: ExerciseKey, setIndex: Int, values: [String: Double]) {
        guard let plan = today else { return }
        let id = UUID().uuidString
        let now = Date()
        pending.append(PendingSet(id: id, date: plan.date, session: key.session, exercise: key.name, setIndex: setIndex, values: values, loggedAt: now))
        savePending()
        send(SetEvent(id: id, date: plan.date, session: key.session, exercise: key.name, setIndex: setIndex, values: values, at: timestamp.string(from: now)))
    }

    func finish(_ summary: WorkoutSummary) {
        let date = today?.date ?? Self.dateKey(summary.startedAt)
        send(FinishEvent(
            id: UUID().uuidString,
            date: date,
            at: timestamp.string(from: summary.endedAt),
            startedAt: timestamp.string(from: summary.startedAt),
            durationSeconds: max(0, Int(summary.endedAt.timeIntervalSince(summary.startedAt))),
            averageHeartRate: summary.averageHeartRate,
            activeEnergy: summary.activeEnergy
        ))
    }

    private func send<Event: Encodable>(_ event: Event) {
        guard let data = try? JSONEncoder().encode(event), let json = String(data: data, encoding: .utf8) else { return }
        outbox.append(json)
        defaults.set(outbox, forKey: Key.outbox)
        flush()
    }

    private func flush() {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated, !outbox.isEmpty else { return }
        for json in outbox {
            WCSession.default.transferUserInfo(["event": json])
        }
        outbox.removeAll()
        defaults.set(outbox, forKey: Key.outbox)
    }

    // MARK: - Rest

    func startRest(seconds: Int, next: String?) {
        rest = Rest(endsAt: Date().addingTimeInterval(TimeInterval(seconds)), seconds: seconds, next: next)
        scheduleRestEnd()
    }

    func addRest(_ seconds: Int) {
        guard var current = rest else { return }
        current.endsAt.addTimeInterval(TimeInterval(seconds))
        current.seconds += seconds
        rest = current
        scheduleRestEnd()
    }

    func endRest() {
        restWork?.cancel()
        restWork = nil
        rest = nil
    }

    /// While a workout is running the app keeps running with the wrist down,
    /// so this tap lands on time.
    private func scheduleRestEnd() {
        restWork?.cancel()
        guard let rest else { return }
        let work = DispatchWorkItem { [weak self] in
            WKInterfaceDevice.current().play(.notification)
            self?.rest = nil
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
        week = incoming
        if let data = try? JSONEncoder().encode(incoming) {
            defaults.set(data, forKey: Key.week)
        }
        prunePending()
        Self.saveCards(incoming)
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
        let runs = day.runs ?? []
        var parts: [String] = []
        if exercises > 0 { parts.append(exercises == 1 ? "1 exercise" : "\(exercises) exercises") }
        for run in runs {
            let length = run.summary?.components(separatedBy: " · ").first ?? ""
            parts.append(length.isEmpty ? run.name : "\(run.name), \(length)")
        }
        let kind = exercises > 0 && !runs.isEmpty ? "both" : exercises > 0 ? "lift" : !runs.isEmpty ? "run" : "rest"
        let named = [day.title, day.sessions.first?.title, runs.first?.name].compactMap { $0 }.first { !$0.isEmpty }
        let title = kind == "rest" ? "Rest day" : named ?? "Training"
        return DayCard(date: day.date, title: title, detail: parts.joined(separator: " · "), kind: kind)
    }

    private static func singleDay(_ plan: WatchPlan) -> WatchWeek {
        WatchWeek(week: nil, sentAt: plan.sentAt, seen: plan.seen, days: [plan])
    }

    /// The phone compresses the week (ios/App/App/WatchLink.swift).
    private static func unpack(_ data: Data) -> Data? {
        guard let raw = try? (data as NSData).decompressed(using: .zlib) else { return nil }
        return raw as Data
    }

    /// Drops what the phone has dealt with: sets its plans show done, events
    /// it lists as seen (including any it set aside), and days before its week.
    private func prunePending() {
        guard let week else { return }
        let seen = Set(week.seen ?? [])
        let earliest = week.days.map(\.date).min() ?? dayKey
        let before = pending.count
        pending.removeAll { item in
            if seen.contains(item.id) || item.date < earliest { return true }
            guard let day = week.days.first(where: { $0.date == item.date }),
                  let exercise = day.exercise(ExerciseKey(session: item.session, name: item.exercise)) else { return false }
            return item.setIndex < exercise.sets.count && exercise.sets[item.setIndex].done
        }
        if pending.count != before { savePending() }
    }

    private func restore() {
        if let data = defaults.data(forKey: Key.week) {
            week = try? JSONDecoder().decode(WatchWeek.self, from: data)
        } else if let json = defaults.string(forKey: Key.plan),
                  let data = json.data(using: .utf8),
                  let plan = try? JSONDecoder().decode(WatchPlan.self, from: data) {
            week = Self.singleDay(plan)
        }
        if let data = defaults.data(forKey: Key.pending) {
            pending = (try? JSONDecoder().decode([PendingSet].self, from: data)) ?? []
        }
        outbox = defaults.stringArray(forKey: Key.outbox) ?? []
        if let week { Self.saveCards(week) }
    }

    private func savePending() {
        if let data = try? JSONEncoder().encode(pending) {
            defaults.set(data, forKey: Key.pending)
        }
    }
}

extension SessionStore: WCSessionDelegate {
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        guard activationState == .activated else { return }
        let context = session.receivedApplicationContext
        DispatchQueue.main.async {
            self.receive(context)
            self.flush()
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        DispatchQueue.main.async {
            self.receive(applicationContext)
        }
    }
}
