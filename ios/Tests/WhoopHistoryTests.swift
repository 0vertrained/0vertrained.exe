import Foundation
#if os(macOS)
import SQLite3
#endif

// Synthetic strap traffic. No real athlete identifiers, readings or captures.
@main
enum WhoopHistoryTests {
    static let timestamp: Int64 = 1_700_000_000_000
    static let token: [UInt8] = [23, 7, 0, 0, 6, 0, 0, 0]
    static let start = WhoopLiveProtocol.frame([49, 2, 1])
    static let end = WhoopLiveProtocol.frame([49, 3, 2] + Array(repeating: 0, count: 10) + token)
    static let complete = WhoopLiveProtocol.frame([49, 4, 3])

    static func record(version: UInt8 = 24, seconds: Int64 = timestamp / 1000, bpm: UInt8 = 70,
                       contact: UInt8 = 1, length: Int = 104, rrCount: UInt8 = 2) -> Data {
        var bytes = Array(repeating: UInt8(0), count: length - 4)
        bytes[4] = 47
        bytes[5] = version
        for i in 0..<4 { bytes[11 + i] = UInt8(truncatingIfNeeded: seconds >> (8 * i)) }
        bytes[21] = bpm
        bytes[22] = rrCount
        bytes[23] = 0x5c
        bytes[24] = 3
        bytes[25] = 0x62
        bytes[26] = 3
        bytes[43] = 0x3f
        bytes[55] = contact
        if version == 25 { bytes[74] = 0x40 }
        return WhoopLiveProtocol.frame(Array(bytes.dropFirst(4)))
    }

    static func rejects(_ action: () throws -> Void) {
        do { try action(); preconditionFailure("Expected a rejected transfer") } catch {}
    }

