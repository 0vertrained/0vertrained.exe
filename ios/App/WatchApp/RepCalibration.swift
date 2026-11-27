import Foundation

/// Only the five alternative counts and the count actually shown leave a capture.
struct RepMotionEvidence: Equatable {
    let exercise: RepMotionExercise
    let counts: [Int]
    let detected: Int
    let uninterrupted: Bool
}

struct RepCalibrationProfile: Codable, Equatable {
    // Indexed from easier to stricter, with the factory setting in the middle.
    static let settings = -2...2
    private static let middle = 2
    private static let limit = 24
    private static let retention: TimeInterval = 90 * 24 * 60 * 60

    private struct Review: Codable, Equatable {
        let id: String
        let date: Date
        let counts: [Int]
        let detected: Int
        let confirmed: Int

        var usable: Bool {
            guard !id.isEmpty, id.utf8.count <= 128, date.timeIntervalSince1970.isFinite,
                  counts.count == RepCalibrationProfile.settings.count, counts.allSatisfy({ (0...150).contains($0) }),
                  counts.contains(detected), (2...100).contains(confirmed),
                  counts.contains(where: { $0 >= 2 }) else { return false }
            // A mistyped correction or a movement none of the detectors saw
            // has no trustworthy evidence for choosing a different setting.
            return counts.contains { abs($0 - confirmed) <= (confirmed >= 20 ? 2 : 1) }
        }

        func loss(at index: Int) -> Int { min(2, abs(counts[index] - confirmed)) }
    }

    private(set) var exercise: RepMotionExercise?
    private var reviews: [Review] = []

    init() {}

    private enum CodingKeys: String, CodingKey { case exercise, reviews }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        exercise = try values.decodeIfPresent(RepMotionExercise.self, forKey: .exercise)
        let saved = try values.decode([Review].self, forKey: .reviews)
        var seen = Set<String>()
        reviews = Array(saved.suffix(Self.limit).filter { $0.usable && seen.insert($0.id).inserted })
    }

    private func recent(asOf now: Date) -> [Review] {
        let cutoff = now.addingTimeInterval(-Self.retention)
        return reviews.filter { $0.date >= cutoff && $0.date <= now }
    }

    func reviewCount(asOf now: Date = Date()) -> Int { recent(asOf: now).count }

    func exactCount(asOf now: Date = Date()) -> Int {
        recent(asOf: now).filter { $0.detected == $0.confirmed }.count
    }

    /// Positive settings require stronger excursions. Re-evaluating the small
    /// review window makes undo exact and allows a change in technique to age in.
    func setting(asOf now: Date = Date()) -> Int {
        let samples = recent(asOf: now)
        guard samples.count >= 3 else { return 0 }
        let baseline = samples.map { $0.loss(at: Self.middle) }
        let baselineLoss = baseline.reduce(0, +)
        var best = 0
        var bestLoss = baselineLoss
        // Favor the smallest change whenever two alternatives perform equally.
        for offset in [-1, 1, -2, 2] {
            var wins = 0, losses = 0, total = 0
            for (sample, factoryLoss) in zip(samples, baseline) {
                let loss = sample.loss(at: offset + Self.middle)
                total += loss
                if loss < factoryLoss { wins += 1 }
                if loss > factoryLoss { losses += 1 }
            }
            if wins >= 3, wins - losses >= 2, baselineLoss - total >= 3, total < bestLoss {
                best = offset
                bestLoss = total
            }
        }
        return best
    }

    @discardableResult
    mutating func review(_ evidence: RepMotionEvidence, confirmed: Int, setID: String, on date: Date = Date()) -> Bool {
        guard evidence.uninterrupted, exercise == nil || exercise == evidence.exercise else { return false }
        let example = Review(id: setID, date: date, counts: evidence.counts, detected: evidence.detected, confirmed: confirmed)
        guard example.usable, !reviews.contains(where: { $0.id == setID }) else { return false }
        exercise = evidence.exercise
        // Keep a later review if the watch clock has just moved backwards.
        let cutoff = date.addingTimeInterval(-Self.retention)
        var kept = reviews.filter { $0.date >= cutoff }
        kept.append(example)
        kept.sort { $0.date < $1.date || ($0.date == $1.date && $0.id < $1.id) }
        reviews = Array(kept.suffix(Self.limit))
        return true
    }

    mutating func remove(setID: String) {
        reviews.removeAll { $0.id == setID }
    }
}
