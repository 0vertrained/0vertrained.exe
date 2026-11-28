import Foundation

/// Bluetooth SIG GATT Specification Supplement, Treadmill Data (0x2ACD).
/// This characteristic has no cadence field. Keep measurements from one
/// notification separate from the previously observed connection-wide metrics.
struct ClimbTreadmillFrame {
    let observedMetrics: [String: Double]
    var speedMps: Double? { observedMetrics["speedMps"] }
    var distanceMeters: Int? { observedMetrics["distanceMeters"].map(Int.init) }
    var inclinePercent: Double? { observedMetrics["inclinePercent"] }

    private struct Field {
        let key: String
        let bit: Int
        let bytes: Int
        let divisor: Double
        let signed: Bool
        let range: ClosedRange<Int>?

        init(_ key: String, _ bit: Int, _ bytes: Int, divisor: Double = 1, signed: Bool = false,
             range: ClosedRange<Int>? = nil) {
            self.key = key
            self.bit = bit
            self.bytes = bytes
            self.divisor = divisor
            self.signed = signed
            self.range = range
        }

        func convert(_ raw: Int) -> Double? {
            let number: Int
            if signed {
                // 0x7FFF indicates an unavailable field in a signed pair.
                guard raw != 0x7fff, raw != 0x8000 else { return nil }
                number = Int(Int16(bitPattern: UInt16(raw)))
            } else {
                // Machine firmwares can fill unavailable unsigned counters with ones.
                guard raw != (1 << (8 * bytes)) - 1 else { return nil }
                number = raw
            }
            if let range, !range.contains(number) { return nil }
            return Double(number) / divisor
        }
    }

    // In wire order. FTMS speed uses hundredths of km/h, elevation tenths of
    // metres, pace whole seconds per 500 metres. Normalize at the boundary.
    private static let fields = [
        Field("speedMps", 0, 2, divisor: 360),
        Field("averageSpeedMps", 1, 2, divisor: 360),
        Field("distanceMeters", 2, 3),
        Field("inclinePercent", 3, 2, divisor: 10, signed: true, range: -1000...1000),
        Field("rampAngleDegrees", 3, 2, divisor: 10, signed: true, range: -900...900),
        Field("ascentMeters", 4, 2, divisor: 10),
        Field("descentMeters", 4, 2, divisor: 10),
        Field("paceSecondsPerKm", 5, 2, divisor: 0.5, range: 1...65534),
        Field("averagePaceSecondsPerKm", 6, 2, divisor: 0.5, range: 1...65534),
        Field("energyKcal", 7, 2),
        Field("energyKcalPerHour", 7, 2),
        Field("energyKcalPerMinute", 7, 1),
        Field("heartRateBpm", 8, 1, range: 1...254),
        Field("metabolicEquivalent", 9, 1, divisor: 10),
        Field("elapsedSeconds", 10, 2),
        Field("remainingSeconds", 11, 2),
        Field("beltForceNewtons", 12, 2, signed: true),
        Field("powerWatts", 12, 2, signed: true)
    ]

    init?(_ packet: Data) {
        let bytes = Array(packet)
        guard bytes.count >= 2 else { return nil }
        let flags = Int(bytes[0]) | Int(bytes[1]) << 8
        guard flags & 0xe000 == 0 else { return nil }
        let included = Self.fields.filter { field in
            let enabled = flags & (1 << field.bit) != 0
            return field.bit == 0 ? !enabled : enabled
        }
        let length = included.reduce(2) { $0 + $1.bytes }
        let paceFields = included.filter { $0.bit == 5 || $0.bit == 6 }.count
        // Some legacy consoles used one-byte pace. An equally short modern
        // packet could be truncated. In either case only the fields preceding
        // pace have unambiguous offsets, including all workout-control inputs.
        let legacyLength = paceFields > 0 && bytes.count == length - paceFields
        guard bytes.count == length || legacyLength else { return nil }

        var offset = 2
        var readings = [String: Double]()
        for field in included {
            if legacyLength && field.bit >= 5 { break }
            var raw = 0
            for i in 0..<field.bytes { raw |= Int(bytes[offset + i]) << (i * 8) }
            offset += field.bytes
            readings[field.key] = field.convert(raw)
        }
        observedMetrics = readings
    }
}