    static func main() throws {
        // Expected trailers were computed separately using zlib CRC32.
        precondition(WhoopLiveProtocol.command(22, sequence: 5, payload: [0]) ==
            Data([0xaa, 0x08, 0x00, 0xa8, 0x23, 0x05, 0x16, 0x00, 0xf0, 0xa8, 0x90, 0x89]))
        precondition(WhoopLiveProtocol.command(23, sequence: 6, payload: [1] + token) ==
            Data([0xaa, 0x10, 0x00, 0x57, 0x23, 0x06, 0x17, 0x01, 0x17, 0x07,
                  0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x96, 0xd2, 0x74, 0xb8]))
        let second = record(seconds: timestamp / 1000 + 1, bpm: 71)
        let off = WhoopHistoryReading(record(contact: 0))!
        precondition(off.bpm == nil && off.rrMs.isEmpty && off.onWrist == false)
        let reading = WhoopHistoryReading(record())!
        precondition(reading.timestamp == timestamp && reading.bpm == 70 && reading.rrMs == [860, 866])
        precondition(WhoopHistoryReading(record(rrCount: 3))?.rrMs == [860, 866, 0])
        let motion = WhoopHistoryReading(record(version: 25, length: 84))!
        precondition(motion.gravity == [1, 0, 0] && motion.bpm == nil && motion.rrMs.isEmpty)
        precondition(WhoopHistoryReading(record(version: 24, length: 84)) == nil)
        precondition(WhoopHistoryReading(record(seconds: 0)) == nil)
        precondition(WhoopHistoryReading(record(rrCount: 5)) == nil)
        let unknown = record(version: 99)
        precondition(WhoopHistoryReading(unknown) == nil)
        var event = Array(repeating: UInt8(0), count: 23)
        event[0] = 48
        event[2] = 3
        event[13] = 0xe8
        event[14] = 3
        precondition(WhoopHistoryReading.batteryEvent(WhoopLiveProtocol.frame(event)) == 100)
        event[14] = 4
        precondition(WhoopHistoryReading.batteryEvent(WhoopLiveProtocol.frame(event)) == nil)
        let battery = WhoopLiveProtocol.frame([36, 91, 26, 7, 1, 0x09, 3])
        precondition(WhoopHistoryReading.battery(battery, sequence: 7) == 78)
        precondition(WhoopHistoryReading.battery(battery, sequence: 91) == nil)
        precondition(WhoopHistoryReading.battery(WhoopLiveProtocol.frame([36, 1, 26, 7, 0, 10, 0]), sequence: 7) == nil)

        var corrupt = record()
        corrupt[27] ^= 1
        var wire = WhoopLiveFrameDecoder()
        let combined = start + record() + second + unknown + end + complete
        for split in 0...combined.count {
            var decoder = WhoopLiveFrameDecoder()
            let result = decoder.frames(Data(combined.prefix(split))) + decoder.frames(Data(combined.dropFirst(split)))
            precondition(result == [start, record(), second, unknown, end, complete])
            precondition(decoder.discardedBytes == 0)
        }
        _ = wire.frames(corrupt + end)
        precondition(wire.discardedBytes > 0) // the plugin withholds ACK for the entire batch

        var transfer = WhoopHistoryTransfer()
        rejects { _ = try transfer.ingest(end) }
        _ = try transfer.ingest(start)
        _ = try transfer.ingest(record())
        rejects { _ = try transfer.ingest(complete) }
        transfer = WhoopHistoryTransfer() // disconnection before END: no archive writes and no ACK
        let unknownType = WhoopLiveProtocol.frame([60, 4, 2, 17, 18])
        for frame in [start, record(), second, unknown, unknownType] { _ = try transfer.ingest(frame) }
        // Unknown packets on the response channel and known independent live
        // streams go nowhere near the block's durable raw archive.
        _ = try transfer.ingest(unknownType, onDataChannel: false)
        for type: UInt8 in [36, 40, 43, 50, 51] { _ = try transfer.ingest(WhoopLiveProtocol.frame([type, 4, 2])) }
        guard case .commit(let rows, let cursor) = try transfer.ingest(end) else { preconditionFailure("Expected block") }
        precondition(cursor == Data(token))
        precondition(rows == [record(), second, unknown, unknownType])
        guard case .complete = try transfer.ingest(complete) else { preconditionFailure("Expected COMPLETE") }
        #if os(macOS)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try WhoopHistoryStore(owner: "athlete", directory: root)
        let empty = try store.read(from: 0, to: Int64.max, after: 0, limit: 1)
        precondition(empty.records.isEmpty && empty.nextAfter == nil)
        let added = try store.commit(rows, token: cursor, device: "strap")
        precondition(added.records == 2 && added.unsupported == 2 && added.latestPulse == timestamp + 1_000)
        // Commit succeeded but the connection was lost before the ACK. Replay the
        // block into a fresh archive handle (equivalent to reopening the app).
        let reopened = try WhoopHistoryStore(owner: "athlete", directory: root)
        let replayed = try reopened.commit(rows, token: cursor, device: "strap")
        precondition(replayed.records == 0 && replayed.unsupported == 0)
        // Older replays and a newer motion-only packet leave pulse freshness alone.
        let motionOnly = record(version: 25, seconds: timestamp / 1000 + 100, length: 84)
        _ = try reopened.commit([record(), motionOnly], token: cursor, device: "strap")
        let newerOff = record(seconds: timestamp / 1000 + 101, contact: 0)
        _ = try reopened.commit([newerOff], token: cursor, device: "strap")
        let persisted = try reopened.latestPulse(device: "strap")
        let otherStrap = try reopened.latestPulse(device: "another")
        precondition(persisted == timestamp + 1000 && otherStrap == nil)
        let a = try reopened.read(from: timestamp, to: timestamp + 1000, after: 0, limit: 1)
        precondition(a.records.first?["bpm"] as? Int == 70)
        let b = try reopened.read(from: timestamp, to: timestamp + 1000, after: a.nextAfter!, limit: 1)
        precondition(b.records.first?["bpm"] as? Int == 71 && b.nextAfter == nil)
        let other = try WhoopHistoryStore(owner: "../../other", directory: root).read(from: 0, to: Int64.max, after: 0, limit: 2)
        precondition(other.records.isEmpty)

        // Fault injection at the final cursor write must roll back every frame.
        var db: OpaquePointer?
        let path = root.appendingPathComponent(WhoopHistoryStore.key("athlete") + ".sqlite").path
        precondition(sqlite3_open(path, &db) == SQLITE_OK)
        defer { sqlite3_close(db) }
        precondition(sqlite3_exec(db, "CREATE TRIGGER fail_cursor BEFORE INSERT ON cursor BEGIN SELECT RAISE(ABORT,'disk'); END", nil, nil, nil) == SQLITE_OK)
        rejects { _ = try reopened.commit([record(seconds: timestamp / 1000 + 2)], token: Data(token), device: "strap") }
        let remaining = try reopened.read(from: timestamp + 2000, to: timestamp + 2000, after: 0, limit: 1)
        let afterRollback = try reopened.latestPulse(device: "strap")
        precondition(remaining.records.isEmpty && afterRollback == timestamp + 1000)
        print("WHOOP protected history archive rollback and replay tests passed")
        #endif
        print("WHOOP 4 history protocol and battery tests passed")
    }
}
