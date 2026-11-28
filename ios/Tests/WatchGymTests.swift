import Foundation

// Host fixtures exercise the actual Watch gym operations without requiring
// WCSession, HealthKit, or a paired device.
struct RunSpec: Codable, Equatable {}
final class SessionStore {
    var athleteOwner: String? { today?.owner }
    var today: WatchPlan?
    var sent = [[String: Any]]()
    var isResting = false
    init(_ plan: WatchPlan) { today = plan }
    func sets(for key: ExerciseKey) -> [PlanSet] { today?.exercise(key)?.sets ?? [] }
    func nextOpenSet(for key: ExerciseKey) -> PlanSet? { sets(for: key).first { !$0.done } }
    func endRest() { isResting = false }
    func commitGymEdit<Event: Encodable>(_ event: Event, undoing id: String? = nil, _ edit: (inout WatchPlan) -> Void) {
        edit(&today!)
        let data = try! JSONEncoder().encode(event)
        sent.append(try! JSONSerialization.jsonObject(with: data) as! [String: Any])
    }
}

@main
struct WatchGymTests {
    static func main() throws {
        let open = PlanSet(done: false, values: ["weight": 185, "reps": 8])
        let choice = PlanVariation(name: "Dumbbell Bench Press", fields: [],
                                   sets: [PlanSet(done: false, values: ["weight": 50, "reps": 8]), open])
        let first = PlanExercise(name: "Bench", display: "Bench", restSeconds: 120, fields: [],
                                 sets: [open, open], swaps: [choice])
        let row = PlanExercise(name: "Row", display: "Row", restSeconds: 90, fields: [], sets: [open, open])
        let curl = PlanExercise(name: "Curl", display: "Curl", restSeconds: 90, fields: [], sets: [open])
        let a = ExerciseKey(session: "main", name: first.name)
        let b = ExerciseKey(session: "main", name: row.name)
        let store = SessionStore(WatchPlan(v: 1, date: "2026-11-26",
            sessions: [PlanSession(id: "main", title: "Upper", exercises: [first, row, curl])]))
        let rules = BarbellRules(bar: 45, plates: [45, 35, 25, 10, 5, 2.5], rampMinimum: 95,
                                 increment: 5, emptyReps: 10, steps: [.init(fraction: 0.55, reps: 5),
                                 .init(fraction: 0.70, reps: 3), .init(fraction: 0.85, reps: 2)])
        store.today?.barbellRules = rules
        store.today?.mutateExercise(a) { $0.barbell = true }
        precondition(rules.perSide(for: 225) == "2 × 45 / side")
        precondition(rules.perSide(for: 46)?.contains("0.5 lb short per side") == true)
        precondition(rules.perSide(for: 35) == nil && rules.ramp(to: 85).isEmpty)
        precondition(rules.ramp(to: 225).map(\.weight) == [45, 125, 160, 190])
        store.toggleWarmup(a, workingWeight: 225, index: 1)
        store.toggleWarmup(a, workingWeight: 185, index: 1)
        precondition(store.sets(for: a) == [open, open] && !store.isResting)
        precondition(store.sent.last?["type"] as? String == "warmup")
        precondition(store.sent.last?["workingWeight"] as? Double == 185)
        let persisted = try JSONDecoder().decode(WatchPlan.self, from: JSONEncoder().encode(store.today!))
        precondition(persisted.exercise(a)?.warmupSets?.map(\.weight) == [125, 100])
        store.toggleWarmup(a, workingWeight: 185, index: 1)
        precondition(store.today?.exercise(a)?.warmupSets?.last?.done == false)
        store.swapExercise(a, to: choice.name)
        precondition(store.today?.exercise(a)?.display == choice.name && store.sets(for: a)[0].values["weight"] == 50)
        precondition(store.today?.exercise(a)?.barbell != true && store.today?.exercise(a)?.warmupSets == nil)
        store.swapExercise(a, to: first.name)
        precondition(store.today?.exercise(a)?.display == first.name && store.sets(for: a)[0].values["weight"] == 185)
        store.pairExercise(a, enabled: true)
        precondition(store.supersetTransition(after: a)?.next == b && store.supersetTransition(after: a)?.rest == false)
        precondition(store.supersetTransition(after: b)?.next == a && store.supersetTransition(after: b)?.rest == true)
        store.pairExercise(b, enabled: true)
        precondition(store.today?.exercise(b)?.pairNext != true)
        store.today?.mutateExercise(a) { exercise in
            exercise.sets[0] = PlanSet(done: true, values: ["weight": 180, "reps": 8], watchEventID: "first", completedAt: "2026-11-27T00:00:00Z")
        }
        store.swapExercise(a, to: choice.name)
        precondition(store.today?.exercise(a)?.display == first.name)
        store.today?.mutateExercise(b) { exercise in
            exercise.sets[0] = PlanSet(done: true, values: [:], watchEventID: "second", completedAt: "2026-11-27T00:01:00Z")
            exercise.sets[1] = PlanSet(done: true, values: [:])
        }
        precondition(store.supersetTransition(after: a) == nil)
        let restored = SessionStore(try JSONDecoder().decode(WatchPlan.self, from: JSONEncoder().encode(store.today!)))
        restored.isResting = true
        precondition(restored.undoLastWatchSet() == b)
        precondition(!restored.sets(for: b)[0].done && restored.sets(for: b)[1].done && !restored.isResting)
        precondition(restored.sent.last?["targetID"] as? String == "second")
        precondition(restored.lastWatchSet?.id == "first")
        let owner = "undo-fixture-" + UUID().uuidString
        restored.today?.owner = owner
        restored.today?.mutateExercise(a) { $0.display = choice.name }
        let calibration = RepCalibrationStore(defaults: .standard)
        let id = RepMotionExercise.dumbbellBenchPress.rawValue
        defer { calibration.reset(owner: owner, exerciseID: id) }
        var profile = RepCalibrationProfile()
        let review = RepMotionEvidence(exercise: .dumbbellBenchPress, counts: [8,8,8,8,7], detected: 8, uninterrupted: true)
        precondition(profile.review(review, confirmed: 8, setID: "first"))
        calibration.save(profile, owner: owner, exerciseID: id)
        precondition(restored.undoLastWatchSet() == a)
        precondition(calibration.profile(owner: owner, exerciseID: id).reviewCount() == 0)
        print("Watch gym fixtures passed")
    }
}
