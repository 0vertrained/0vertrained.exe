import Foundation

// The ledger stores opaque cardio specs; this lift-only fixture runs without
// WorkoutKit on the same Linux CI runner as the phone bridge tests.
struct RunSpec: Codable, Equatable {}

@main
struct WatchJournalTests {
    static func main() throws {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let first = "2026-11-27", next = "2026-11-28"
        let key = ExerciseKey(session: "main", name: "Bench Press")
        let move = PlanExercise(name: key.name, display: key.name, restSeconds: 120,
                                fields: [], sets: [PlanSet(done: false, values: ["reps": 8])])
        let plan = WatchPlan(v: 1, date: first, sessions: [PlanSession(id: key.session, title: "Lift", exercises: [move])])
        let tomorrow = WatchPlan(v: 1, date: next, sessions: [])
        let week = WatchWeek(days: [plan, tomorrow])
        var journal = LiftJournal()
        journal.begin(plan, at: start)
        let workoutID = journal.active!.id
        journal.begin(tomorrow, at: start.addingTimeInterval(120))
        precondition(journal.active?.id == workoutID)
        journal.rest = LiftJournal.Rest(endsAt: start.addingTimeInterval(120), seconds: 120, next: "Set 2")
        journal.active!.plan.mutateExercise(key) { $0.sets[0].done = true }
        journal.pending = [PendingSet(id: "set-A", date: first, session: key.session, exercise: key.name,
                                      setIndex: 0, values: ["reps": 8], loggedAt: start)]
        let original = #"{"id":"set-A","type":"set"}"#
        let undo = #"{"id":"undo-A","type":"undo","targetID":"set-A"}"#
        journal.outbox = [original, undo]

        let disk = try JSONEncoder().encode(journal)
        var restored = try JSONDecoder().decode(LiftJournal.self, from: disk)
        restored.receive(week, calendarDay: next)
        precondition(restored.day(next, week: week)?.date == first)
        precondition(restored.day(next, week: week)?.exercise(key)?.sets.first?.done == true)
        precondition(restored.rest?.endsAt == start.addingTimeInterval(120))
        precondition(restored.pendingSet(on: next, key: key, index: 0) == nil)
        precondition(restored.pendingSet(on: first, key: key, index: 0)?.id == "set-A")

        var phone = WatchInbox()
        precondition(phone.receive(restored.outbox + [original]).isEmpty)
        precondition(phone.events == [original, undo])
        phone.confirm(["set-A", "undo-A"])
        let savedPhone = try JSONEncoder().encode(phone)
        var reopened = try JSONDecoder().decode(WatchInbox.self, from: savedPhone)
        let recoveredReceipts = reopened.receive(restored.outbox)
        precondition(reopened.events.isEmpty && recoveredReceipts == ["set-A", "undo-A"])
        restored.acknowledge(Set(recoveredReceipts))
        precondition(restored.outbox.isEmpty && restored.pending.isEmpty)
        restored.close(at: start.addingTimeInterval(600))
        precondition(restored.lastFinish?.id == workoutID && restored.rest == nil)
        precondition(restored.day(next, week: week)?.date == next)
        var lift = LiftJournal.Session(id: "lift-A", startedAt: start, plan: plan)
        lift.plan.owner = "A"
        lift.healthStartedAt = start.addingTimeInterval(600)
        precondition(lift.matchesHealth(start: lift.healthStartedAt, owner: "A", taggedOwner: "A", workoutID: "lift-A"))
        precondition(!lift.matchesHealth(start: lift.healthStartedAt, owner: "B", taggedOwner: "A", workoutID: "lift-A"))
        precondition(!lift.matchesHealth(start: lift.healthStartedAt, owner: "A", taggedOwner: "A", workoutID: "lift-B"))
        precondition(!lift.matchesHealth(start: start, owner: "A", taggedOwner: nil, workoutID: nil))
        precondition(lift.matchesHealth(start: lift.healthStartedAt, owner: "A", taggedOwner: nil, workoutID: nil))

        let course = RehearsalCourse(id: "trail", name: "Trail", date: first,
            points: [.init(lat: 1, lon: 1), .init(lat: 1, lon: 1.1)],
            checkpoints: [.init(id: "water", name: "Water", kind: "water", pointIndex: 1, meters: 100)],
            distanceMeters: 100)
        var race = RehearsalAttempt(owner: "A", course: course, start: start)
        race.mark(taken: true, at: start.addingTimeInterval(20))
        var raceJournal = LiftJournal()
        raceJournal.rehearsal = race
        raceJournal = try JSONDecoder().decode(LiftJournal.self, from: JSONEncoder().encode(raceJournal))
        raceJournal.receive(week, calendarDay: next)
        precondition(raceJournal.rehearsal?.atStop == true && raceJournal.rehearsal?.course.date == first)
        precondition(!raceJournal.finishRehearsal(owner: "B", at: start.addingTimeInterval(25)))
        precondition(raceJournal.finishRehearsal(owner: "A", at: start.addingTimeInterval(30)))
        precondition(!raceJournal.finishRehearsal(owner: "A", at: start.addingTimeInterval(31)))
        var racePhone = WatchInbox()
        precondition(racePhone.receive(raceJournal.outbox).isEmpty && racePhone.events.count == 1)
        precondition(WatchInbox.owner(racePhone.events[0]) == "A" && WatchInbox.id(racePhone.events[0]) == race.id)
        racePhone.confirm([race.id])
        let receipts = racePhone.receive(raceJournal.outbox)
        raceJournal.acknowledge(Set(receipts))
        precondition(raceJournal.rehearsal == nil && raceJournal.outbox.isEmpty)
        print("Watch offline rollover, restore, ordered retry and receipt fixtures passed")
    }
}