struct ClimbInclineRange {
    let minimum: Double
    let maximum: Double
    let increment: Double

    init?(_ data: Data) {
        let bytes = Array(data)
        guard bytes.count == 6 else { return nil }
        func word(_ i: Int) -> UInt16 { UInt16(bytes[i]) | UInt16(bytes[i + 1]) << 8 }
        minimum = Double(Int16(bitPattern: word(0))) / 10
        maximum = Double(Int16(bitPattern: word(2))) / 10
        increment = Double(word(4)) / 10
        guard minimum <= maximum, increment > 0, increment <= maximum - minimum else { return nil }
    }
}

struct ClimbMachineFeatures {
    let distance: Bool
    let incline: Bool
    let inclineTargets: Bool
    let speedTargets: Bool
    let advertisedMetrics: [String: Bool]

    init?(_ data: Data) {
        let bytes = Array(data)
        guard bytes.count == 8 else { return nil }
        let bits = Int(bytes[0]) | Int(bytes[1]) << 8
        // FTMS 1.0.1 table 4.5 maps treadmill data flags onto 2ACC features.
        // Instantaneous speed has no feature bit, so it cannot be advertised.
        let fields = [
            ("averageSpeedMps", 0), ("distanceMeters", 2), ("inclinePercent", 3), ("rampAngleDegrees", 3),
            ("ascentMeters", 4), ("descentMeters", 4), ("paceSecondsPerKm", 5), ("averagePaceSecondsPerKm", 5),
            ("energyKcal", 9), ("energyKcalPerHour", 9), ("energyKcalPerMinute", 9), ("heartRateBpm", 10),
            ("metabolicEquivalent", 11), ("elapsedSeconds", 12), ("remainingSeconds", 13),
            ("beltForceNewtons", 15), ("powerWatts", 15)
        ]
        advertisedMetrics = Dictionary(uniqueKeysWithValues: fields.map { ($0.0, bits & (1 << $0.1) != 0) })
        distance = bits & 0x04 != 0
        incline = bits & 0x08 != 0
        speedTargets = bytes[4] & 1 != 0
        inclineTargets = bytes[4] & 2 != 0
    }
}

/// Tracks age separately because a treadmill may split fields across packets.
/// A new BLE connection always starts with an empty telemetry window.
struct ClimbTelemetry {
    struct Value {
        let number: Double
        let uptime: TimeInterval
        let wallMilliseconds: Double
        func fresh(_ now: TimeInterval) -> Bool { now >= uptime && now - uptime < 5 }
    }
    private(set) var speed: Value?
    private(set) var distance: Value?
    private(set) var incline: Value?

    mutating func update(_ frame: ClimbTreadmillFrame, uptime: TimeInterval, date: Date) {
        func value(_ number: Double) -> Value { Value(number: number, uptime: uptime, wallMilliseconds: date.timeIntervalSince1970 * 1000) }
        if let n = frame.speedMps { speed = value(n) }
        if let n = frame.distanceMeters { distance = value(Double(n)) }
        if let n = frame.inclinePercent { incline = value(n) }
    }
}

/// A qualification is issued after a model + firmware have passed physical
/// deck tests. These limits come from that test run, not from the BLE flags.
struct ClimbQualification {
    let maker: String
    let model: String
    let firmware: String
    let low: Double
    let high: Double
    let maxChange: Double
    let interval: TimeInterval
    let settleTimeout: TimeInterval
    let tolerance: Double
    static let qualified: [ClimbQualification] = []
}

struct ClimbControl {
    enum Stage: String { case manual, acquiring, armed, acknowledging, settling }
    private(set) var stage: Stage = .manual
    private(set) var token: UUID?
    private(set) var target: Double?
    private(set) var owner = ""
    private(set) var recordingID = ""
    private(set) var reason: String?
    private var bounds: ClosedRange<Double> = 0...0
    private var step = 0.0
    private var origin = 0.0
    private var lastWrite = 0.0
    private var deadline = 0.0
    private var qualification: ClimbQualification?
    var active: Bool { stage != .manual }

