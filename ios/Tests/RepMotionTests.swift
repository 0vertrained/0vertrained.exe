import Foundation

@main
struct RepMotionTests {
    /// Represents an arm moving through a controlled arc. Azimuth and tilt
    /// rotate the entire trace to cover different watch orientations.
    struct Trace {
        var detector: RepMotionDetector
        var time = 0.0
        var period = 0.04
        var tilt = 0.0
        var azimuth = 0.0

        mutating func sample(_ angle: Double) {
            let a = angle * .pi / 180 + tilt
            detector.sample(time: time, gravity: SIMD3(sin(a) * cos(azimuth), sin(a) * sin(azimuth), cos(a)))
            time += period
        }

        mutating func bottom(_ seconds: Double) {
            for _ in 0..<Int(seconds / period) { sample(0) }
        }

        mutating func cycle(peak: Double, seconds: Double) {
            let samples = max(2, Int(seconds / period))
            for i in 0...samples {
                sample(peak * (1 - cos(2 * .pi * Double(i) / Double(samples))) / 2)
            }
        }
    }

    /// Face-up device convention in Apple's Bubble Level example: upward
    /// physical acceleration reads as negative userAcceleration.z.
    static func verticalFixtures() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        func trace(_ exercise: RepMotionExercise, outwardIsUp: Bool, gravity: SIMD3<Double>,
                   travel: [Double] = Array(repeating: 0.45, count: 6), seconds: Double = 2.4,
                   profile: RepCalibrationProfile = .init()) -> RepMotionDetector {
            var detector = RepMotionDetector(exercise: exercise, calibration: profile, asOf: now)
            var time = 0.0
            func emit(_ upG: Double) {
                detector.sample(time: time, gravity: gravity, acceleration: gravity * upG)
                time += 0.04
            }
            for _ in 0..<80 { emit(0) }
            precondition(detector.calibrated)
            let radiansPerSecond = Double.pi * 2 / seconds
            for distance in travel {
                // A complete outward excursion and return, beginning at rest.
                for i in 0..<Int((seconds / 0.04).rounded()) {
                    let t = (Double(i) + 0.5) * 0.04
                    let outward = 0.5 * distance * radiansPerSecond * radiansPerSecond * cos(t * radiansPerSecond)
                    emit((outwardIsUp ? outward : -outward) / 9.80665)
                }
                for _ in 0..<15 { emit(0) }
            }
            return detector
        }
        let squat = trace(.backSquat, outwardIsUp: false, gravity: SIMD3(0, 0, -1))
        precondition(squat.count == 6 && squat.evidence.uninterrupted)
        let press = trace(.overheadPress, outwardIsUp: true, gravity: SIMD3(0, 0, -1))
        precondition(press.count == 6 && press.evidence.uninterrupted)
        let rotated = trace(.overheadPress, outwardIsUp: true, gravity: SIMD3(0, 0.6, 0.8))
        precondition(rotated.evidence.counts == press.evidence.counts)
        var incomplete = press
        incomplete.sample(time: 100, gravity: SIMD3(0, 0, -1), acceleration: nil)
        precondition(!incomplete.evidence.uninterrupted && incomplete.count == 6)

