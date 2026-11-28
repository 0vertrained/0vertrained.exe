import Foundation

@main
struct ClimbProtocolTests {
    static func main() {
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
        func request(_ c: inout ClimbControl, _ grade: Double, _ at: Double, _ current: UInt8 = 0, owner: String = "a", token: UUID? = nil) -> Data? {
            c.request(grade:grade, owner:owner, recordingID:id, token:token ?? generation, now:at, telemetry:readings(at,current), foreground:true)
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
