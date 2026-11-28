import Foundation

struct RehearsalCourse: Codable, Equatable {
    struct Point: Codable, Equatable {
        var lat: Double
        var lon: Double
        var valid: Bool { (-90...90).contains(lat) && (-180...180).contains(lon) }
        func offset(from other: Point) -> (x: Double, y: Double) {
            var delta = lon - other.lon
            if delta > 180 { delta -= 360 }
            if delta < -180 { delta += 360 }
            return (delta * 111_195 * cos((lat + other.lat) * .pi / 360), (lat - other.lat) * 111_195)
        }
    }
    struct Checkpoint: Codable, Equatable, Identifiable {
        var id: String
        var name: String
        var kind: String
        var pointIndex: Int
        var meters: Double
        var targetSeconds: Double?
        var instruction: String?
        var isStop: Bool { ["aid", "fuel", "water"].contains(kind) }
    }
    var id: String
    var name: String
    var date: String
    var points: [Point]
    var checkpoints: [Checkpoint]
    var distanceMeters: Double

    var valid: Bool {
        guard !id.isEmpty, !name.isEmpty, (2...450).contains(points.count), points.allSatisfy(\.valid),
              distanceMeters.isFinite, distanceMeters > 0, (1...40).contains(checkpoints.count),
              Set(checkpoints.map(\.id)).count == checkpoints.count else { return false }
        var index = 0
        var lastMeters = 0.0
        for cp in checkpoints {
            guard !cp.id.isEmpty, points.indices.contains(cp.pointIndex), cp.pointIndex >= index,
                  cp.meters >= lastMeters, cp.meters <= distanceMeters + 1 else { return false }
            index = cp.pointIndex
            lastMeters = cp.meters
        }
        return true
    }

    /// Limit matching to the leg leading to the next checkpoint. A return leg
    /// on the same street must not credit the athlete with the outbound finish.
    func progress(at fix: Point, between previous: Checkpoint?, and next: Checkpoint, lastProgress: Double) -> Double? {
        let from = previous?.pointIndex ?? 0
        guard fix.valid, points.indices.contains(from), points.indices.contains(next.pointIndex), next.pointIndex > from else { return nil }
        var length = 0.0
        var nearest = Double.infinity
        var candidates: [(offset: Double, along: Double)] = []
        for i in (from + 1)...next.pointIndex {
            let a = points[i - 1], b = points[i]
            let vector = b.offset(from: a), athlete = fix.offset(from: a)
            let segment = hypot(vector.x, vector.y)
            guard segment > 0 else { continue }
            let fraction = max(0, min(1, (athlete.x * vector.x + athlete.y * vector.y) / (segment * segment)))
            let offset = hypot(athlete.x - fraction * vector.x, athlete.y - fraction * vector.y)
            nearest = min(nearest, offset)
            if offset <= 50 { candidates.append((offset, length + fraction * segment)) }
            length += segment
        }
        guard length > 0, nearest <= 50 else { return nil }
        let before = previous?.meters ?? 0
        let close = candidates.filter { $0.offset <= nearest + 5 }
            .map { before + (next.meters - before) * $0.along / length }
        guard let local = close.min(by: { abs($0 - lastProgress) < abs($1 - lastProgress) }) else { return nil }
        // For overlapping streets and out-and-backs without a turnaround pin,
        // choose nearby forward progress once the outbound match falls behind.
        if local < lastProgress - 5,
           let forward = close.filter({ $0 >= lastProgress && $0 - lastProgress <= 150 }).min() { return forward }
        return local
    }
}

struct RehearsalAttempt: Codable, Equatable {
    struct Mark: Codable, Equatable {
        var checkpointId: String
        var name: String
        var kind: String
        var meters: Double
        var targetSeconds: Double?
        var elapsedSeconds: Int
        var status: String
        var departedSeconds: Int?
    }
    struct Result: Encodable {
        let type = "rehearsal"
        var id: String
        var owner: String
        var date: String
        var courseId: String
        var name: String
        var startedAt: String
        var endedAt: String
        var marks: [Mark]
        var distanceMeters: Double
    }
    var id = UUID().uuidString
    var owner: String
    var course: RehearsalCourse
    var start: Date
    var marks: [Mark] = []
    var distanceMeters = 0.0
    var alerted: String?
    var next: RehearsalCourse.Checkpoint? {
        course.checkpoints.indices.contains(marks.count) ? course.checkpoints[marks.count] : nil
    }
    var atStop: Bool {
        guard let mark = marks.last, let cp = course.checkpoints.prefix(marks.count).last else { return false }
        return cp.isStop && mark.status == "taken" && mark.departedSeconds == nil
    }
    func elapsed(_ now: Date) -> Int { max(0, Int(now.timeIntervalSince(start))) }

    mutating func mark(taken: Bool, at now: Date) {
        guard !atStop, let cp = next else { return }
        marks.append(Mark(checkpointId: cp.id, name: cp.name, kind: cp.kind, meters: cp.meters,
                          targetSeconds: cp.targetSeconds, elapsedSeconds: elapsed(now), status: taken ? "taken" : "skipped"))
        if taken { distanceMeters = max(distanceMeters, cp.meters) }
    }
    mutating func depart(at now: Date) {
        guard atStop else { return }
        marks[marks.count - 1].departedSeconds = max(elapsed(now), marks[marks.count - 1].elapsedSeconds)
    }
    mutating func locate(_ point: RehearsalCourse.Point) {
        guard !atStop, let next,
              let meters = course.progress(at: point, between: course.checkpoints.prefix(marks.count).last, and: next, lastProgress: distanceMeters) else { return }
        distanceMeters = max(distanceMeters, meters)
    }
    mutating func prompt(at now: Date, fix: RehearsalCourse.Point?) -> Bool {
        guard !atStop, let next, alerted != next.id else { return false }
        let due = next.targetSeconds.map { $0 > 0 && Double(elapsed(now)) >= $0 } ?? false
        let near = fix.map { point in
            let offset = point.offset(from: course.points[next.pointIndex])
            return hypot(offset.x, offset.y) <= 35 && next.meters - distanceMeters <= 45
        } ?? false
        guard due || near else { return false }
        alerted = next.id
        return true
    }
    func result(at end: Date) -> Result {
        var copy = self
        copy.depart(at: end)
        let format = Date.ISO8601FormatStyle.iso8601(timeZone: .gmt, includingFractionalSeconds: true)
        return Result(id: id, owner: owner, date: course.date, courseId: course.id, name: course.name,
                      startedAt: start.formatted(format), endedAt: max(start, end).formatted(format), marks: copy.marks,
                      distanceMeters: min(course.distanceMeters, distanceMeters.rounded()))
    }
}
