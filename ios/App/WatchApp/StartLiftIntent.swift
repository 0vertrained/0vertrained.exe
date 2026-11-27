import AppIntents

/// The workout the Action button starts: today's lifting.
enum LiftWorkoutStyle: String, AppEnum {
    case today

    // Stored and literal, as the App Intents metadata reader expects.
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Workout"
    static var caseDisplayRepresentations: [LiftWorkoutStyle: DisplayRepresentation] = [
        .today: "Today's lifting"
    ]
}

/// On Apple Watch Ultra, the Action button can start today's lifting: the
/// app opens with the strength workout running, as Start workout does. Set
/// it in Settings > Action Button: Action Workout, App 0VERTRAINED.
struct StartLiftIntent: StartWorkoutIntent {
    static var title: LocalizedStringResource = "Start today's lifting"
    static var suggestedWorkouts: [StartLiftIntent] = [StartLiftIntent()]
    static var openAppWhenRun: Bool { true }

    @Parameter(title: "Workout")
    var workoutStyle: LiftWorkoutStyle

    init() {
        workoutStyle = .today
    }

    var displayRepresentation: DisplayRepresentation {
        LiftWorkoutStyle.caseDisplayRepresentations[workoutStyle] ?? "Today's lifting"
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        // With no lifting planned today, the app just opens.
        if SessionStore.shared.today?.sessions.isEmpty == false {
            WorkoutManager.shared.start()
        }
        return .result()
    }
}