        // Shorter complete strokes escape the default distance threshold.
        // Check against different travel, cadence and sensor orientation after
        // learning, and against an independent exercise using the same signal.
        var profile = RepCalibrationProfile()
        for i in 0..<3 {
            let observed = trace(.overheadPress, outwardIsUp: true, gravity: SIMD3(0, 0, -1),
                                 travel: [0.4, 0.16, 0.42, 0.41, 0.16, 0.43], seconds: [2.2, 2.4, 2.6][i])
            precondition(observed.count == 4)
            precondition(profile.review(observed.evidence, confirmed: 6, setID: "press-\(i)", on: now))
        }
        precondition(profile.setting(asOf: now) == -1)
        let travel = [0.18, 0.46, 0.18, 0.44, 0.42, 0.40, 0.18]
        let normal = trace(.overheadPress, outwardIsUp: true, gravity: SIMD3(0.6, -0.8, 0), travel: travel, seconds: 2.8)
        let learned = trace(.overheadPress, outwardIsUp: true, gravity: SIMD3(0.6, -0.8, 0), travel: travel, seconds: 2.8,
                            profile: profile)
        precondition(normal.count == 4 && learned.count == 7)
        let different = trace(.backSquat, outwardIsUp: false, gravity: SIMD3(0.6, -0.8, 0), travel: travel, seconds: 2.8,
                              profile: profile)
        precondition(different.count == 4)
    }

    static func calibrationFixtures() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        func observed(peaks: [Double], profile: RepCalibrationProfile = .init(),
                      duration: Double = 2.2, tilt: Double = 0) -> RepMotionEvidence {
            var run = Trace(detector: RepMotionDetector(exercise: .curl, calibration: profile, asOf: now), tilt: tilt)
            run.bottom(3.0)
            for peak in peaks { run.cycle(peak: peak, seconds: duration) }
            run.bottom(0.3)
            return run.detector.evidence
        }

        // Eight normal arcs and two shallow arcs. Only the easier candidates
        // can explain the athlete's actual ten. Test predictions on a new trace.
        let shallow = Array(repeating: 95.0, count: 8) + [53, 53]
        let under = observed(peaks: shallow)
        precondition(under.detected == 8 && under.counts[1] == 10)
        var profile = RepCalibrationProfile()
        for i in 1...3 {
            precondition(profile.review(under, confirmed: 10, setID: "work-\(i)", on: now))
            if i < 3 { precondition(profile.setting(asOf: now) == 0) }
        }
        precondition(profile.setting(asOf: now) == -1)
        precondition(!profile.review(under, confirmed: 10, setID: "work-3", on: now))
        let heldOut = [50.5, 103, 86, 90, 51.8, 100, 89, 101, 94, 93]
        let after = observed(peaks: heldOut, profile: profile, duration: 2.8, tilt: 1.2)
        precondition(after.detected == 10 && profile.exactCount(asOf: now) == 0)
        precondition(profile.review(after, confirmed: 10, setID: "work-4", on: now))
        precondition(profile.exactCount(asOf: now) == 1 && profile.reviewCount(asOf: now) == 4)
        precondition(!profile.review(after, confirmed: 85, setID: "typo", on: now))
        let broken = RepMotionEvidence(exercise: .curl, counts: under.counts, detected: 8, uninterrupted: false)
        precondition(!profile.review(broken, confirmed: 10, setID: "interrupted", on: now))
        let empty = observed(peaks: [])
        precondition(!profile.review(empty, confirmed: 2, setID: "empty", on: now))
        let other = RepMotionEvidence(exercise: .hammerCurl, counts: after.counts, detected: 10, uninterrupted: true)
        precondition(!profile.review(other, confirmed: 10, setID: "other-exercise", on: now))
        let disk = try JSONEncoder().encode(profile)
        var restored = try JSONDecoder().decode(RepCalibrationProfile.self, from: disk)
        precondition(restored == profile)
        restored.remove(setID: "work-4")
        restored.remove(setID: "work-3")
        precondition(restored.setting(asOf: now) == 0 && restored.reviewCount(asOf: now) == 2)
        precondition(profile.setting(asOf: now.addingTimeInterval(91 * 86_400)) == 0)
        precondition(profile.reviewCount(asOf: now.addingTimeInterval(-1)) == 0)

        // Some athletes reset/grip-adjust between full reps. Require repeated
        // evidence before stricter thresholds stop counting the smaller arcs.
        let fullAndReset = Array(repeating: 98.0, count: 7) + [59]
        let over = observed(peaks: fullAndReset)
        precondition(over.detected == 8 && over.counts[3] == 7)
        var strict = RepCalibrationProfile()
        for i in 0..<3 { strict.review(over, confirmed: 7, setID: "work-\(i)", on: now) }
        precondition(strict.setting(asOf: now) == 1)
        precondition(observed(peaks: [100, 99, 58, 90, 95, 94, 106, 103],
                              profile: strict, duration: 2.7, tilt: -0.8).detected == 7)
        strict.review(over, confirmed: 8, setID: "counterexample", on: now)
        precondition(strict.setting(asOf: now) == 0) // Benefit falls below the required margin.
        for i in 0..<30 {
            let day = now.addingTimeInterval(Double(i) * 86_400)
            strict.review(after, confirmed: 10, setID: "recent-\(i)", on: day)
        }
        precondition(strict.reviewCount(asOf: now.addingTimeInterval(29 * 86_400)) == 24)
    }

    static func main() throws {
        precondition(RepMotionExercise(name: "Hammer Curl") == .hammerCurl)
        precondition(RepMotionExercise(name: "Lateral Raise") == .lateralRaise)
        precondition(RepMotionExercise(name: "Seated Leg Curl") == nil)
        precondition(RepMotionExercise(name: "Machine Lateral Raise") == nil)

        var curls = Trace(detector: RepMotionDetector(exercise: .curl), tilt: 2.5, azimuth: -0.8)
        curls.bottom(3.2)
        precondition(curls.detector.calibrated && curls.detector.count == 0)
        for _ in 0..<10 { curls.cycle(peak: 102, seconds: 2.4) }
        curls.bottom(0.3)
        precondition(curls.detector.count == 10 && curls.detector.consistent)
        curls.cycle(peak: 38, seconds: 2)
        curls.bottom(0.3)
        precondition(curls.detector.count == 10)

        var raises = Trace(detector: RepMotionDetector(exercise: .lateralRaise), period: 0.05, tilt: -0.9, azimuth: 2.2)
        raises.bottom(3.2)
        for duration in [1.1, 1.8, 3.3, 5.2] { raises.cycle(peak: 73, seconds: duration) }
        raises.bottom(0.3)
        precondition(raises.detector.count == 4 && raises.detector.consistent)
        for i in 0..<60 { raises.sample(Double(i % 6)) }
        precondition(raises.detector.count == 4)

        var interrupted = Trace(detector: RepMotionDetector(exercise: .curl))
        interrupted.bottom(3.2)
        for _ in 0..<20 { interrupted.sample(90) }
        precondition(interrupted.detector.count == 0) // Can't count half a rep.
        interrupted.time += 1
        interrupted.bottom(0.5)
        precondition(interrupted.detector.count == 0 && interrupted.detector.interrupted)
        for _ in 0..<3 { interrupted.cycle(peak: 90, seconds: 2) }
        interrupted.bottom(0.3)
        precondition(interrupted.detector.count == 3 && !interrupted.detector.consistent)

        var moving = Trace(detector: RepMotionDetector(exercise: .curl))
        for i in 0..<125 { moving.sample(i.isMultiple(of: 2) ? 0 : 60) }
        precondition(!moving.detector.calibrated && moving.detector.count == 0)
        moving.bottom(0.9)
        precondition(moving.detector.calibrated)
        moving.cycle(peak: 110, seconds: 0.24)
        moving.bottom(0.5)
        precondition(moving.detector.count == 0)
        verticalFixtures()
        try calibrationFixtures()
        print("Watch rep motion and correction-learning fixtures passed")
    }
}
