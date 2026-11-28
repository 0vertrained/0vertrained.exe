import CoreMotion
import SwiftUI
import WatchKit

/// Opening the sheet does not activate motion. Each set needs its own Start,
/// a review, and the logger's usual Log set action.
struct RepCounterButton: View {
    let exercise: RepMotionExercise
    let name: String
    let owner: String?
    let limit: Int
    let onOpen: () -> Void
    let onConfirm: (Int, RepMotionEvidence?) -> Void
    @State private var showing = false

    var body: some View {
        Button("Count reps · beta") {
            onOpen()
            showing = true
        }
        .buttonStyle(SecondaryButtonStyle())
        .sheet(isPresented: $showing) {
            RepCounterView(exercise: exercise, name: name, owner: owner, limit: limit, onConfirm: onConfirm)
        }
    }
}

private final class RepCapture: ObservableObject {
    enum Phase: Equatable { case ready, preparing, calibrating, counting, review, unavailable }
    @Published private(set) var phase: Phase = .ready
    @Published private(set) var count = 0
    @Published private(set) var message = ""
    private(set) var evidence: RepMotionEvidence?

    private let motion = CMMotionManager()
    private var detector: RepMotionDetector
    private var timeout: DispatchWorkItem?
    private var generation = 0
    private(set) var setupDeadline = Date()

    init(exercise: RepMotionExercise) { detector = RepMotionDetector(exercise: exercise) }

    func start(calibration: RepCalibrationProfile) {
        stopUpdates()
        evidence = nil
        guard motion.isDeviceMotionAvailable else {
            fail("Motion sensing is unavailable on this watch. Enter reps in the set logger.")
            return
        }
        detector = RepMotionDetector(exercise: detector.exercise, calibration: calibration)
        count = 0
        if detector.exercise.verticalStart != nil {
            // Both hands can be on the bar when the starting pose is sampled.
            setupDeadline = Date().addingTimeInterval(5)
            phase = .preparing
            let token = generation
            scheduleTimeout(after: 5) { [weak self] in
                guard let self, self.generation == token else { return }
                self.beginSampling()
            }
        } else {
            beginSampling()
        }
    }

    private func beginSampling() {
        phase = .calibrating
        let token = generation
        // If access is denied or the bottom position never settles, allow a
        // retry and give manual logging back immediately.
        scheduleTimeout(after: 20) { [weak self] in
            self?.fail("Couldn’t find a still starting position. Hold the starting pose and retry. Check Motion & Fitness access if this continues.")
        }
        motion.deviceMotionUpdateInterval = 1 / 25
        motion.startDeviceMotionUpdates(to: .main) { [weak self] sample, error in
            guard let self, self.generation == token else { return }
            if error != nil {
                if self.phase == .counting {
                    self.review(interruption: true)
                } else {
                    self.fail("Motion data is unavailable. Check Motion & Fitness access, or enter reps in the set logger.")
                }
                return
            }
            guard let sample else { return }
            let g = sample.gravity
            let a = sample.userAcceleration
            self.detector.sample(time: sample.timestamp, gravity: SIMD3(g.x, g.y, g.z), acceleration: SIMD3(a.x, a.y, a.z))
            if self.phase == .calibrating, self.detector.calibrated {
                self.phase = .counting
                WKInterfaceDevice.current().play(.start)
                self.scheduleTimeout(after: 300) { [weak self] in self?.review(interruption: true) }
            }
            if self.count != self.detector.count { self.count = self.detector.count }
        }
    }

    func review(interruption: Bool = false) {
        guard phase == .counting else { return }
        stopUpdates()
        evidence = interruption || detector.interrupted ? nil : detector.evidence
        message = interruption || detector.interrupted ? "Motion was interrupted. Check the count." :
            detector.consistent ? "Consistent motion. Check the count." : "Limited or uneven motion. Check the count."
        phase = .review
    }

    private func fail(_ explanation: String) {
        stopUpdates()
        message = explanation
        phase = .unavailable
    }

    private func scheduleTimeout(after seconds: Double, action: @escaping () -> Void) {
        timeout?.cancel()
        let work = DispatchWorkItem(block: action)
        timeout = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    func stopUpdates() {
        generation += 1
        timeout?.cancel()
        timeout = nil
        motion.stopDeviceMotionUpdates()
    }
}

private struct RepCounterView: View {
    let exercise: RepMotionExercise
    let owner: String?
    let limit: Int
    let onConfirm: (Int, RepMotionEvidence?) -> Void
    private let store = RepCalibrationStore(defaults: .standard)
    @Environment(\.dismiss) private var dismiss
    @StateObject private var capture: RepCapture
    @State private var corrected = 0.0
    @FocusState private var editingCount: Bool
    @State private var profile: RepCalibrationProfile
    @State private var learning: Bool
    @State private var showingCalibration = false
    @State private var confirmingReset = false
    private let earlierReviews: Int
    private let earlierExact: Int

