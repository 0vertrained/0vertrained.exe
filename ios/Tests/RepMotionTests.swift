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

    static func main() {
        precondition(RepMotionExercise(name: "Hammer Curl") == .curl)
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
        print("Watch rep motion fixtures passed")
    }
}
