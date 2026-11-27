import Foundation

/// Opt-in prototype for movements in which the watch arm travels through an arc.
enum RepMotionExercise {
    case curl, lateralRaise

    init?(name: String) {
        switch name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "dumbbell curl", "db curl", "hammer curl", "incline db curl", "incline dumbbell curl":
            self = .curl
        case "lateral raise", "dumbbell lateral raise", "db lateral raise":
            self = .lateralRaise
        default: return nil
        }
    }

    var riseAngle: Double { self == .curl ? 55 : 43 }
}

/// Uses gravity in the watch's local frame. The angle between two gravity
/// vectors is independent of which wrist the watch is on or how it is strapped.
/// A rep needs an outward excursion and a return to the calibrated bottom.
struct RepMotionDetector {
    let exercise: RepMotionExercise
    private(set) var calibrated = false
    private(set) var count = 0
    private(set) var interrupted = false
    private var firstTime: Double?
    private var lastTime: Double?
    private var steadySince: Double?
    private var candidate = SIMD3<Double>(repeating: 0)
    private var origin = SIMD3<Double>(repeating: 0)
    private var filteredAngle = 0.0
    private var excursionStart: Double?
    private var peak = 0.0
    private var armed = false
    private var reachedTop = false
    private var depths: [Double] = []

    init(exercise: RepMotionExercise) { self.exercise = exercise }

    /// Descriptive signal quality for review, not a calibrated probability.
    var consistent: Bool {
        guard !interrupted, depths.count >= 3, let low = depths.min(), let high = depths.max() else { return false }
        return low >= exercise.riseAngle + 6 && high - low <= 28
    }

    private static func dot(_ a: SIMD3<Double>, _ b: SIMD3<Double>) -> Double {
        a.x * b.x + a.y * b.y + a.z * b.z
    }

    private static func angle(_ a: SIMD3<Double>, _ b: SIMD3<Double>) -> Double {
        acos(min(1, max(-1, dot(a, b)))) * 180 / .pi
    }

    mutating func sample(time: Double, gravity: SIMD3<Double>) {
        let length = sqrt(Self.dot(gravity, gravity))
        guard time.isFinite, length.isFinite, length > 0.5,
              time > (lastTime ?? -.infinity) else { return }
        let unit = gravity / length
        let delta = time - (lastTime ?? time)
        if firstTime == nil { firstTime = time }
        lastTime = time
        guard let firstTime, time - firstTime >= 2 else { return }
        if !calibrated {
            if steadySince == nil || delta > 0.4 || Self.angle(unit, candidate) > 6 {
                steadySince = time
                candidate = unit
            } else if let steadySince, time - steadySince >= 0.65 {
                origin = unit
                calibrated = true
                armed = true
            }
            return
        }

        let angle = Self.angle(unit, origin)
        if delta > 0.4 {
            interrupted = true
            filteredAngle = angle
            resetCycle(atBottom: angle <= 18)
            return
        }
        filteredAngle += (angle - filteredAngle) * (1 - exp(-delta / 0.08))
        if filteredAngle <= 18 {
            if let start = excursionStart, reachedTop, (0.45...14).contains(time - start) {
                count += 1
                depths.append(peak)
            }
            resetCycle(atBottom: true)
        } else if armed {
            if excursionStart == nil { excursionStart = time }
            peak = max(peak, filteredAngle)
            if peak >= exercise.riseAngle { reachedTop = true }
        }
    }

    private mutating func resetCycle(atBottom: Bool) {
        armed = atBottom
        reachedTop = false
        excursionStart = nil
        peak = 0
    }
}
