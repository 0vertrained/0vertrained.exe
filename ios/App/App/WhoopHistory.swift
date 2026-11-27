import Foundation

// WHOOP 4 frame layouts and transfer boundaries observed on 41.17.6.0.
// https://github.com/ryanbr/noop/blob/main/docs/PROTOCOL_SENSORS.md#whoop-4
// https://github.com/ryanbr/noop/blob/main/docs/PROTOCOL_TRANSPORT.md#whoop-4-history-lifecycle
struct WhoopHistoryReading {
    let timestamp: Int64
    let bpm: Int?
    let rrMs: [Int]
    let gravity: [Double]?
    let onWrist: Bool?

    init?(_ frame: Data) {
        guard frame.count >= 19, frame[4] == 47 else { return nil }
        let seconds = Int64(Self.u32(frame, 11))
        guard seconds >= 1_577_836_800, seconds <= Int64(Date().timeIntervalSince1970) + 300 else { return nil }
        timestamp = seconds * 1_000
        switch (frame[5], frame.count) {
        case (24, 104), (12, 104):
            let count = Int(frame[22])
            guard count <= 4 else { return nil }
            onWrist = frame[55] != 0
            let rate = Int(frame[21])
            bpm = onWrist == true && (20...250).contains(rate) ? rate : nil
            // Keep zero placeholders in place so HRV cannot span a missing beat.
            rrMs = bpm == nil ? [] : (0..<count).map { Self.u16(frame, 23 + $0 * 2) }
            gravity = Self.validGravity([40, 44, 48].map { Double(Float(bitPattern: Self.u32(frame, $0))) })
        case (25, 84):
            bpm = nil
            rrMs = []
            onWrist = nil
            gravity = Self.validGravity([73, 75, 77].map {
                Double(Int16(bitPattern: UInt16(Self.u16(frame, $0)))) / 16_384
            })
            guard gravity != nil else { return nil }
        default: return nil
        }
    }

    static func u16(_ bytes: Data, _ offset: Int) -> Int {
        Int(bytes[offset]) | Int(bytes[offset + 1]) << 8
    }

    private static func u32(_ bytes: Data, _ offset: Int) -> UInt32 {
        UInt32(u16(bytes, offset)) | UInt32(u16(bytes, offset + 2)) << 16
    }

    private static func validGravity(_ values: [Double]) -> [Double]? {
        guard values.allSatisfy({ $0.isFinite && abs($0) <= 8 }), values.contains(where: { $0 != 0 }) else { return nil }
        return values
    }

    var dictionary: [String: Any] {
        var result: [String: Any] = ["timestamp": timestamp, "bpm": bpm as Any? ?? NSNull(), "rrMs": rrMs]
        if let onWrist { result["onWrist"] = onWrist }
        if let gravity { result["gravity"] = gravity }
        return result
    }

    static func batteryEvent(_ frame: Data) -> Int? {
        guard frame.count >= 31, frame[4] == 48, frame[6] == 3 else { return nil }
        let tenths = u16(frame, 17)
        return tenths <= 1000 ? (tenths + 5) / 10 : nil
    }

    static func battery(_ frame: Data, sequence: UInt8) -> Int? {
        guard frame.count >= 15, frame[4] == 36, frame[6] == 26, frame[7] == sequence, frame[8] == 1 else { return nil }
        let tenths = u16(frame, 9)
        return tenths <= 1000 ? (tenths + 5) / 10 : nil
    }
}

struct WhoopHistoryFailure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

// A frame reaches this state machine only after CRC verification. Dropping or
// corrupting a notification ends the transfer; it must never skip ahead to END.
struct WhoopHistoryTransfer {
    enum Action {
        case none
        case commit([Data], token: Data)
        case complete
    }
    private var started = false
    private var bytes = 0
    private var chunk: [Data] = []

    // A new data-channel packet type within a history block belongs in the
    // archive until its meaning is known. Independently delivered live HR,
    // raw samples, commands, console logs and realtime IMU are excluded.
    static func carriesHistory(_ frame: Data, onDataChannel: Bool) -> Bool {
        switch frame[4] {
        case 47, 48, 49, 52: return true
        case 35...38, 40, 43, 50, 51, 55: return false
        default: return onDataChannel
        }
    }

    mutating func ingest(_ frame: Data, onDataChannel: Bool = true) throws -> Action {
        guard Self.carriesHistory(frame, onDataChannel: onDataChannel) else { return .none }
        switch frame[4] {
        case 49:
            switch frame[6] {
            case 1:
                guard chunk.isEmpty else { throw WhoopHistoryFailure("The strap restarted a partial history block. Reconnect to retry.") }
                started = true
            case 2:
                guard started, frame.count >= 29 else { throw WhoopHistoryFailure("Incomplete history boundary. Reconnect to retry.") }
                let rows = chunk
                chunk.removeAll(keepingCapacity: true)
                bytes = 0
                return .commit(rows, token: Data(frame[17..<25]))
            case 3:
                guard chunk.isEmpty else { throw WhoopHistoryFailure("The strap ended before confirming its last block. Reconnect to retry.") }
                return .complete
            default:
                throw WhoopHistoryFailure("Unrecognized WHOOP history boundary. Reconnect to retry.")
            }
        default:
            guard started else {
                if frame[4] != 47 && frame[4] != 52 { return .none }
                throw WhoopHistoryFailure("The history start marker was missed. Reconnect to retry.")
            }
            bytes += frame.count
            guard bytes <= 8 * 1_024 * 1_024, chunk.count < 65_536 else {
                throw WhoopHistoryFailure("This history block exceeds the supported size. It remains on your strap.")
            }
            chunk.append(frame)
        }
        return .none
    }
}
