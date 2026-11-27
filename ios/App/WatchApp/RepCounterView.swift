import CoreMotion
import SwiftUI
import WatchKit

/// Opening the sheet does not activate motion. Each set needs its own Start,
/// a review, and the logger's usual Log set action.
struct RepCounterButton: View {
    let exercise: RepMotionExercise
    let name: String
    let limit: Int
    let onConfirm: (Int) -> Void
    @State private var showing = false

    var body: some View {
        Button("Count reps · beta") { showing = true }
            .buttonStyle(SecondaryButtonStyle())
            .sheet(isPresented: $showing) {
                RepCounterView(exercise: exercise, name: name, limit: limit, onConfirm: onConfirm)
            }
    }
}

private final class RepCapture: ObservableObject {
    enum Phase: Equatable { case ready, calibrating, counting, review, unavailable }
    @Published private(set) var phase: Phase = .ready
    @Published private(set) var count = 0
    @Published private(set) var message = ""

    private let motion = CMMotionManager()
    private var detector: RepMotionDetector
    private var timeout: DispatchWorkItem?
    private var generation = 0

    init(exercise: RepMotionExercise) { detector = RepMotionDetector(exercise: exercise) }

    func start() {
        stopUpdates()
        guard motion.isDeviceMotionAvailable else {
            fail("Motion sensing is unavailable on this watch. Enter reps in the set logger.")
            return
        }
        detector = RepMotionDetector(exercise: detector.exercise)
        count = 0
        phase = .calibrating
        let token = generation
        // If access is denied or the bottom position never settles, allow a
        // retry and give manual logging back immediately.
        scheduleTimeout(after: 20) { [weak self] in
            self?.fail("Couldn’t find a still starting position. Lower your watch arm and retry. Check Motion & Fitness access if this continues.")
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
            self.detector.sample(time: sample.timestamp, gravity: SIMD3(g.x, g.y, g.z))
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
    let limit: Int
    let onConfirm: (Int) -> Void
    @Environment(\.dismiss) private var dismiss
    @StateObject private var capture: RepCapture
    @State private var corrected = 0.0
    @FocusState private var editingCount: Bool
    @AppStorage private var reviews: Int
    @AppStorage private var exactCounts: Int

    init(exercise: RepMotionExercise, name: String, limit: Int, onConfirm: @escaping (Int) -> Void) {
        self.limit = limit
        self.onConfirm = onConfirm
        _capture = StateObject(wrappedValue: RepCapture(exercise: exercise))
        let key = "repMotion.v1." + (SessionStore.shared.athleteOwner ?? "local") + "." + name.lowercased()
        _reviews = AppStorage(wrappedValue: 0, key + ".reviews")
        _exactCounts = AppStorage(wrappedValue: 0, key + ".exact")
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                switch capture.phase {
                case .ready, .unavailable:
                    Text(capture.phase == .ready
                         ? "Count reps on your watch arm. Tap Start, lower your arm and hold still. Begin on the wrist tap."
                         : capture.message)
                    if reviews > 0 {
                        Text("\(exactCounts) of \(reviews) reviewed counts matched on this lift.")
                            .font(.footnote)
                    }
                    Button("Start counting") {
                        WorkoutManager.shared.startIfAllowed()
                        capture.start()
                    }
                    .buttonStyle(PrimaryButtonStyle())
                case .calibrating:
                    ProgressView()
                    Text("Lower your watch arm and hold still until the tap.")
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
                        reviews += 1
                        if Int(corrected) == capture.count { exactCounts += 1 }
                        onConfirm(Int(corrected))
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
            if phase == .review { corrected = Double(min(limit, capture.count)) }
        }
        .onDisappear { capture.stopUpdates() }
    }
}