    init(exercise: RepMotionExercise, name: String, owner: String?, limit: Int, onConfirm: @escaping (Int, RepMotionEvidence?) -> Void) {
        self.exercise = exercise
        self.owner = owner
        self.limit = limit
        self.onConfirm = onConfirm
        _capture = StateObject(wrappedValue: RepCapture(exercise: exercise))
        let saved = RepCalibrationStore(defaults: .standard)
        _profile = State(initialValue: saved.profile(owner: owner, exerciseID: exercise.rawValue))
        _learning = State(initialValue: saved.isLearningEnabled(owner: owner, exerciseID: exercise.rawValue))
        // Earlier versions counted reviews without saving motion evidence.
        let legacyKey = owner.map { "repMotion.v1." + $0 + "." + name.lowercased() }
        earlierReviews = legacyKey.map { UserDefaults.standard.integer(forKey: $0 + ".reviews") } ?? 0
        earlierExact = legacyKey.map { UserDefaults.standard.integer(forKey: $0 + ".exact") } ?? 0
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                switch capture.phase {
                case .ready, .unavailable:
                    Text(capture.phase == .ready ? exercise.startCue : capture.message)
                    Button(exercise.verticalStart == nil ? "Start counting" : "Start in 5 seconds") {
                        WorkoutManager.shared.startIfAllowed()
                        capture.start(calibration: learning ? profile : RepCalibrationProfile())
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    if owner != nil {
                        Button("Rep learning") {
                            showingCalibration = true
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                case .preparing:
                    Text("Get into position")
                    Text(timerInterval: min(Date(), capture.setupDeadline)...capture.setupDeadline, countsDown: true)
                        .font(.title2).monospacedDigit()
                    Text(exercise.startCue).font(.footnote)
                case .calibrating:
                    ProgressView()
                    Text(exercise.startCue)
                    Text("Hold still until the tap.").font(.footnote)
                case .counting:
                    Text("\(capture.count)").font(.largeTitle).monospacedDigit()
                        .accessibilityLabel("\(capture.count) reps detected")
                    Text("Return to the start position after each rep.")
                    Button("Finish counting") { capture.review() }.buttonStyle(PrimaryButtonStyle())
                case .review:
                    Text("Detected \(capture.count)")
                    Text(capture.message).font(.footnote)
                    Stepper(value: $corrected, in: 0...Double(limit), step: 1) {
                        Text("\(Int(corrected)) reps").monospacedDigit()
                    }
                    .focusable()
                    .focused($editingCount)
                    .digitalCrownRotation($corrected, from: 0, through: Double(limit), by: 1)
                    .onAppear { editingCount = true }
                    Button("Use \(Int(corrected)) reps") {
                        onConfirm(Int(corrected), learning ? capture.evidence : nil)
                        dismiss()
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(corrected < 1)
                }
                Button("Cancel") { dismiss() }.buttonStyle(SecondaryButtonStyle())
            }
        }
        .navigationTitle("Rep counter")
        .onChange(of: capture.phase) { _, phase in
            WatchLiftMirror.shared.liveReps = phase == .counting ? capture.count : nil
            if phase == .review { corrected = Double(min(limit, capture.count)) }
        }
        .sheet(isPresented: $showingCalibration) { calibrationSettings }
        .onChange(of: capture.count) { _, count in
            if capture.phase == .counting { WatchLiftMirror.shared.liveReps = count }
        }
        .onDisappear {
            WatchLiftMirror.shared.liveReps = nil
            capture.stopUpdates()
        }
    }

    private var calibrationSettings: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text(exercise.displayName).font(.headline)
                Toggle("Learn from my sets", isOn: Binding(
                    get: { learning },
                    set: { value in
                        store.setLearningEnabled(value, owner: owner, exerciseID: exercise.rawValue)
                        learning = value
                    }
                ))
                Text(learning ? "Log the final count on this Watch. Sensitivity changes when several sets support the same adjustment." :
                        "Using standard sensitivity. Turn learning on to resume your saved calibration.")
                    .font(.footnote)
                let reviews = profile.reviewCount()
                if reviews > 0 {
                    Text("\(profile.exactCount()) of \(reviews) recent learning sets matched your final count.")
                        .font(.footnote)
                    if learning {
                        let setting = profile.setting()
                        Text(setting == 0 ? "Using standard sensitivity." : setting < 0
                             ? "Tuned to pick up smaller movements." : "Tuned to ignore smaller movements.")
                            .font(.footnote)
                    }
                }
                if profile.exercise != nil {
                    Button("Reset this lift") { confirmingReset = true }
                        .buttonStyle(SecondaryButtonStyle())
                }
                if earlierReviews > 0 {
                    Text("Earlier reviews matched on \(earlierExact) of \(earlierReviews) sets.")
                        .font(.footnote)
                }
                Button("Done") { showingCalibration = false }.buttonStyle(PrimaryButtonStyle())
            }
            .padding(.horizontal, 2)
        }
        .confirmationDialog("Reset learning for this lift?", isPresented: $confirmingReset, titleVisibility: .visible) {
            Button("Reset calibration", role: .destructive) {
                store.reset(owner: owner, exerciseID: exercise.rawValue)
                profile = RepCalibrationProfile()
            }
            Button("Cancel", role: .cancel) {}
        }
    }
}
