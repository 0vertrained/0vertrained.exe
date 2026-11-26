import SwiftUI

/// Today's lifts from the phone, the workout's clock and heart rate while it
/// runs, and the way into each exercise. A planned run opens in the Workout
/// app, which runs it with its own screens and alerts.
struct TodayView: View {
    @EnvironmentObject private var store: SessionStore
    @EnvironmentObject private var workout: WorkoutManager
    @State private var confirmingEnd = false

    var body: some View {
        Group {
            if let plan = store.today {
                if plan.sessions.isEmpty && (plan.runs ?? []).isEmpty {
                    EmptyStateView(
                        symbol: "moon.zzz",
                        title: "Nothing planned today",
                        detail: "Today's plan on your iPhone has no lifts or runs."
                    )
                } else {
                    list(plan)
                }
            } else {
                EmptyStateView(
                    symbol: "iphone",
                    title: "No session yet",
                    detail: "Open 0VERTRAINED on your iPhone to send today's lifts here."
                )
            }
        }
        .navigationTitle(navigationTitle)
        .navigationDestination(for: ExerciseKey.self) { key in
            SetLoggerView(key: key)
        }
        .confirmationDialog("End this workout?", isPresented: $confirmingEnd, titleVisibility: .visible) {
            Button("End workout", role: .destructive) { endWorkout() }
            Button("Keep going", role: .cancel) {}
        } message: {
            Text("It's saved to Health, and your iPhone marks the session finished if every set is logged.")
        }
    }

    private var navigationTitle: String {
        guard let plan = store.today else { return "0VERTRAINED" }
        return plan.sessions.count == 1 ? plan.sessions[0].title : (plan.title ?? "Today")
    }

    private func list(_ plan: WatchPlan) -> some View {
        List {
            if let runs = plan.runs, !runs.isEmpty {
                Section {
                    ForEach(runs) { run in
                        RunRow(run: run, lifting: workout.phase != .idle)
                    }
                } header: {
                    Text(runs.count == 1 ? "Run" : "Runs")
                }
            }
            if !plan.sessions.isEmpty {
                Section {
                    workoutRow
                }
            }
            ForEach(plan.sessions) { session in
                Section {
                    ForEach(session.exercises, id: \.name) { exercise in
                        let key = ExerciseKey(session: session.id, name: exercise.name)
                        NavigationLink(value: key) {
                            ExerciseRow(exercise: exercise, sets: store.sets(for: key))
                        }
                    }
                } header: {
                    if plan.sessions.count > 1 {
                        Text(session.title)
                    }
                }
            }
            if workout.phase == .running {
                Section {
                    Button("End workout", role: .destructive) { confirmingEnd = true }
                }
            }
        }
    }

    @ViewBuilder
    private var workoutRow: some View {
        switch workout.phase {
        case .idle:
            VStack(spacing: 6) {
                Button { workout.start() } label: {
                    Label("Start workout", systemImage: "figure.strengthtraining.traditional")
                }
                .buttonStyle(PrimaryButtonStyle())
                if let problem = workout.problem {
                    Text(problem)
                        .font(.footnote)
                        .foregroundStyle(Ledger.ink2)
                        .multilineTextAlignment(.center)
                }
            }
            .listRowBackground(Color.clear)
        case .starting:
            ProgressView()
                .frame(maxWidth: .infinity)
                .accessibilityLabel("Starting the workout")
                .listRowBackground(Color.clear)
        case .running, .ending:
            HStack {
                if let start = workout.startDate {
                    Text(start, style: .timer)
                        .fontDesign(.monospaced)
                        .accessibilityLabel("Workout time")
                }
                Spacer(minLength: 4)
                if let heartRate = workout.heartRate {
                    Label {
                        Text("\(Int(heartRate.rounded()))")
                            .fontDesign(.monospaced)
                    } icon: {
                        Image(systemName: "heart.fill")
                            .foregroundStyle(Ledger.stop)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Heart rate \(Int(heartRate.rounded())) beats per minute")
                }
            }
            .font(.headline)
            .foregroundStyle(Ledger.ink)
        }
    }

    private func endWorkout() {
        workout.end { summary in
            store.finish(summary)
            store.endRest()
        }
    }
}

struct ExerciseRow: View {
    let exercise: PlanExercise
    let sets: [SetState]

    private var doneCount: Int { sets.filter(\.done).count }
    private var complete: Bool { !sets.isEmpty && doneCount == sets.count }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            VStack(alignment: .leading, spacing: 2) {
                Text(exercise.display)
                    .font(.headline)
                    .fontDesign(.serif)
                    .lineLimit(2)
                Text(status)
                    .font(.footnote)
                    .foregroundStyle(Ledger.ink2)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            if complete {
                Image(systemName: "checkmark")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(Ledger.good)
                    .accessibilityHidden(true)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private var status: String {
        if exercise.skipped == true && doneCount == 0 { return "Skipped" }
        if complete { return "Done, \(sets.count) sets" }
        let next = sets.first { !$0.done }
        let summary = next.map { Format.summary($0.values, fields: exercise.fields) } ?? ""
        let progress = "\(doneCount) of \(sets.count) sets"
        return summary.isEmpty ? progress : "\(progress) · next \(summary)"
    }
}

/// A screen with nothing to log yet, saying what to do about it.
/// A planned run: what it is, and the button that opens it in the Workout
/// app with its steps and pace or heart-rate alerts.
struct RunRow: View {
    let run: RunSpec
    /// A lifting workout is going here; one workout at a time.
    let lifting: Bool
    @State private var opening = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(run.name)
                .font(.headline)
                .foregroundStyle(Ledger.ink)
            if let summary = run.summary, !summary.isEmpty {
                Text(summary)
                    .font(.footnote)
                    .foregroundStyle(Ledger.ink2)
            }
            Button { open() } label: {
                Label("Start in Workout", systemImage: "figure.run")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(opening || lifting)
            if lifting {
                Text("End the lifting workout first.")
                    .font(.footnote)
                    .foregroundStyle(Ledger.ink2)
            } else if let problem {
                Text(problem)
                    .font(.footnote)
                    .foregroundStyle(Ledger.ink2)
            }
        }
        .listRowBackground(Color.clear)
    }

    private func open() {
        guard let plan = RunWorkout.plan(for: run) else {
            problem = "This run couldn't be set up. Start it from the Workout app."
            return
        }
        opening = true
        problem = nil
        Task {
            do {
                try await plan.openInWorkoutApp()
            } catch {
                problem = "The Workout app didn't open. Try again."
            }
            opening = false
        }
    }
}

struct EmptyStateView: View {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.title2)
                    .foregroundStyle(Ledger.ink2)
                    .accessibilityHidden(true)
                Text(title)
                    .font(.headline)
                    .fontDesign(.serif)
                    .multilineTextAlignment(.center)
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(Ledger.ink2)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
        }
    }
}
