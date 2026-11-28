import Foundation

@main
struct ClimbProtocolTests {
    static func metricReports() {
        // All fields, in little-endian wire order. The paired paces are two
        // independent 16-bit seconds-per-500m values in the GATT supplement.
        var packet = Data([0xfe, 0x1f])
        packet.append(contentsOf: [0x38, 4, 0x84, 3, 3, 2, 1])
        packet.append(contentsOf: [0xf4, 0xff, 0xf9, 0xff, 123, 0, 87, 0])
        packet.append(contentsOf: [150, 0, 180, 0, 250, 0, 0x84, 3, 15])
        packet.append(contentsOf: [153, 78, 0x84, 3, 0x2c, 1, 0xf4, 0xff, 42, 0])
        let expected: [String: Double] = [
            "speedMps": 3, "averageSpeedMps": 2.5, "distanceMeters": 66051,
            "inclinePercent": -1.2, "rampAngleDegrees": -0.7, "ascentMeters": 12.3, "descentMeters": 8.7,
            "paceSecondsPerKm": 300, "averagePaceSecondsPerKm": 360,
            "energyKcal": 250, "energyKcalPerHour": 900, "energyKcalPerMinute": 15,
            "heartRateBpm": 153, "metabolicEquivalent": 7.8, "elapsedSeconds": 900, "remainingSeconds": 300,
            "beltForceNewtons": -12, "powerWatts": 42
        ]
        precondition(ClimbTreadmillFrame(packet)?.observedMetrics == expected)
        precondition(ClimbTreadmillFrame(packet + Data([0])) == nil)
        let prefixKeys = ["speedMps", "averageSpeedMps", "distanceMeters", "inclinePercent",
                          "rampAngleDegrees", "ascentMeters", "descentMeters"]
        for count in 0..<packet.count {
            let decoded = ClimbTreadmillFrame(packet.prefix(count))
            if count == packet.count - 2 {
                precondition(decoded?.observedMetrics == expected.filter { prefixKeys.contains($0.key) })
            } else {
                precondition(decoded == nil)
            }
        }
        // One-byte legacy pace immediately precedes a pulse byte. The identical
        // length could mean a modern packet lost its final heart rate byte.
        let legacy = Data([0x2c,1, 0x38,4, 123,0,0, 15,0, 9,0, 52,159])
        precondition(ClimbTreadmillFrame(legacy)?.observedMetrics == [
            "speedMps":3, "distanceMeters":123, "inclinePercent":1.5, "rampAngleDegrees":0.9])
        let modern = Data([0x2c,1, 0x38,4, 123,0,0, 15,0, 9,0, 152,0,159])
        precondition(ClimbTreadmillFrame(modern)?.observedMetrics["paceSecondsPerKm"] == 304)
        precondition(ClimbTreadmillFrame(modern)?.observedMetrics["heartRateBpm"] == 159)
        let heartOnly = ClimbTreadmillFrame(Data([1, 1, 125]))
        precondition(heartOnly?.observedMetrics == ["heartRateBpm": 125])
        // Some consoles send zero or all ones when contact/sensor data is absent.
        for hr: UInt8 in [0, 255] {
            precondition(ClimbTreadmillFrame(Data([1, 1, hr]))?.observedMetrics.isEmpty == true)
        }
        precondition(ClimbTreadmillFrame(Data([0xff, 0x1f]) + Data(repeating: 0xff, count: packet.count - 4))?.observedMetrics ==
            ["inclinePercent": -0.1, "rampAngleDegrees": -0.1, "beltForceNewtons": -1, "powerWatts": -1])
        let unavailable = Data([0x8c, 0x10, 0xff,0xff, 0xff,0xff,0xff, 0xff,0x7f, 0xff,0x7f,
                                0xff,0xff, 0xff,0xff, 0xff, 0xff,0x7f, 0xff,0x7f])
        precondition(ClimbTreadmillFrame(unavailable)?.observedMetrics.isEmpty == true)
        // A valid zero distance and resting belt are different from missing readings.
        precondition(ClimbTreadmillFrame(Data([4,0, 0,0, 0,0,0]))?.observedMetrics == ["speedMps": 0, "distanceMeters": 0])

        let advertised = ClimbMachineFeatures(Data([0x3d,0xbe,0,0, 3,0,0,0]))!
        precondition(advertised.speedTargets && advertised.inclineTargets)
        precondition(advertised.advertisedMetrics.count == expected.count - 1)
        precondition(advertised.advertisedMetrics["speedMps"] == nil)
        precondition(advertised.advertisedMetrics.values.allSatisfy { $0 })
        let single = ClimbMachineFeatures(Data([0,4,0,0, 1,0,0,0]))!
        precondition(single.advertisedMetrics.filter { $0.value }.map { $0.key } == ["heartRateBpm"])
        precondition(single.speedTargets && !single.inclineTargets)
    }

