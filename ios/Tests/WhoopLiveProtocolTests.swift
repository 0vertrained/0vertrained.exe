import Foundation

// Constructed WHOOP 4 wire examples. Trailer values were generated independently
// with zlib. No captured athlete data or physical device is needed for these tests.
@main
enum WhoopLiveProtocolTests {
    static func bytes(_ hex: String) -> Data {
        Data(hex.split(separator: " ").map { UInt8($0, radix: 16)! })
    }

    static func main() {
        let first = bytes("AA 14 00 03 28 0B 00 F1 53 65 00 00 4B 03 20 03 00 00 30 03 80 E7 51 B8")
        let second = bytes("AA 0E 00 D6 28 0C 01 F1 53 65 00 00 70 00 27 12 60 A3")
        let expected = [WhoopLiveReading(bpm: 75, rrMs: [800, 0, 816]), WhoopLiveReading(bpm: 112, rrMs: [])]
        let combined = first + second
        for split in 0...combined.count {
            var decoder = WhoopLiveFrameDecoder()
            let a = decoder.append(Data(combined.prefix(split)))
            let b = decoder.append(Data(combined.dropFirst(split)))
            precondition(a + b == expected)
        }
        var decoder = WhoopLiveFrameDecoder()
        var badHeader = first
        badHeader[3] ^= 1
        var badCRC = first
        badCRC[12] ^= 1
        let invalidRRCount = bytes("AA 10 00 57 28 0D 02 F1 53 65 00 00 4B 02 20 03 A7 C8 3F 6A")
        let noPulse = bytes("AA 0E 00 D6 28 0E 03 F1 53 65 00 00 00 00 2A 44 8C E0")
        let rawSensors = bytes("AA 0E 00 D6 2B 0B 00 F1 53 65 00 00 4B 00 4B 2B 2E DC")
        let shortBody = bytes("AA 0D 00 E9 28 0C 01 F1 53 65 00 00 4E EF 3E 19 12")
        for invalid in [badHeader, badCRC, invalidRRCount, noPulse, rawSensors, shortBody] {
            precondition(decoder.append(invalid).isEmpty)
        }
        precondition(decoder.append(Data([0x00, 0xFF, 0xAA, 0x01, 0x00, 0xFF]) + second) == [expected[1]])
        precondition(WhoopLiveProtocol.pairingRead == bytes("AA 08 00 A8 23 01 1A 00 20 4F 2C 22"))
        precondition(WhoopLiveProtocol.setStreaming(true) == bytes("AA 08 00 A8 23 02 03 01 F7 68 6D CC"))
        precondition(WhoopLiveProtocol.setStreaming(false) == bytes("AA 08 00 A8 23 03 03 00 56 32 A8 BA"))
        print("WHOOP 4 live protocol tests passed")
    }
}
