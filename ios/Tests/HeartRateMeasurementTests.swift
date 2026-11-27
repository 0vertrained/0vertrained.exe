import Foundation

// swiftc ios/App/App/HeartRateMeasurement.swift ios/Tests/HeartRateMeasurementTests.swift -o /tmp/ot-hr-tests
@main
struct HeartRateMeasurementTests {
    static func main() {
        let single = HeartRateMeasurement(Data([0, 75]))
        precondition(single?.bpm == 75 && single?.rrMs == [])
        let extended = HeartRateMeasurement(Data([0x1f, 0x04, 0x01, 1, 0, 0, 4, 0, 3, 0, 0]))
        precondition(extended?.bpm == 260 && extended?.rrMs == [1000, 750, 0])
        let optionalEnergy = HeartRateMeasurement(Data([0x08, 89, 0x12, 0x00]))
        precondition(optionalEnergy?.bpm == 89 && optionalEnergy?.rrMs == [])
        let invalid: [[UInt8]] = [[], [0], [0, 0], [0x04, 78], [0x01, 0x23], [0x01, 0xff, 0xff],
                                 [0x08, 80, 0], [0x10, 80], [0x10, 80, 0x20]]
        for packet in invalid { precondition(HeartRateMeasurement(Data(packet)) == nil) }
        print("Heart Rate Measurement fixtures passed")
    }
}