    static func sustainedFollower() throws {
        typealias E = ClimbInclineReplay.Event
        typealias Trace = [[String: Any]]
        func simulate(_ events: [E], cap: Double = 10, autoAck: Bool = true) throws -> Trace {
            try ClimbInclineReplay.run(events: events, cap: cap, simulateAcknowledgements: autoAck)
        }
        func commands(_ trace: Trace) -> [Double] { trace.compactMap { $0["commandGrade"] as? Double } }
        let begin = [E(at: 0, type: .telemetry, speedMps: 3, inclinePercent: 0), E(at: 0,type: .arm)]
        let goal = E(at: 0.1,type: .target,grade: 8,sequence: 1)
        let warm = begin + [goal, E(at: 1,type: .tick), E(at: 3,type: .tick)]
        var hill = warm
        for grade in 1...3 {
            let now = Double(grade * 3)
            hill.append(E(at: now + 1,type: .telemetry,speedMps: 3,inclinePercent: Double(grade * 2)))
            hill.append(E(at: now + 1,type: .target,grade: 8,sequence: grade + 1))
            hill.append(E(at: now + 3,type: .tick))
        }
        hill += [E(at: 13,type: .telemetry,speedMps: 3,inclinePercent: 8),E(at: 15,type: .tick)]
        let trace = try simulate(hill)
        precondition(commands(trace) == [2,4,6,8])
        precondition(trace.last?["stage"] as? String == "armed" && trace.last?["targetGrade"] as? Double == 8)

        let clipped = try simulate(Array(hill.prefix(8)), cap: 3.2)
        precondition(commands(clipped) == [2,3] && clipped.last?["desiredGrade"] as? Double == 3.2)

        // A newer target while settling replaces the hill. Out-of-order requests never restore the old grade.
        let change = try simulate(warm + [E(at: 3.1,type:.target,grade:1,sequence:3), E(at:3.2,type:.target,grade:12,sequence:2),
            E(at:4,type:.telemetry,speedMps:3,inclinePercent:2), E(at:6,type:.tick)])
        precondition(commands(change) == [2,1] && change.last?["desiredGrade"] as? Double == 1)
        let expired = try simulate(warm + [E(at:4,type:.telemetry,speedMps:3,inclinePercent:2),
            E(at:5,type:.target,grade:8,sequence:1), E(at:6.11,type:.tick), E(at:7,type:.target,grade:4,sequence:2)])
        precondition(commands(expired) == [2] && expired.last?["stage"] as? String == "manual")
        precondition((expired.last?["reason"] as? String)?.contains("expired") == true && expired.last?["desiredGrade"] == nil)

        for action in [E(at:3.2,type:.pause), E(at:3.2,type:.background), E(at:3.2,type:.disconnect),
                       E(at:3.2,type:.console,grade:7), E(at:3.2,type:.telemetry,speedMps:0)] {
            let ended = try simulate(warm + [action, E(at:3.3,type:.ack,opcode:3,ok:true),
                E(at:4,type:.target,grade:12,sequence:2), E(at:6,type:.tick), E(at:7,type:.arm)])
            precondition(commands(ended) == [2] && ended.last?["stage"] as? String == "manual")
            precondition(ended[ended.count-1]["reason"] as? String == ended[ended.count-5]["reason"] as? String)
        }
        let explicit = begin + [E(at:0.1,type:.ack,opcode:0,ok:true),goal,E(at:3,type:.tick)]
        let pending = try simulate(explicit + [E(at:4,type:.telemetry,speedMps:3,inclinePercent:2),
            E(at:5,type:.target,grade:8,sequence:2),E(at:6,type:.tick),E(at:7,type:.ack,opcode:3,ok:true),
            E(at:8,type:.tick)],autoAck:false)
        precondition(commands(pending) == [2] && pending.last?["stage"] as? String == "manual")
        let dropping = try simulate(warm + [E(at:4,type:.target,grade:8,sequence:2),E(at:5,type:.tick)])
        precondition(dropping.last?["stage"] as? String == "manual")
        let noFeedback = try simulate(warm + [E(at:4,type:.telemetry,speedMps:3,inclinePercent:0),
            E(at:5,type:.target,grade:8,sequence:2), E(at:8,type:.telemetry,speedMps:3,inclinePercent:0),
            E(at:9,type:.target,grade:8,sequence:3), E(at:11,type:.tick)])
        precondition(commands(noFeedback) == [2] && noFeedback.last?["stage"] as? String == "manual")
        let denied = try simulate(begin + [E(at: 1,type:.ack,opcode:0,ok:false)],autoAck:false)
        precondition(denied.last?["stage"] as? String == "manual")
        do {
            _ = try simulate([E(at:1,type:.tick),E(at:0,type:.tick)])
            preconditionFailure("Reordered timestamps accepted")
        } catch is ClimbInclineReplay.InvalidInput {}
        precondition(ClimbQualification.qualified.isEmpty)
    }

