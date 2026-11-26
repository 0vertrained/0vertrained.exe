import SwiftUI
import WatchKit

/// One exercise, one set at a time. The set arrives filled the way the phone
/// would fill it and says from what, so a set done as planned is one tap on
/// Log set. The crown changes the number with the outline; tap the other
/// number to move it there. Logging starts the rest, which taps the wrist
/// when it's over.
struct SetLoggerView: View {
    @EnvironmentObject private var store: SessionStore
    @EnvironmentObject private var workout: WorkoutManager
    @State private var key: ExerciseKey
    /// Numbers changed with the crown, for the set named by `editsFor`.
    @State private var edits: [String: Double] = [:]
    @State private var editsFor = ""
    @FocusState private var focus: String?

    init(key: ExerciseKey) {
        _key = State(initialValue: key)
    }

    private var exercise: PlanExercise? { store.today?.exercise(key) }

    var body: some View {
        Group {
            if let exercise {
                if let rest = store.rest {
                    RestView(rest: rest)
                } else {
                    let sets = store.sets(for: key)
                    if let current = sets.first(where: { !$0.done }) {
                        logger(exercise, current: current, total: sets.count)
                    } else {
                        finished(exercise)
                    }
                }
            } else {
                Text("This exercise isn't in today's session anymore.")
                    .font(.body)
                    .foregroundStyle(Ledger.ink2)
                    .multilineTextAlignment(.center)
            }
        }
        .navigationTitle(exercise?.display ?? "")
    }

    // MARK: - The set

    private func logger(_ exercise: PlanExercise, current: SetState, total: Int) -> some View {
        ScrollView {
            VStack(spacing: 8) {
                Text("Set \(current.index + 1) of \(total)")
                    .font(.footnote)
                    .foregroundStyle(Ledger.ink2)
                    .frame(maxWidth: .infinity, alignment: .leading)

                HStack(spacing: 6) {
                    ForEach(exercise.fields, id: \.prop) { field in
                        tile(field, current: current)
                    }
                }

                if let label = current.sourceLabel, !isEdited(current) {
                    Text("From \(label.lowercased())")
                        .font(.footnote)
                        .foregroundStyle(Ledger.ink2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button("Log set") { log(exercise, current: current) }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!isValid(exercise, current: current))
            }
        }
        .onAppear {
            if focus == nil { focus = exercise.fields.first?.prop }
        }
    }

    private func tile(_ field: PlanField, current: SetState) -> some View {
        let shown = value(field, current: current)
        return ValueTile(field: field, value: shown, focused: focus == field.prop)
            .focusable(true)
            .focused($focus, equals: field.prop)
            .digitalCrownRotation(
                binding(field, current: current),
                from: 0,
                through: field.max,
                by: field.step,
                sensitivity: .medium,
                isContinuous: false,
                isHapticFeedbackEnabled: true
            )
            .onTapGesture { focus = field.prop }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(field.label)
            .accessibilityValue("\(Format.number(shown)) \(field.unit)")
            .accessibilityAdjustableAction { direction in
                let number = binding(field, current: current)
                switch direction {
                case .increment: number.wrappedValue = shown + field.step
                case .decrement: number.wrappedValue = shown - field.step
                @unknown default: break
                }
            }
    }

    private func setKey(_ current: SetState) -> String {
        "\(key.session)/\(key.name)#\(current.index)"
    }

    private func isEdited(_ current: SetState) -> Bool {
        editsFor == setKey(current) && !edits.isEmpty
    }

    private func value(_ field: PlanField, current: SetState) -> Double {
        if editsFor == setKey(current), let edited = edits[field.prop] { return edited }
        return current.values[field.prop] ?? 0
    }

    private func binding(_ field: PlanField, current: SetState) -> Binding<Double> {
        let forSet = setKey(current)
        return Binding(
            get: { value(field, current: current) },
            set: { newValue in
                if editsFor != forSet {
                    edits = [:]
                    editsFor = forSet
                }
                edits[field.prop] = min(max(0, newValue), field.max)
            }
        )
    }

    private func isValid(_ exercise: PlanExercise, current: SetState) -> Bool {
        exercise.fields.allSatisfy { !$0.required || value($0, current: current) > 0 }
    }

    private func log(_ exercise: PlanExercise, current: SetState) {
        guard isValid(exercise, current: current) else {
            WKInterfaceDevice.current().play(.failure)
            return
        }
        var logged: [String: Double] = [:]
        for field in exercise.fields {
            let number = value(field, current: current)
            if field.required || number > 0 { logged[field.prop] = number }
        }
        store.logSet(key, setIndex: current.index, values: logged)
        WKInterfaceDevice.current().play(.success)
        edits = [:]
        editsFor = ""
        workout.startIfAllowed()

        // Nothing follows the session's last set, so nothing to rest for.
        guard !store.allLogged else { return }
        store.startRest(seconds: exercise.restSeconds, next: nextUp(exercise))
    }

    /// What the rest screen says comes next.
    private func nextUp(_ exercise: PlanExercise) -> String? {
        if let next = store.nextOpenSet(for: key) {
            let summary = Format.summary(next.values, fields: exercise.fields)
            return summary.isEmpty ? "Next: set \(next.index + 1)" : "Next: set \(next.index + 1) · \(summary)"
        }
        if let following = store.nextExercise(after: key), let nextExercise = store.today?.exercise(following) {
            return "Next: \(nextExercise.display)"
        }
        return nil
    }

    // MARK: - Exercise done

    private func finished(_ exercise: PlanExercise) -> some View {
        ScrollView {
            VStack(spacing: 10) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.title2)
                    .foregroundStyle(store.allLogged ? Ledger.earned : Ledger.good)
                    .accessibilityHidden(true)
                Text(store.allLogged ? "Every set is logged" : "\(exercise.display) is done")
                    .font(.headline)
                    .fontDesign(.serif)
                    .multilineTextAlignment(.center)
                if let next = store.nextExercise(after: key), let nextExercise = store.today?.exercise(next) {
                    Button("Next: \(nextExercise.display)") {
                        edits = [:]
                        editsFor = ""
                        focus = nil
                        key = next
                    }
                    .buttonStyle(PrimaryButtonStyle())
                } else if workout.phase == .running {
                    Text("End the workout from the list when you're done.")
                        .font(.footnote)
                        .foregroundStyle(Ledger.ink2)
                        .multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }
}

/// The rest between sets. It ends by itself with a tap on the wrist; +30s
/// and Skip change it.
struct RestView: View {
    @EnvironmentObject private var store: SessionStore
    let rest: SessionStore.Rest

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text("Rest")
                    .font(.footnote)
                    .foregroundStyle(Ledger.ink2)
                Text(timerInterval: min(Date(), rest.endsAt)...rest.endsAt, countsDown: true)
                    .font(.largeTitle.weight(.semibold))
                    .fontDesign(.monospaced)
                    .foregroundStyle(Ledger.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .accessibilityLabel("Rest time left")
                if let next = rest.next {
                    Text(next)
                        .font(.footnote)
                        .foregroundStyle(Ledger.ink2)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                }
                HStack(spacing: 6) {
                    Button { store.addRest(30) } label: { Text("+30s") }
                        .buttonStyle(SecondaryButtonStyle())
                        .accessibilityLabel("Add 30 seconds")
                    Button("Skip") { store.endRest() }
                        .buttonStyle(SecondaryButtonStyle())
                        .accessibilityLabel("Skip the rest")
                }
            }
            .frame(maxWidth: .infinity)
        }
    }
}
