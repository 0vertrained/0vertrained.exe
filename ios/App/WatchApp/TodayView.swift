import SwiftUI

/// Today's lifts from the phone, the workout's clock and heart rate while it
/// runs, and the way into each exercise. A planned run opens in the Workout
/// app, which runs it with its own screens and alerts.
struct TodayView: View {
    @EnvironmentObject private var store: SessionStore
    @EnvironmentObject private var workout: WorkoutManager
    @ObservedObject private var cardioWorkout = CardioWorkoutManager.shared
    @ObservedObject private var climb = ClimbWrist.shared
    @State private var confirmingEnd = false

    var body: some View {
        Group {
            if let attempt = store.rehearsalAttempt {
                RehearsalWorkoutView(attempt: attempt)
            } else if cardioWorkout.isActive {
                CardioWorkoutView()
            } else if let invite = climb.invite, invite.owner == store.athleteOwner {
                ClimbWristInvite(invite: invite)
            } else if let plan = store.today {
                if plan.sessions.isEmpty && plan.cardioWorkouts.isEmpty && plan.rehearsal?.valid != true {
                    EmptyStateView(
                        symbol: "moon.zzz",
                        title: "Nothing planned today",
                        detail: plan.adaptationReason ?? "Today's plan on your iPhone has no scheduled workout."
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
        .safeAreaInset(edge: .bottom) {
            if store.unsyncedCount > 0 && !cardioWorkout.isActive {
                Text("Saved on Watch · \(store.unsyncedCount) awaiting iPhone")
                    .font(.caption2).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center).allowsHitTesting(false)
            }
        }
        .navigationDestination(for: ExerciseKey.self) { key in
            SetLoggerView(key: key)
        }
        .confirmationDialog("End this workout?", isPresented: $confirmingEnd, titleVisibility: .visible) {
            Button("End workout", role: .destructive) { endWorkout() }
            Button("Keep going", role: .cancel) {}
        } message: {
            Text("Your iPhone receives the sets you logged. Any remaining sets stay open.")
        }
    }

    private var navigationTitle: String {
        guard let plan = store.today else { return "0VERTRAINED" }
        return plan.sessions.count == 1 ? plan.sessions[0].title : (plan.title ?? "Today")
    }

    private func list(_ plan: WatchPlan) -> some View {
        List {
            if let reason = plan.adaptationReason, !reason.isEmpty {
                Text(reason).font(.footnote).foregroundStyle(Ledger.ink2)
            }
            if let course = plan.rehearsal, course.valid {
                Section("Race rehearsal") {
                    NavigationLink {
                        RehearsalPreview(course: course)
                    } label: {
                        Label(course.name, systemImage: "map")
                    }
                }
            }
            let runs = plan.cardioWorkouts
            if !runs.isEmpty {
                Section {
                    ForEach(runs) { run in
                        RunRow(run: run, lifting: workout.phase != .idle || store.activeLift != nil)
                    }
                } header: {
                    Text("Cardio")
                }
            }
            if !plan.sessions.isEmpty {
                Section {
                    workoutRow
                    if let key = store.activeLift?.exercise, let exercise = plan.exercise(key) {
                        NavigationLink(value: key) {
                            Label(store.rest == nil ? "Resume \(exercise.display)" : "Resume rest", systemImage: "arrow.uturn.forward")
                        }
                    }
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
            if workout.phase == .running || (store.activeLift != nil && workout.phase == .idle) {
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
                    Label(store.activeLift == nil ? "Start workout" : "Start Health tracking", systemImage: "figure.strengthtraining.traditional")
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
        if workout.phase == .idle {
            store.finishWithoutHealth()
            return
        }
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

/// Use Apple Workout when it supports the activity and its goals. The in-app
/// recorder can run the same steps for other equipment.
struct RunRow: View {
    let run: RunSpec
    /// A lifting workout is going here; one workout at a time.
    let lifting: Bool
    @ObservedObject private var cardio = CardioWorkoutManager.shared
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
                Label(RunWorkout.plan(for: run) == nil ? "Start cardio" : "Start in Workout", systemImage: "play.fill")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(opening || lifting || cardio.isActive)
            if lifting {
                Text("End the lifting workout first.")
                    .font(.footnote)
                    .foregroundStyle(Ledger.ink2)
            } else if let message = problem ?? cardio.problem {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(Ledger.ink2)
                if problem != nil {
                    Button("Track in 0VERTRAINED") {
                        problem = nil
                        cardio.start(run)
                    }
                }
            }
        }
        .listRowBackground(Color.clear)
    }

    private func open() {
        guard let plan = RunWorkout.plan(for: run) else {
            cardio.start(run)
            return
        }
        opening = true
        problem = nil
        Task {
            do {
                try await plan.openInWorkoutApp()
            } catch {
                problem = "Apple Workout didn’t open."
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