    static func main() throws {
        // Allows the web differential fixture runner to submit the identical JSON timeline.
        if CommandLine.arguments.contains("--replay-stdin") {
            struct Input: Decodable {
                var events: [ClimbInclineReplay.Event]
                var cap: Double
                var simulateAcknowledgements: Bool?
            }
            let input = try JSONDecoder().decode(Input.self, from: FileHandle.standardInput.readDataToEndOfFile())
            let rows = try ClimbInclineReplay.run(events: input.events, cap: input.cap,
                                                  simulateAcknowledgements: input.simulateAcknowledgements ?? false)
            let json = try JSONSerialization.data(withJSONObject: ["version": 1, "rows": rows])
            FileHandle.standardOutput.write(json)
            return
        }
        metricReports()
        try sustainedFollower()
        // A speed of 10.80 km/h, 0x010203 metres and -1.2% inclination.
        let bytes = Data([0x0e,0, 0x38,0x04, 0x38,0x04, 3,2,1, 0xf4,0xff, 0xf9,0xff])
        let frame = ClimbTreadmillFrame(bytes)!
        precondition(frame.speedMps == 3 && frame.distanceMeters == 66_051 && frame.inclinePercent == -1.2)
        for i in 0..<bytes.count { precondition(ClimbTreadmillFrame(bytes.prefix(i)) == nil) }
        let fragment = ClimbTreadmillFrame(Data([5,0, 5,0,0]))!
        precondition(fragment.speedMps == nil && fragment.distanceMeters == 5 && fragment.inclinePercent == nil)
        precondition(ClimbTreadmillFrame(Data([0,0xe0])) == nil)
        precondition(ClimbTreadmillFrame(Data([0x80,0,0,0,0,0])) == nil)
        precondition(ClimbMachineFeatures(Data([0x0c,0,0,0,2,0,0,0]))!.inclineTargets)
        precondition(ClimbMachineFeatures(Data([0x0c,0,0,0])) == nil)
        precondition(ClimbInclineRange(Data([0,0,100,0,0,0])) == nil)
        // Device-reported range -2 to 12%, step of 0.5%.
        let range = ClimbInclineRange(Data([0xec,0xff,120,0,5,0]))!
        precondition(range.minimum == -2 && range.maximum == 12 && range.increment == 0.5)

        var fields = ClimbTelemetry()
        let epoch = Date(timeIntervalSince1970: 999)
        fields.update(frame, uptime: 60, date: epoch)
        fields.update(fragment, uptime: 64, date: epoch.addingTimeInterval(4))
        precondition(fields.speed?.fresh(65) == false && fields.distance?.fresh(65) == true)
        precondition(fields.speed?.wallMilliseconds == 999_000 && fields.distance?.wallMilliseconds == 1_003_000)
        precondition(ClimbQualification.qualified.isEmpty)

        let q = ClimbQualification(maker:"Test fixture",model:"Sim",firmware:"1",low:-2,high:12,maxChange:1.2,interval:2,settleTimeout:6,tolerance:0.15)
        let id = UUID().uuidString
        func readings(_ time: Double, _ gradeTenths: UInt8 = 0, speedLow: UInt8 = 150) -> ClimbTelemetry {
            var t = ClimbTelemetry()
            let packet = Data([8,0,speedLow,0,gradeTenths,0,0,0])
            t.update(ClimbTreadmillFrame(packet)!, uptime: time, date: epoch)
            return t
        }
        func acquire(_ c: inout ClimbControl, _ qualification: ClimbQualification?, confirm: Bool = true, foreground: Bool = true) -> Data? {
            c.arm(owner:"a", recordingID:id, cap:4, confirmed:confirm, foreground:foreground,
                  qualification:qualification, range:range, telemetry:readings(0), now:0)
        }
        var c = ClimbControl()
        precondition(acquire(&c, nil) == nil)
        precondition(acquire(&c, q, confirm:false) == nil)
        precondition(acquire(&c, q, foreground:false) == nil)
        precondition(acquire(&c,q) == Data([0]))
        let generation = c.token!
        c.indication(Data([0x80,0x00,1]),now:0.2)
        precondition(c.stage == .armed)
        var sequence = 0
        func request(_ c: inout ClimbControl, _ grade: Double, _ at: Double, _ current: UInt8 = 0, owner: String = "a", token: UUID? = nil) -> Data? {
            sequence += 1
            let telemetry = readings(at,current)
            guard c.setGoal(grade:grade, sequence:sequence, owner:owner, recordingID:id, token:token ?? generation,
                            telemetry:telemetry, foreground:true, now:at) else { return nil }
            return c.advance(telemetry:telemetry, foreground:true, now:at)
        }
        precondition(request(&c,12,1) == nil) // rate limit
        precondition(request(&c,12,2,owner:"b") == nil)
        precondition(request(&c,12,2,token:UUID()) == nil)
        precondition(request(&c,12,2) == Data([0x03, 10,0])) // One 1% step toward distant target
        precondition(c.stage == .acknowledging)
        precondition(request(&c,8,2.1) == nil) // No competing procedure
        c.indication(Data([0x80,0x03,1]),now:2.2)
        c.check(telemetry:readings(4,5),foreground:true,now:4)
        precondition(c.stage == .settling)
        c.check(telemetry:readings(5,10),foreground:true,now:5)
        precondition(c.stage == .armed)
        var snapshot = c
        snapshot.check(telemetry:readings(5,20),foreground:true,now:5)
        precondition(snapshot.stage == .manual) // Console override apparent in measured grade
        for event: Data in [Data([0x01]), Data([0x02,2]), Data([0x03]), Data([0xff]), Data([0x06,50,0])] {
            snapshot = c; snapshot.machineStatus(event); precondition(snapshot.stage == .manual)
        }
        snapshot = c; snapshot.check(telemetry:readings(5,10),foreground:false,now:5); precondition(snapshot.stage == .manual)
        snapshot = c; snapshot.check(telemetry:readings(5,10,speedLow:0),foreground:true,now:5); precondition(snapshot.stage == .manual)
        snapshot = c; snapshot.check(telemetry:readings(5,10),foreground:true,now:11); precondition(snapshot.stage == .manual)
        var now = 6.0
        for grade: UInt8 in [10,20,30] {
            precondition(request(&c,90,now,grade) == Data([0x03, grade + 10, 0]))
            c.indication(Data([0x80,3,1]),now:now+0.2)
            c.check(telemetry:readings(now+1,grade+10),foreground:true,now:now+1)
            now += 2
        }
        precondition(c.target == 4 && request(&c,99,now,40) == nil) // Athlete cap
        precondition(request(&c,0,now,40) != nil)
        c.check(telemetry:readings(now+5,40),foreground:true,now:now+5)
        precondition(c.stage == .manual && c.token == nil)
        c.indication(Data([0x80,3,1]),now:now+6)
        precondition(c.stage == .manual)
        print("FTMS treadmill decoding, sample freshness, model qualification and incline control fixtures passed.")
    }
}