    mutating func arm(owner: String, recordingID: String, cap: Double, confirmed: Bool, foreground: Bool,
                      qualification: ClimbQualification?, range: ClimbInclineRange?,
                      telemetry: ClimbTelemetry, now: Double) -> Data? {
        guard !active, let q = qualification, let range, !owner.isEmpty, owner.count <= 128,
              UUID(uuidString: recordingID) != nil, cap.isFinite, cap >= 0, confirmed, foreground,
              let incline = telemetry.incline, incline.fresh(now), telemetry.speed?.fresh(now) == true,
              (telemetry.speed?.number ?? 0) > 0, min(min(q.high, range.maximum), cap) >= max(q.low, range.minimum) else { return nil }
        self.qualification = q
        bounds = max(q.low, range.minimum)...min(min(cap, q.high), range.maximum)
        guard bounds.contains(incline.number) else { return nil }
        self.owner = owner
        self.recordingID = recordingID
        token = UUID()
        step = range.increment
        origin = range.minimum
        target = incline.number
        stage = .acquiring
        lastWrite = now
        deadline = now + 4
        reason = nil
        return Data([0x00]) // Request Control. Speed, start and stop opcodes are never issued.
    }

    mutating func disarm(_ message: String?) {
        stage = .manual
        token = nil
        target = nil
        qualification = nil
        owner = ""
        recordingID = ""
        reason = message
    }

    mutating func check(telemetry: ClimbTelemetry, foreground: Bool, now: Double) {
        guard active, let q = qualification else { return }
        guard foreground, telemetry.incline?.fresh(now) == true, telemetry.speed?.fresh(now) == true,
              (telemetry.speed?.number ?? 0) > 0 else {
            disarm("Automatic incline released. Check belt speed and deck grade on the console.")
            return
        }
        if stage != .armed && now >= deadline {
            disarm("The treadmill took too long to confirm its incline. Use the console.")
        } else if let actual = telemetry.incline?.number, let target {
            if stage == .settling && abs(actual - target) <= q.tolerance { stage = .armed }
            else if stage == .armed && abs(actual - target) > q.tolerance {
                disarm("The measured incline changed. The console now controls the deck.")
            }
        }
    }

    mutating func request(grade: Double, owner: String, recordingID: String, token: UUID, now: Double,
                          telemetry: ClimbTelemetry, foreground: Bool) -> Data? {
        check(telemetry: telemetry, foreground: foreground, now: now)
        guard stage == .armed, let q = qualification, owner == self.owner, recordingID == self.recordingID,
              token == self.token, grade.isFinite, let actual = telemetry.incline?.number, now - lastWrite >= q.interval else { return nil }
        let low = max(bounds.lowerBound, actual - q.maxChange)
        let high = min(bounds.upperBound, actual + q.maxChange)
        let lowTick = ceil((low - origin) / step - 0.000001)
        let highTick = floor((high - origin) / step + 0.000001)
        guard lowTick <= highTick else { return nil }
        let ticks = min(highTick, max(lowTick, ((grade - origin) / step).rounded()))
        let set = origin + ticks * step
        guard abs(set - actual) > max(q.tolerance, step * 0.25) else { return nil }
        let encoded = UInt16(bitPattern: Int16((set * 10).rounded()))
        target = set
        lastWrite = now
        deadline = now + 4
        stage = .acknowledging
        return Data([0x03, UInt8(truncatingIfNeeded: encoded), UInt8(encoded >> 8)])
    }

    mutating func indication(_ data: Data, now: Double) {
        guard active else { return }
        let b = Array(data)
        guard b.count == 3, b[0] == 0x80, b[2] == 0x01, now < deadline,
              (stage == .acquiring && b[1] == 0x00) || (stage == .acknowledging && b[1] == 0x03) else {
            disarm("The treadmill did not accept the control procedure. Use manual incline."); return
        }
        if stage == .acquiring { stage = .armed }
        else { stage = .settling; deadline = now + (qualification?.settleTimeout ?? 0) }
    }

    mutating func machineStatus(_ data: Data) {
        guard active, let op = data.first else { return }
        switch op {
        case 0x01, 0x02, 0x03, 0xff:
            disarm("The treadmill stopped, reset or released control. Check the console.")
        case 0x06:
            let b = Array(data)
            guard b.count >= 3, let target, let q = qualification,
                  abs(Double(Int16(bitPattern: UInt16(b[1]) | UInt16(b[2]) << 8)) / 10 - target) <= q.tolerance else {
                disarm("The console changed the target incline. Follow the console."); return
            }
        default: break
        }
    }
}
