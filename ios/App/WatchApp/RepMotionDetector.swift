import Foundation

private struct ArcRepTracker {
    let rise: Double
    let bottom: Double
    private(set) var count = 0
    private var start: Double?
    private var peak: Double = 0
    private var armed = true
    private var smallest = Double.infinity
    private var largest = 0.0

    init(baseRise: Double, offset: Int) {
        rise = baseRise * (1 + Double(offset) * 0.13)
        bottom = min(rise * 0.55, 18 - Double(offset) * 2)
    }

    var consistent: Bool { count >= 3 && smallest >= rise + 6 && largest - smallest <= 28 }

    mutating func reset(at angle: Double) {
        start = nil
        peak = 0
        armed = angle <= bottom
    }

    mutating func sample(time: Double, angle: Double) {
        if angle <= bottom {
            if let start, peak >= rise, (0.45...14).contains(time - start) {
                count += 1
                smallest = min(smallest, peak)
                largest = max(largest, peak)
            }
            reset(at: angle)
        } else if armed {
            if start == nil { start = time }
            peak = max(peak, angle)
        }
    }
}

/// The alternative trackers see the exact same samples. Only the active count
/// is displayed; their five totals allow a logged correction to test whether a
/// different sensitivity would actually have improved this set.
struct RepMotionDetector {
    let exercise: RepMotionExercise
    private let index: Int
    private(set) var calibrated = false
    private(set) var interrupted = false
    private var firstTime: Double?
    private var lastTime: Double?
    private var steadySince: Double?
    private var candidate = SIMD3<Double>(repeating: 0)
    private var origin = SIMD3<Double>(repeating: 0)
    private var filteredAngle = 0.0
    private var arcs: [ArcRepTracker]
    private var vertical = VerticalRepTracker()

    init(exercise: RepMotionExercise, calibration: RepCalibrationProfile = .init(), asOf date: Date = Date()) {
        self.exercise = exercise
        let offset = calibration.exercise == exercise ? calibration.setting(asOf: date) : 0
        index = offset + 2
        arcs = RepCalibrationProfile.settings.map { ArcRepTracker(baseRise: exercise.riseAngle, offset: $0) }
    }

    var count: Int { exercise.verticalStart != nil ? vertical.counts[index] : arcs[index].count }

    var consistent: Bool {
        !interrupted && (exercise.verticalStart != nil ? vertical.consistent(at: index) : arcs[index].consistent)
    }

    var evidence: RepMotionEvidence {
        let counts = exercise.verticalStart != nil ? vertical.counts : arcs.map(\.count)
        return RepMotionEvidence(exercise: exercise, counts: counts, detected: count, uninterrupted: calibrated && !interrupted)
    }

    private static func dot(_ a: SIMD3<Double>, _ b: SIMD3<Double>) -> Double {
        a.x * b.x + a.y * b.y + a.z * b.z
    }

    private static func angle(_ a: SIMD3<Double>, _ b: SIMD3<Double>) -> Double {
        acos(min(1, max(-1, dot(a, b)))) * 180 / .pi
    }

    mutating func sample(time: Double, gravity: SIMD3<Double>, acceleration: SIMD3<Double>? = nil) {
        let length = sqrt(Self.dot(gravity, gravity))
        guard time.isFinite, time > (lastTime ?? -.infinity) else { return }
        guard length.isFinite, length > 0.5 else {
            if calibrated { interrupted = true }
            return
        }
        let unit = gravity / length
        let delta = time - (lastTime ?? time)
        if firstTime == nil { firstTime = time }
        lastTime = time
        guard let firstTime, time - firstTime >= 2 else { return }

        var verticalAcceleration = 0.0
        var still = true
        if let direction = exercise.verticalStart {
            guard let acceleration, Self.dot(acceleration, acceleration) <= 4 * 4 else {
                if calibrated { interrupted = true }
                steadySince = nil
                vertical.resetCycle()
                return
            }
            // Core Motion reports upward acceleration as negative Z face-up,
            // where gravity is also negative Z (Apple Bubble Level, step 17).
            // Their dot product therefore reports positive upward acceleration.
            verticalAcceleration = Self.dot(acceleration, unit) * Double(direction)
            guard abs(verticalAcceleration) <= 2.5 else {
                if calibrated { interrupted = true }
                steadySince = nil
                vertical.resetCycle()
                return
            }
            still = Self.dot(acceleration, acceleration) < 0.08 * 0.08
        }
        if !calibrated {
            if !still {
                steadySince = nil
            } else if steadySince == nil || delta > 0.4 || Self.angle(unit, candidate) > 6 {
                steadySince = time
                candidate = unit
            } else if let steadySince, time - steadySince >= 0.65 {
                origin = unit
                calibrated = true
            }
            return
        }

        if delta > 0.4 {
            interrupted = true
            if exercise.verticalStart != nil {
                vertical.resetCycle()
            } else {
                filteredAngle = Self.angle(unit, origin)
                for i in arcs.indices { arcs[i].reset(at: filteredAngle) }
            }
            return
        }
        if exercise.verticalStart != nil {
            vertical.sample(time: time, acceleration: verticalAcceleration)
        } else {
            let angle = Self.angle(unit, origin)
            filteredAngle += (angle - filteredAngle) * (1 - exp(-delta / 0.08))
            for i in arcs.indices { arcs[i].sample(time: time, angle: filteredAngle) }
        }
    }
}
