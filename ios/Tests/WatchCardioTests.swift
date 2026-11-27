import Foundation

@main
struct WatchCardioTests {
    static func main() throws {
        let json = """
        {"id":"1","date":"2026-11-27","name":"Stair intervals","activity":"stair",
         "warmup":{"goal":{"kind":"time","seconds":60}},
         "blocks":[{"iterations":2,"steps":[{"purpose":"work","goal":{"kind":"time","seconds":90}},
         {"purpose":"recovery","goal":{"kind":"open"}}]}],"cooldown":{"goal":{"kind":"time","seconds":60}}}
        """
        let spec = try JSONDecoder().decode(RunSpec.self, from: Data(json.utf8))
        let start = Date(timeIntervalSince1970: 0)
        var progress = CardioProgress(spec: spec, start: start, index: 0, beganStep: start, owner: "athlete")
        precondition(!progress.catchUp(at: start.addingTimeInterval(59)))
        precondition(progress.catchUp(at: start.addingTimeInterval(160)))
        precondition(progress.index == 2 && progress.durations == [60, 90])
        let restored = try JSONDecoder().decode(CardioProgress.self, from: JSONEncoder().encode(progress))
        precondition(restored.owner == "athlete")
        progress = restored
        precondition(!progress.catchUp(at: start.addingTimeInterval(190)))
        precondition(progress.next(at: start.addingTimeInterval(200)))
        let segments = progress.segments(until: start.addingTimeInterval(230))
        precondition(segments.count == 4)
        precondition(segments[2]["label"] as? String == "Recover" && segments[2]["seconds"] as? Int == 50)
        precondition(segments[3]["seconds"] as? Int == 30 && segments[3]["targetSeconds"] as? Int == 90)
        precondition(progress.catchUp(at: start.addingTimeInterval(310)))
        precondition(progress.next(at: start.addingTimeInterval(320)))
        precondition(progress.catchUp(at: start.addingTimeInterval(400)))
        precondition(!progress.next(at: start.addingTimeInterval(420)))
        precondition(progress.segments(until: start.addingTimeInterval(420)).count == 6)
        print("Watch cardio timer, recovery and segment fixtures passed")
    }
}
