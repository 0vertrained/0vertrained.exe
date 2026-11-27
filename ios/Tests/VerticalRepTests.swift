import Foundation

@main
struct VerticalRepTests {
    struct Trace {
        var detector = VerticalRepTracker()
        var time = 0.0
        var dt = 0.04
        mutating func send(_ g: Double) {
            detector.sample(time: time, acceleration: g)
            time += dt
        }
        mutating func still(_ duration: Double) {
            for _ in 0..<Int(duration / dt) { send(0) }
        }
        // Differentiate a smooth excursion analytically to generate readings,
        // independently of the tracker's integration and return checks.
        mutating func cycle(meters: Double, seconds: Double) {
            let n = Int((seconds / dt).rounded())
            let omega = 2 * Double.pi / (Double(n) * dt)
            for i in 0..<n {
                send(meters * omega * omega * cos(Double(i) * dt * omega) / (2 * 9.80665))
            }
        }
    }

    static func main() {
        for dt in [0.03125, 0.04, 0.05] {
            var set = Trace(dt: dt)
            set.still(1)
            for cadence in [2.8, 2.8, 2.8, 2.8, 2.8, 2.8] {
                set.cycle(meters: 0.43, seconds: cadence)
                set.still(0.6)
            }
            precondition(set.detector.counts == [6,6,6,6,6], "Pausing reps: \(set.detector.counts)")
            precondition(set.detector.consistent(at: 2))
        }

        var continuous = Trace()
        continuous.still(1)
        for cadence in [1.6, 2, 2.4, 4, 3, 2] {
            continuous.cycle(meters: 0.45, seconds: cadence)
        }
        continuous.still(0.8)
        precondition(continuous.detector.counts[2] == 6, "Continuous reps: \(continuous.detector.counts)")

        var desk = Trace()
        for n in 0..<500 { desk.send(sin(Double(n)) * 0.02) }
        for _ in 0..<5 { desk.cycle(meters: 0.055, seconds: 1.8); desk.still(0.4) }
        precondition(desk.detector.counts == [0,0,0,0,0])

        var dropout = Trace()
        dropout.still(0.5)
        for _ in 0..<7 { dropout.send(0.14) }
        dropout.time += 1
        for _ in 0..<7 { dropout.send(-0.14) }
        dropout.still(1)
        precondition(dropout.detector.counts[2] == 0)
        dropout.cycle(meters: 0.42, seconds: 2.8)
        dropout.still(1)
        precondition(dropout.detector.counts[2] == 1)
        print("Vertical rep cadence, travel and interruption fixtures passed")
    }
}
