import CryptoKit
import Foundation
import SQLite3

/// A per-athlete archive. A FULL-synchronous SQLite commit includes all raw
/// frames (also unrecognized layouts), their time index, and the strap cursor.
final class WhoopHistoryStore {
    private let db: OpaquePointer

    static func key(_ owner: String) -> String {
        SHA256.hash(data: Data(owner.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    init(owner: String, directory: URL? = nil) throws {
        let fm = FileManager.default
        var root = try directory ?? fm.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                            appropriateFor: nil, create: true).appendingPathComponent("WhoopHistory", isDirectory: true)
        #if os(iOS)
        try fm.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
        var attributes = URLResourceValues()
        attributes.isExcludedFromBackup = true
        try root.setResourceValues(attributes)
        #else
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        #endif
        let path = root.appendingPathComponent(Self.key(owner) + ".sqlite").path
        var handle: OpaquePointer?
        var flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        #if os(iOS)
        flags |= SQLITE_OPEN_FILEPROTECTION_COMPLETE
        #endif
        guard sqlite3_open_v2(path, &handle, flags, nil) == SQLITE_OK,
              let handle else {
            sqlite3_close(handle)
            throw WhoopHistoryFailure("Couldn’t open the protected WHOOP history archive.")
        }
        db = handle
        try exec("""
            PRAGMA synchronous=FULL;
            PRAGMA fullfsync=ON;
            CREATE TABLE IF NOT EXISTS frames(device TEXT NOT NULL, raw BLOB NOT NULL, ts INTEGER,
                                              digest BLOB NOT NULL, UNIQUE(device,digest));
            CREATE INDEX IF NOT EXISTS frame_time ON frames(ts);
            CREATE TABLE IF NOT EXISTS cursor(device TEXT PRIMARY KEY, token BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS latest_pulse(device TEXT PRIMARY KEY, ts INTEGER NOT NULL);
            """)
    }

    deinit { sqlite3_close(db) }

    private var failure: WhoopHistoryFailure {
        WhoopHistoryFailure("Couldn’t save or read WHOOP history on this iPhone. Check available space and retry.")
    }

    private func exec(_ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw failure }
    }

    private func prepare(_ sql: String) throws -> OpaquePointer {
        var q: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &q, nil) == SQLITE_OK, let q else { throw failure }
        return q
    }

    private func bind(_ data: Data, to q: OpaquePointer, at i: Int32) throws {
        let result = data.withUnsafeBytes {
            sqlite3_bind_blob(q, i, $0.baseAddress, Int32($0.count), unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        }
        guard result == SQLITE_OK else { throw failure }
    }

    private func bind(_ device: String, to q: OpaquePointer) throws {
        guard sqlite3_bind_text(q, 1, device, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self)) == SQLITE_OK else { throw failure }
    }

    func latestPulse(device: String) throws -> Int64? {
        let query = try prepare("SELECT ts FROM latest_pulse WHERE device=?")
        defer { sqlite3_finalize(query) }
        try bind(device, to: query)
        switch sqlite3_step(query) {
        case SQLITE_DONE: return nil
        case SQLITE_ROW: return sqlite3_column_int64(query, 0)
        default: throw failure
        }
    }

    func commit(_ frames: [Data], token: Data, device: String) throws -> (records: Int, unsupported: Int, latestPulse: Int64?) {
        try exec("BEGIN IMMEDIATE")
        do {
            let insert = try prepare("INSERT INTO frames(device,raw,ts,digest) VALUES (?,?,?,?) ON CONFLICT(device,digest) DO NOTHING")
            defer { sqlite3_finalize(insert) }
            var records = 0, unsupported = 0
            var latest: Int64?
            try bind(device, to: insert)
            for frame in frames {
                let reading = WhoopHistoryReading(frame)
                if let reading, reading.bpm != nil { latest = max(latest ?? 0, reading.timestamp) }
                try bind(frame, to: insert, at: 2)
                try bind(Data(SHA256.hash(data: frame)), to: insert, at: 4)
                let result = reading.map { sqlite3_bind_int64(insert, 3, $0.timestamp) } ?? sqlite3_bind_null(insert, 3)
                guard result == SQLITE_OK, sqlite3_step(insert) == SQLITE_DONE else { throw failure }
                if sqlite3_changes(db) > 0 {
                    if reading != nil { records += 1 }
                    else if frame[4] != 48 { unsupported += 1 }
                }
                sqlite3_reset(insert)
            }
            if let latest {
                let pulse = try prepare("""
                    INSERT INTO latest_pulse(device,ts) VALUES (?,?)
                    ON CONFLICT(device) DO UPDATE SET ts=MAX(ts,excluded.ts)
                    """)
                defer { sqlite3_finalize(pulse) }
                try bind(device, to: pulse)
                guard sqlite3_bind_int64(pulse, 2, latest) == SQLITE_OK, sqlite3_step(pulse) == SQLITE_DONE else { throw failure }
            }
            let cursor = try prepare("INSERT OR REPLACE INTO cursor(device,token) VALUES (?,?)")
            defer { sqlite3_finalize(cursor) }
            try bind(device, to: cursor)
            try bind(token, to: cursor, at: 2)
            guard sqlite3_step(cursor) == SQLITE_DONE else { throw failure }
            try exec("COMMIT")
            return (records, unsupported, latest)
        } catch {
            try? exec("ROLLBACK")
            throw error
        }
    }

    func read(from: Int64, to: Int64, after: Int64, limit: Int) throws -> (records: [[String: Any]], nextAfter: Int64?) {
        let q = try prepare("SELECT rowid,raw FROM frames WHERE rowid > ? AND ts BETWEEN ? AND ? ORDER BY rowid LIMIT ?")
        defer { sqlite3_finalize(q) }
        sqlite3_bind_int64(q, 1, after)
        sqlite3_bind_int64(q, 2, from)
        sqlite3_bind_int64(q, 3, to)
        sqlite3_bind_int(q, 4, Int32(limit + 1))
        var rows: [[String: Any]] = []
        var cursor: Int64 = 0
        while true {
            let result = sqlite3_step(q)
            if result == SQLITE_DONE { return (rows, nil) }
            guard result == SQLITE_ROW, let blob = sqlite3_column_blob(q, 1) else { throw failure }
            if rows.count == limit { return (rows, cursor) }
            let data = Data(bytes: blob, count: Int(sqlite3_column_bytes(q, 1)))
            guard let row = WhoopHistoryReading(data) else { throw failure }
            rows.append(row.dictionary)
            cursor = sqlite3_column_int64(q, 0)
        }
    }
}
