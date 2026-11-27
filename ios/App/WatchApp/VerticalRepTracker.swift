import Foundation

/// Detect one controlled outward-and-return stroke along gravity. Integration
/// restarts at each rep, so a slowly drifting velocity cannot accumulate meters
/// across the set. Travel is a detector feature, never a reported range of motion.
struct VerticalRepTracker {
    private enum Phase { case ready, outbound, returning }
    private static let minimumTravel = [0.105, 0.13, 0.155, 0.18, 0.205]
    private(set) var counts = Array(repeating: 0, count: 5)
    private var minDepth = Array(repeating: Double.infinity, count: 5)
    private var maxDepth = Array(repeating: 0.0, count: 5)
    private var phase = Phase.ready
    private var previousTime: Double?
    private var started = 0.0
    private var acceleration = 0.0
    private var velocity = 0.0
    private var position = 0.0
    private var farthest = 0.0
    private var needsStillness = false
    private var quietTime = 0.0

    func consistent(at index: Int) -> Bool {
        guard counts.indices.contains(index), counts[index] >= 3 else { return false }
        return minDepth[index] >= Self.minimumTravel[index] * 1.12 && maxDepth[index] <= minDepth[index] * 1.65
    }

    mutating func resetCycle() {
        clearStroke()
        previousTime = nil
        needsStillness = true
        quietTime = 0
    }

    private mutating func clearStroke() {
        phase = .ready
        acceleration = 0
        velocity = 0
        position = 0
        farthest = 0
    }

    mutating func sample(time: Double, acceleration signedG: Double) {
        guard time.isFinite, signedG.isFinite, abs(signedG) <= 2.5 else { resetCycle(); return }
        guard let last = previousTime else { previousTime = time; return }
        let dt = time - last
        guard dt > 0 else { return }
        previousTime = time
        guard dt <= 0.4 else { resetCycle(); return }
        quietTime = abs(signedG) < 0.022 ? quietTime + dt : 0
        if needsStillness {
            if quietTime >= 0.24 { needsStillness = false }
            return
        }
        // Low-pass the linear acceleration before integrating. Damp the
        // velocity slowly and require a reversal and a substantial return.
        acceleration += (signedG * 9.80665 - acceleration) * (1 - exp(-dt / 0.055))
        let previousVelocity = velocity
        velocity = velocity * exp(-dt / 4.5) + acceleration * dt
        let displacement = (previousVelocity + velocity) * 0.5 * dt

        if phase == .ready {
            if velocity >= 0.06 {
                phase = .outbound
                started = time
                position = max(0, displacement)
                farthest = position
            } else if quietTime >= 0.32 {
                velocity = 0
            }
            return
        }
        position += displacement
        farthest = max(farthest, position)
        if time - started > 12 { resetCycle(); return }
        if phase == .outbound, velocity < -0.055 { phase = .returning }
        guard phase == .returning else { return }
        let returned = farthest - position
        let settled = quietTime >= 0.3 && abs(velocity) <= 0.065
        guard velocity >= -0.025 || settled else { return }
        let duration = time - started
        if duration >= 0.52, returned >= farthest * 0.72 {
            let excursion = min(farthest, returned)
            for (i, threshold) in Self.minimumTravel.enumerated() where excursion >= threshold {
                counts[i] += 1
                minDepth[i] = min(minDepth[i], excursion)
                maxDepth[i] = max(maxDepth[i], excursion)
            }
        }
        clearStroke()
    }
}
