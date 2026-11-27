import Foundation

/// The plan and edits for one workout are committed with its outgoing events.
struct LiftJournal: Codable {
    struct Session: Codable {
        var id: String
        var startedAt: Date
        var plan: WatchPlan
        var exercise: ExerciseKey?
    }
    struct Rest: Codable, Equatable {
        var endsAt: Date
        var seconds: Int
        var next: String?
    }

    var active: Session?
    var lastFinish: Session?
    var finishedAt: Date?
    var rest: Rest?
    var pending: [PendingSet] = []
    var outbox: [String] = []

    mutating func begin(_ plan: WatchPlan, at now: Date) {
        guard active == nil else { return }
        active = Session(id: UUID().uuidString, startedAt: now, plan: plan)
    }

    func day(_ calendarDay: String, week: WatchWeek?) -> WatchPlan? {
        if let active { return active.plan }
        if let finished = lastFinish, finished.plan.date == calendarDay { return finished.plan }
        return week?.days.first { $0.date == calendarDay }
    }

    func pendingSet(on date: String, key: ExerciseKey, index: Int) -> PendingSet? {
        pending.last { $0.date == date && $0.session == key.session && $0.exercise == key.name && $0.setIndex == index }
    }

    mutating func close(at now: Date) {
        lastFinish = active
        finishedAt = now
        active = nil
        rest = nil
    }

    static func eventID(_ raw: String) -> String? {
        (try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])?["id"] as? String
    }

    mutating func acknowledge(_ ids: Set<String>) {
        guard !ids.isEmpty else { return }
        outbox.removeAll { Self.eventID($0).map(ids.contains) == true }
        pending.removeAll { ids.contains($0.id) }
    }

    mutating func receive(_ week: WatchWeek, calendarDay: String) {
        let seen = Set(week.seen ?? [])
        acknowledge(seen)
        guard let finished = lastFinish else { return }
        // A phone relaunch can send a fresh plan after the durable receipt
        // has arrived but no longer include the short recent-ID list.
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let newPlan = week.sentAt.flatMap(formatter.date(from:))
        let refreshed = outbox.isEmpty && newPlan.map { $0 > (finishedAt ?? .distantFuture) } == true
        if finished.plan.date != calendarDay || seen.contains(finished.id) || refreshed {
            lastFinish = nil
            finishedAt = nil
        }
    }
}
