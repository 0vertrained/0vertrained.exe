import Foundation

extension SessionStore {
    /// A swap changes the performed movement inside its original log slot.
    /// Keep the old option so it can be restored while no sets are logged.
    func swapExercise(_ key: ExerciseKey, to name: String) {
        guard let plan = today, let exercise = plan.exercise(key),
              let choice = exercise.swaps?.first(where: { $0.name == name }),
              !sets(for: key).contains(where: { $0.done }) else { return }
        let event = GymEditEvent(type: "swap", date: plan.date, session: key.session, exercise: key.name, performedName: name)
        commitGymEdit(event) { day in
            day.mutateExercise(key) { current in
                var alternatives = (current.swaps ?? []).filter { $0.name != name && $0.name != current.display }
                alternatives.append(PlanVariation(name: current.display, fields: current.fields, sets: current.sets))
                current.display = choice.name
                current.fields = choice.fields
                current.sets = choice.sets
                current.swaps = alternatives
            }
        }
    }

    func pairExercise(_ key: ExerciseKey, enabled: Bool) {
        guard let plan = today,
              let next = plan.adjacent(to: key, offset: 1),
              !enabled || (plan.pairLeader(for: key) == nil && plan.pairLeader(for: next) == nil) else { return }
        let event = GymEditEvent(type: "pair", date: plan.date, session: key.session, exercise: key.name,
                                 partner: next.name, enabled: enabled)
        commitGymEdit(event) { day in day.mutateExercise(key) { $0.pairNext = enabled } }
    }

    /// Only Watch-origin sets have an operation ID. Undo refers to that
    /// exact write so a later iPhone correction or replacement is preserved.
    var lastWatchSet: (key: ExerciseKey, slot: Int, id: String)? {
        guard let plan = today else { return nil }
        var latest: (key: ExerciseKey, slot: Int, id: String, time: String)?
        for key in plan.keys {
            for (slot, set) in (plan.exercise(key)?.sets ?? []).enumerated() {
                guard set.done, let id = set.watchEventID else { continue }
                let stamp = set.completedAt ?? ""
                if latest.map({ stamp > $0.time }) ?? true {
                    latest = (key, slot, id, stamp)
                }
            }
        }
        return latest.map { ($0.key, $0.slot, $0.id) }
    }

    @discardableResult
    func undoLastWatchSet() -> ExerciseKey? {
        guard let date = today?.date, let last = lastWatchSet else { return nil }
        let event = GymEditEvent(type: "undo", date: date, session: last.key.session, exercise: last.key.name,
                                 setIndex: last.slot, targetID: last.id)
        commitGymEdit(event, undoing: last.id) { day in
            day.mutateExercise(last.key) { exercise in
                guard exercise.sets.indices.contains(last.slot), exercise.sets[last.slot].watchEventID == last.id else { return }
                exercise.sets[last.slot].done = false
                exercise.sets[last.slot].watchEventID = nil
                exercise.sets[last.slot].completedAt = nil
                exercise.sets[last.slot].source = nil
                exercise.sets[last.slot].sourceLabel = nil
            }
        }
        endRest()
        return last.key
    }

    /// After A1, switch directly to A2. After A2 rest, then return to A1.
    /// If the partner has fewer sets, finish remaining work normally.
    func supersetTransition(after key: ExerciseKey) -> (next: ExerciseKey, rest: Bool)? {
        guard let plan = today, let first = plan.pairLeader(for: key), let second = plan.adjacent(to: first, offset: 1) else { return nil }
        let next = key == first ? second : first
        guard plan.exercise(next)?.skipped != true, nextOpenSet(for: next) != nil else { return nil }
        return (next, key == second)
    }
}
