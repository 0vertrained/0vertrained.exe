import Foundation

/// Bluetooth SIG Heart Rate Measurement (0x2A37). Both optional 16-bit fields
/// and the RR intervals are little-endian. One RR tick is 1/1024 of a second.
struct HeartRateMeasurement {
    let bpm: Int
    let rrMs: [Double]

    init?(_ data: Data) {
        let bytes = Array(data)
        guard let flags = bytes.first else { return nil }
        // A sensor reporting poor skin contact does not have a usable sample.
        guard flags & 0x06 != 0x04 else { return nil }
        let wide = flags & 0x01 != 0
        let headerSize = wide ? 3 : 2
        guard bytes.count >= headerSize else { return nil }
        func uint16(_ offset: Int) -> Int {
            Int(bytes[offset]) | Int(bytes[offset + 1]) << 8
        }
        let rate = wide ? uint16(1) : Int(bytes[1])
        guard (1...300).contains(rate) else { return nil }
        var cursor = headerSize
        if flags & 0x08 != 0 { cursor += 2 }  // skip cumulative energy expended
        guard bytes.count >= cursor else { return nil }
        var intervals: [Double] = []
        if flags & 0x10 != 0 {
            guard cursor < bytes.count, (bytes.count - cursor).isMultiple(of: 2) else { return nil }
            while cursor < bytes.count {
                let ticks = uint16(cursor)
                // A zero slot breaks beat-to-beat continuity for HRV.
                intervals.append(Double(ticks) * 1000 / 1024)
                cursor += 2
            }
        }
        bpm = rate
        rrMs = intervals
    }
}
