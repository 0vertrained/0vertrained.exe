import Foundation

// WHOOP 4.0 Harvard BLE wire facts (firmware-dependent):
// https://github.com/ryanbr/noop/blob/main/docs/PROTOCOL_WHOOP4.md
// https://github.com/ryanbr/noop/blob/main/docs/PROTOCOL_SENSORS.md
// Offload controls and versioned historical layouts are in WhoopHistory.swift.
enum WhoopLiveProtocol {
    static let serviceUUID = "61080001-8d6d-82b8-614a-1c8cb0f8dcc6"
    static let commandUUID = "61080002-8d6d-82b8-614a-1c8cb0f8dcc6"
    static let responseUUID = "61080003-8d6d-82b8-614a-1c8cb0f8dcc6"
    static let eventUUID = "61080004-8d6d-82b8-614a-1c8cb0f8dcc6"
    static let dataUUID = "61080005-8d6d-82b8-614a-1c8cb0f8dcc6"

    // Fixed, independently checksummed requests. A confirmed battery read
    // allows iOS to perform normal link pairing before the live-stream request.
    static let pairingRead = Data([0xAA, 0x08, 0x00, 0xA8, 0x23, 0x01, 0x1A, 0x00, 0x20, 0x4F, 0x2C, 0x22])

    static func setStreaming(_ enabled: Bool) -> Data {
        if enabled {
            return Data([0xAA, 0x08, 0x00, 0xA8, 0x23, 0x02, 0x03, 0x01, 0xF7, 0x68, 0x6D, 0xCC])
        }
        return Data([0xAA, 0x08, 0x00, 0xA8, 0x23, 0x03, 0x03, 0x00, 0x56, 0x32, 0xA8, 0xBA])
    }

    static func command(_ number: UInt8, sequence: UInt8, payload: [UInt8]) -> Data {
        frame([35, sequence, number] + payload)
    }

    static func frame(_ body: [UInt8]) -> Data {
        precondition((3...65531).contains(body.count))
        let length = body.count + 4
        let field = [UInt8(truncatingIfNeeded: length), UInt8(length >> 8)]
        let crc = payloadChecksum(body[...])
        return Data([0xAA] + field + [headerChecksum(field[...])] + body +
                    (0..<4).map { UInt8(truncatingIfNeeded: crc >> ($0 * 8)) })
    }

    static func headerChecksum(_ bytes: ArraySlice<UInt8>) -> UInt8 {
        var crc: UInt8 = 0
        for byte in bytes {
            crc ^= byte
            for _ in 0..<8 {
                crc = crc & 0x80 == 0 ? crc << 1 : (crc << 1) ^ 0x07
            }
        }
        return crc
    }

    static func payloadChecksum(_ bytes: ArraySlice<UInt8>) -> UInt32 {
        var crc = UInt32.max
        for byte in bytes {
            crc ^= UInt32(byte)
            for _ in 0..<8 {
                crc = crc & 1 == 0 ? crc >> 1 : (crc >> 1) ^ 0xEDB88320
            }
        }
        return ~crc
    }
}

struct WhoopLiveReading: Equatable {
    let bpm: Int
    let rrMs: [Int]
}

// A CoreBluetooth notification may contain part of a frame or multiple frames.
// Create a fresh decoder for each connection and characteristic.
struct WhoopLiveFrameDecoder {
    private var buffer: [UInt8] = []

    var hasPartialFrame: Bool { !buffer.isEmpty }
    private(set) var discardedBytes = 0

    mutating func frames(_ data: Data) -> [Data] {
        discardedBytes = 0
        buffer.append(contentsOf: data)
        var result: [Data] = []
        var cursor = 0
        while cursor < buffer.count {
            guard let start = buffer[cursor...].firstIndex(of: 0xAA) else {
                discardedBytes += buffer.count - cursor
                cursor = buffer.count
                break
            }
            discardedBytes += start - cursor
            cursor = start
            guard buffer.count - start >= 4 else { break }
            let length = Int(buffer[start + 1]) | Int(buffer[start + 2]) << 8
            guard length >= 7, WhoopLiveProtocol.headerChecksum(buffer[(start + 1)...(start + 2)]) == buffer[start + 3] else {
                discardedBytes += 1
                cursor += 1
                continue
            }
            let checksumAt = start + length
            guard checksumAt + 4 <= buffer.count else { break }
            let body = buffer[(start + 4)..<checksumAt]
            let storedCRC = UInt32(buffer[checksumAt]) | UInt32(buffer[checksumAt + 1]) << 8
                | UInt32(buffer[checksumAt + 2]) << 16 | UInt32(buffer[checksumAt + 3]) << 24
            guard WhoopLiveProtocol.payloadChecksum(body) == storedCRC else {
                discardedBytes += 1
                cursor += 1
                continue
            }
            result.append(Data(buffer[start..<(checksumAt + 4)]))
            cursor = checksumAt + 4
        }
        if cursor > 0 { buffer.removeFirst(cursor) }
        return result
    }

    mutating func append(_ data: Data) -> [WhoopLiveReading] {
        frames(data).compactMap(Self.decodeHeartRate)
    }

    static func decodeHeartRate(_ frame: Data) -> WhoopLiveReading? {
        let body = [UInt8](frame).dropFirst(4).dropLast(4)
        let start = body.startIndex
        guard body.count >= 10, body[start] == 40 else { return nil }
        let bpm = Int(body[start + 8])
        let count = Int(body[start + 9])
        guard bpm > 0, count <= (body.count - 10) / 2 else { return nil }
        var intervals: [Int] = []
        for index in 0..<count {
            let field = start + 10 + index * 2
            let milliseconds = Int(body[field]) | Int(body[field + 1]) << 8
            intervals.append(milliseconds) // preserve missing-beat placeholders for HRV
        }
        return WhoopLiveReading(bpm: bpm, rrMs: intervals)
    }
}
