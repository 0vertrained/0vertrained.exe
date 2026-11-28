import Foundation

@main
struct RehearsalCourseTests {
    static func main() throws {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        typealias Point = RehearsalCourse.Point
        let course = RehearsalCourse(id: "race", name: "Out and back", date: "2026-12-01",
            points: [Point(lat: 0, lon: 0), Point(lat: 0, lon: 0.01), Point(lat: 0, lon: 0)],
            checkpoints: [.init(id: "aid", name: "Refill", kind: "aid", pointIndex: 1, meters: 1000, targetSeconds: 300),
                          .init(id: "home", name: "Home", kind: "finish", pointIndex: 2, meters: 2000, targetSeconds: nil)],
            distanceMeters: 2000)
        precondition(course.valid)
        var invalid = course
        invalid.checkpoints[0].pointIndex = 4
        precondition(!invalid.valid)
        var attempt = RehearsalAttempt(owner: "athlete-a", course: course, start: start)
        attempt.locate(Point(lat: 0, lon: 0.005))
        precondition(abs(attempt.distanceMeters - 500) < 0.001)
        attempt.locate(Point(lat: 0.1, lon: 0.01))
        precondition(abs(attempt.distanceMeters - 500) < 0.001)
        // The return leg starts at the same coordinate as the finish.
        precondition(!attempt.prompt(at: start, fix: course.points[2]))
        attempt.locate(course.points[1])
        precondition(attempt.prompt(at: start.addingTimeInterval(280), fix: course.points[1]))
        precondition(!attempt.prompt(at: start.addingTimeInterval(350), fix: nil))
        attempt.mark(taken: true, at: start.addingTimeInterval(302))
        precondition(attempt.atStop && attempt.marks[0].elapsedSeconds == 302)
        var restored = try JSONDecoder().decode(RehearsalAttempt.self, from: JSONEncoder().encode(attempt))
        precondition(restored == attempt && restored.owner == "athlete-a")
        restored.mark(taken: true, at: start.addingTimeInterval(304))
        precondition(restored.marks.count == 1)
        restored.depart(at: start.addingTimeInterval(322))
        restored.locate(Point(lat: 0, lon: 0.005))
        precondition(restored.marks[0].departedSeconds == 322 && abs(restored.distanceMeters - 1500) < 0.001)
        restored.mark(taken: true, at: start.addingTimeInterval(640))
        let result = restored.result(at: start.addingTimeInterval(645))
        precondition(result.id == attempt.id && result.distanceMeters == 2000 && result.marks.count == 2)
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(result)) as! [String: Any]
        precondition(object["type"] as? String == "rehearsal" && object["courseId"] as? String == "race")
        precondition(object["owner"] as? String == "athlete-a" && object["date"] as? String == course.date)
        // An out-and-back also works when the finish is the only checkpoint.
        var loop = course
        loop.checkpoints.removeFirst()
        var folded = RehearsalAttempt(owner: "b", course: loop, start: start)
        folded.locate(loop.points[0])
        precondition(folded.distanceMeters == 0)
        folded.locate(Point(lat: 0, lon: 0.0099))
        folded.locate(Point(lat: 0, lon: 0.0095))
        precondition(abs(folded.distanceMeters - 1050) < 0.01)
        precondition(attempt.result(at: start.addingTimeInterval(310)).marks[0].departedSeconds == 310)
        var manual = RehearsalAttempt(owner: "athlete-b", course: course, start: start)
        precondition(manual.prompt(at: start.addingTimeInterval(300), fix: nil))
        manual.mark(taken: false, at: start.addingTimeInterval(300))
        precondition(!manual.atStop && manual.distanceMeters == 0 && manual.marks[0].status == "skipped")
        manual.mark(taken: true, at: start.addingTimeInterval(600))
        precondition(manual.next == nil && manual.result(at: start.addingTimeInterval(600)).distanceMeters == 2000)
        print("Race rehearsal GPS matching, manual checkpoints, aid timing, alerts, persistence and result fixtures passed")
    }
}
