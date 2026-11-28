import Foundation

/// One user-initiated discovery window. Only a completed scan can establish an empty result.
struct ClimbScanEvidence {
    private(set) var mode = "ftms"
    private(set) var state = "idle"
    private(set) var found = 0
    private var startedAt: Double?
    private var endedAt: Double?

    mutating func begin(peloton: Bool, at: Double) {
        self = Self()
        mode = peloton ? "peloton" : "ftms"
        state = "scanning"
        startedAt = at
    }

    static func discovery(mode: String, advertisesFTMS: Bool, localName: String?) -> String? {
        // CoreBluetooth guarantees the regular service filter, even if a later callback omits its UUID list.
        if mode == "ftms" || advertisesFTMS { return "advertisedFTMS" }
        guard mode == "peloton", let name = localName?.lowercased(),
              ["peloton", "tread", "fitswitch"].contains(where: { name.contains($0) }) else { return nil }
        return "nameMatch"
    }

    mutating func seen(_ count: Int) {
        if state == "scanning" { found = count }
    }

    mutating func finish(_ result: String? = nil, at: Double) {
        guard state == "scanning" || (state == "idle" && result == "unavailable") else { return }
        state = result ?? (found == 0 ? "empty" : "found")
        endedAt = at
    }

    var snapshot: [String: Any] {
        var result: [String: Any] = ["mode": mode, "state": state, "found": found]
        result["startedAt"] = startedAt
        result["endedAt"] = endedAt
        return result
    }
}

/// The last explicitly selected device. Stale/departed readings are historical evidence only.
struct ClimbDeviceEvidence {
    var state = "connecting"
    var reasonCode: String?
    var message: String?
    var serviceFound: Bool?
    var treadmillDataFound: Bool?
    var subscription = "unchecked"
    var featureRead = "unchecked"
    var details: [String: Any] = [:]
    private var metrics: [String: [String: Double]] = [:]
    private var sampleCount = 0
    var malformedCount = 0
    private var lastSampleAt: Double?
    private var endedAt: Double?
    let deviceName: String
    let discovery: String
    let startedAt: Double

    init(deviceName: String, discovery: String, startedAt: Double) {
        self.deviceName = deviceName
        self.discovery = discovery
        self.startedAt = startedAt
    }

    mutating func observe(_ values: [String: Double], at: Double) {
        guard endedAt == nil else { return }
        sampleCount += 1
        lastSampleAt = at
        for (name, value) in values where value.isFinite {
            metrics[name] = ["value": value, "at": at]
        }
        if !values.isEmpty { state = "receiving" }
    }

    mutating func finish(_ result: String, reason: String, message: String?, at: Double) {
        guard endedAt == nil else { return }
        state = result
        if featureRead == "pending" { featureRead = "interrupted" }
        if subscription == "pending" { subscription = "interrupted" }
        reasonCode = reason
        self.message = message
        endedAt = at
    }

    var snapshot: [String: Any] {
        var result = details
        result["deviceName"] = deviceName
        result["discovery"] = discovery
        result["state"] = state
        result["reasonCode"] = reasonCode
        result["message"] = message
        result["serviceFound"] = serviceFound
        result["treadmillDataFound"] = treadmillDataFound
        result["subscription"] = subscription
        result["featureRead"] = featureRead
        result["sampleCount"] = sampleCount
        result["malformedCount"] = malformedCount
        result["startedAt"] = startedAt
        result["lastSampleAt"] = lastSampleAt
        result["endedAt"] = endedAt
        result["metrics"] = metrics
        return result
    }
}

#if os(iOS)
import Capacitor
import CoreBluetooth
import UIKit

/// The WebView supplies athlete intent. Native model/firmware qualification,
/// live deck telemetry and a one-session arm token gate every incline write.
@objc(ClimbTreadmill)
public final class ClimbTreadmill: CAPPlugin, CAPBridgedPlugin, CBCentralManagerDelegate, CBPeripheralDelegate {
    public let identifier = "ClimbTreadmill"
    public let jsName = "OTClimb"
    public let pluginMethods: [CAPPluginMethod] = ["status", "scan", "connect", "disconnect", "arm", "requestIncline", "disarm"].map {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }

    private let service = CBUUID(string: "1826")
    private let info = CBUUID(string: "180A")
    private let modelID = CBUUID(string: "2A24")
    private let firmwareID = CBUUID(string: "2A26")
    private let makerID = CBUUID(string: "2A29")
    private let controlID = CBUUID(string: "2AD9")
    private let statusID = CBUUID(string: "2ADA")
    private let dataID = CBUUID(string: "2ACD")
    private let featuresID = CBUUID(string: "2ACC")
    private let inclineRangeID = CBUUID(string: "2AD5")
    private var central: CBCentralManager?
    private var devices: [UUID: CBPeripheral] = [:]
    private var names: [UUID: String] = [:]
    private var discovery: [UUID: String] = [:]
    private var scanEvidence = ClimbScanEvidence()
    private var report: ClimbDeviceEvidence?
    private var optionalReads: Set<CBUUID> = []
    private var discoveringIdentity = false
    private var terminalProbe: (state: String, code: String, reason: String)?
    private var poll: DispatchWorkItem?
    private var readingOnly = false
    private var milliseconds: Double { Date().timeIntervalSince1970 * 1000 }
    private var cancelling: Set<UUID> = []
    private var selected: CBPeripheral?
    private var connectionID: String?
    private var phase = "idle"
    private var message: String?
    private var timeout: DispatchWorkItem?
    private var expiry: DispatchWorkItem?
    private var telemetry = ClimbTelemetry()
    private var features: ClimbMachineFeatures?
    private var inclineRange: ClimbInclineRange?
    private var wantsScan = false
    private var identity: [CBUUID: String] = [:]
    private var control = ClimbControl()
    private var controlPoint: CBCharacteristic?
    private var statusPoint: CBCharacteristic?
    private var controlSpent = false
    private var watchdog: Timer?
    private var uptime: Double { ProcessInfo.processInfo.systemUptime }
    private var foreground: Bool { UIApplication.shared.applicationState == .active }
    private var qualified: ClimbQualification? {
        guard !controlSpent, features?.inclineTargets == true, features?.incline == true,
              controlPoint?.isNotifying == true, statusPoint?.isNotifying == true, inclineRange != nil else { return nil }
        return ClimbQualification.qualified.first {
            $0.maker == identity[makerID] && $0.model == identity[modelID] && $0.firmware == identity[firmwareID]
        }
    }

    public override func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(leaveForeground),
            name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(resignActive),
            name: UIApplication.willResignActiveNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    @objc private func resignActive() {
        if control.active { releaseControl("Automatic incline released while the app is inactive."); emit() }
    }

    private func releaseControl(_ reason: String?) {
        if control.active { controlSpent = true }
        control.disarm(reason)
        watchdog?.invalidate()
        watchdog = nil
    }

    private func reconcileControl(_ wasActive: Bool) {
        if wasActive && !control.active {
            controlSpent = true  // Late indications from this session must never rearm a later generation.
            watchdog?.invalidate()
            watchdog = nil
        }
    }

    @objc func arm(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.phase == "connected", let device = self.selected, let point = self.controlPoint,
                  let q = self.qualified, let cap = call.getDouble("capPercent"),
                  let data = self.control.arm(owner: call.getString("owner") ?? "", recordingID: call.getString("recordingId") ?? "",
                    cap: cap, confirmed: call.getBool("confirmed") == true, foreground: self.foreground, qualification: q,
                    range: self.inclineRange, telemetry: self.telemetry, now: self.uptime) else {
                call.reject("Automatic incline requires a qualified treadmill, fresh readings and explicit setup."); return
            }
            device.writeValue(data, for: point, type: .withResponse)
            self.startWatchdog()
            self.emit()
            call.resolve(self.snapshot())
        }
    }

    private func startWatchdog() {
        watchdog?.invalidate()
        watchdog = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self, self.control.active else { return }
            let previous = self.control.stage
            self.control.check(telemetry: self.telemetry, foreground: self.foreground, now: self.uptime)
            self.reconcileControl(true)
            if self.control.stage != previous { self.emit() }
        }
    }

    @objc func requestIncline(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.phase == "connected", self.qualified != nil, let device = self.selected, let point = self.controlPoint,
                  let token = UUID(uuidString: call.getString("armToken") ?? ""), token == self.control.token,
                  let owner = call.getString("owner"), owner == self.control.owner,
                  let recording = call.getString("recordingId"), recording == self.control.recordingID,
                  let grade = call.getDouble("grade") else {
                call.reject("Control session expired. Use the console."); return
            }
            if let packet = self.control.request(grade: grade, owner: owner, recordingID: recording, token: token,
                    now: self.uptime, telemetry: self.telemetry, foreground: self.foreground) {
                device.writeValue(packet, for: point, type: .withResponse)
            }
            self.reconcileControl(true)
            self.emit()
            call.resolve(self.snapshot())
        }
    }

    @objc func disarm(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.releaseControl("Manual incline. Check the deck on the console.")
            self.emit()
            call.resolve(self.snapshot())
        }
    }

    @objc private func leaveForeground() {
        DispatchQueue.main.async {
            guard self.phase == "scanning" || self.phase == "connecting" || self.phase == "connected" else { return }
            self.clear("idle", "Reconnect the treadmill when you return to Race the Climb.", code: "background")
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.snapshot()) }
    }

    @objc func scan(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.selected == nil else { call.reject("Disconnect the selected treadmill before scanning."); return }
            self.stopScan()
            let peloton = call.getString("mode") == "peloton"
            if peloton != (self.scanEvidence.mode == "peloton") {
                // Discard queued discoveries from the previous filter before interpreting a new scan.
                self.central?.delegate = nil
                self.central = nil
                self.cancelling.removeAll()
            }
            self.scanEvidence.begin(peloton: peloton, at: self.milliseconds)
            self.report = nil
            self.discovery.removeAll()
            self.wantsScan = true
            self.phase = "scanning"
            self.message = nil
            self.devices.removeAll()
            self.names.removeAll()
            self.scanStartupTimeout()
            if let central = self.central {
                self.centralManagerDidUpdateState(central)
            } else {
                self.central = CBCentralManager(delegate: self, queue: .main)
            }
            self.emit()
            call.resolve(self.snapshot())
        }
    }

    @objc func connect(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let central = self.central, central.state == .poweredOn,
                  let text = call.getString("id"), let id = UUID(uuidString: text),
                  let device = self.devices[id], !self.cancelling.contains(id) else {
                call.reject("Scan and choose a nearby treadmill."); return
            }
            guard self.selected == nil else { call.reject("Disconnect the active treadmill first."); return }
            self.scanEvidence.finish(at: self.milliseconds)
            self.stopScan()
            self.report = ClimbDeviceEvidence(deviceName: self.names[id] ?? "Fitness machine",
                discovery: self.discovery[id] ?? "advertisedFTMS", startedAt: self.milliseconds)
            self.selected = device
            self.connectionID = UUID().uuidString
            device.delegate = self
            self.phase = "connecting"
            self.message = nil
            central.connect(device, options: nil)
            self.connectionTimeout()
            self.emit()
            call.resolve(self.snapshot())
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.clear("idle", nil, forget: call.getBool("forget") == true)
            call.resolve(self.snapshot())
        }
    }

    private func after(_ seconds: Double, _ action: @escaping () -> Void) {
        timeout?.cancel()
        let work = DispatchWorkItem(block: action)
        timeout = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    private func scanStartupTimeout() {
        after(15) { [weak self] in
            guard let self, self.wantsScan else { return }
            self.clear("unavailable", "Bluetooth did not become available for scanning.", code: "bluetoothUnavailable")
        }
    }

    private func connectionTimeout() {
        after(15) { [weak self] in self?.clear("idle", "The treadmill did not start a data connection. Try waking its console.", result: "failed", code: "connectionTimeout") }
    }

    private func stopScan() {
        wantsScan = false
        if central?.isScanning == true { central?.stopScan() }
        timeout?.cancel()
        timeout = nil
    }

    private func clear(_ status: String, _ reason: String?, result: String = "disconnected", code: String = "userDisconnected",
                       forget: Bool = false) {
        scanEvidence.finish(status == "unavailable" ? "unavailable" : "interrupted", at: milliseconds)
        if selected != nil {
            if let terminal = terminalProbe {
                report?.finish(terminal.state, reason: terminal.code, message: terminal.reason, at: milliseconds)
            } else {
                report?.finish(result, reason: code, message: reason, at: milliseconds)
            }
        }
        stopScan()
        poll?.cancel()
        poll = nil
        readingOnly = false
        terminalProbe = nil
        optionalReads.removeAll()
        discoveringIdentity = false
        expiry?.cancel()
        expiry = nil
        if let device = selected {
            device.delegate = nil
            if central?.state == .poweredOn && device.state != .disconnected {
                cancelling.insert(device.identifier)
                central?.cancelPeripheralConnection(device)
            }
        }
        releaseControl(nil)
        controlSpent = false
        controlPoint = nil
        statusPoint = nil
        identity.removeAll()
        selected = nil
        connectionID = nil
        telemetry = ClimbTelemetry()
        features = nil
        inclineRange = nil
        if forget {
            report = nil
            scanEvidence = ClimbScanEvidence()
            devices.removeAll()
            discovery.removeAll()
            names.removeAll()
        }
        phase = status
        message = reason
        emit()
    }

    private func snapshot() -> [String: Any] {
        let now = ProcessInfo.processInfo.systemUptime
        var value: [String: Any] = [
            "scan": scanEvidence.snapshot,
            "status": phase, "autoIncline": qualified != nil, "controlStage": control.stage.rawValue,
            "fresh": telemetry.distance?.fresh(now) == true || telemetry.speed?.fresh(now) == true,
            "devices": devices.keys.sorted { (names[$0] ?? "", $0.uuidString) < (names[$1] ?? "", $1.uuidString) }
                .map { ["id": $0.uuidString, "name": names[$0] ?? "Fitness machine", "discovery": discovery[$0] ?? "advertisedFTMS"] }
        ]
        value["report"] = report?.snapshot
        value["message"] = control.reason ?? message
        value["armToken"] = control.token?.uuidString
        value["targetIncline"] = control.target
        value["deviceId"] = selected?.identifier.uuidString
        value["deviceName"] = selected.flatMap { names[$0.identifier] }
        value["connectionId"] = connectionID
        value["sampleAt"] = [telemetry.distance, telemetry.speed].compactMap { $0 }.filter { $0.fresh(now) }.map(\.wallMilliseconds).max()
        func put(_ reading: ClimbTelemetry.Value?, _ field: String, _ time: String) {
            guard let reading, reading.fresh(now) else { return }
            value[time] = reading.wallMilliseconds
            value[field] = reading.number
        }
        put(telemetry.distance, "distanceMeters", "distanceAt")
        put(telemetry.speed, "speedMps", "speedAt")
        put(telemetry.incline, "inclinePercent", "inclineAt")
        if let features {
            value["reportsDistance"] = features.distance
            value["reportsIncline"] = features.incline
            value["inclineTargetsAdvertised"] = features.inclineTargets
        }
        if let range = inclineRange {
            value["inclineRange"] = ["min": range.minimum, "max": range.maximum, "step": range.increment]
        }
        return value
    }

    private func emit() { notifyListeners("treadmillState", data: snapshot()) }

    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        guard central === self.central else { return }
        if central.state != .poweredOn {
            if central.state == .unknown { return }
            cancelling.removeAll()
            devices.removeAll()
            names.removeAll()
            discovery.removeAll()
            let unavailable: (String, String)
            switch central.state {
            case .unauthorized: unavailable = ("bluetoothUnauthorized", "Allow Bluetooth access for 0VERTRAINED in Settings.")
            case .poweredOff: unavailable = ("bluetoothOff", "Bluetooth is turned off. Turn it on and scan again.")
            case .unsupported: unavailable = ("bluetoothUnsupported", "This device does not support treadmill Bluetooth.")
            default: unavailable = ("bluetoothUnavailable", "Treadmill Bluetooth is temporarily unavailable.")
            }
            clear("unavailable", unavailable.1, code: unavailable.0)
            return
        }
        guard wantsScan else { return }
        for device in central.retrieveConnectedPeripherals(withServices: [service]) {
            guard devices.count < 64 else { break }
            devices[device.identifier] = device
            names[device.identifier] = device.name
            discovery[device.identifier] = "connectedFTMS"
        }
        scanEvidence.seen(devices.count)
        // A wider scan requires explicit Peloton mode. Filter before retaining or publishing any peripheral.
        central.scanForPeripherals(withServices: scanEvidence.mode == "peloton" ? nil : [service], options: nil)
        after(12) { [weak self] in
            guard let self, self.phase == "scanning" else { return }
            self.scanEvidence.finish(at: self.milliseconds)
            self.stopScan()
            self.phase = "idle"
            if self.devices.isEmpty {
                self.message = self.scanEvidence.mode == "peloton"
                    ? "No Peloton, Tread, FitSwitch or fitness machine advertisements were seen during this scan."
                    : "No nearby fitness machines were found during this scan. Wake the console and try again."
            }
            self.emit()
        }
        emit()
    }

    public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                               advertisementData: [String: Any], rssi RSSI: NSNumber) {
        guard central === self.central, phase == "scanning", devices.count < 64 || devices[peripheral.identifier] != nil else { return }
        let localName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        let services = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? [])
            + (advertisementData[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID] ?? [])
        guard let source = ClimbScanEvidence.discovery(mode: scanEvidence.mode, advertisesFTMS: services.contains(service),
                                                       localName: localName ?? peripheral.name) else { return }
        let id = peripheral.identifier
        devices[id] = peripheral
        names[id] = localName ?? peripheral.name ?? names[id]
        if discovery[id] == nil || discovery[id] == "nameMatch" || source == "advertisedFTMS" { discovery[id] = source }
        scanEvidence.seen(devices.count)
        emit()
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard peripheral === selected else { central.cancelPeripheralConnection(peripheral); return }
        report?.state = "checking"
        peripheral.discoverServices([service, info])
        emit()
    }

    public func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        cancelling.remove(peripheral.identifier)
        if peripheral === selected { clear("idle", "The connection failed. Select the treadmill to retry.", result: "failed", code: "connectionFailed") }
    }

    public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        cancelling.remove(peripheral.identifier)
        if peripheral === selected { clear("idle", "Treadmill disconnected. Reconnect or continue with manual readings.", code: "connectionLost") }
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard peripheral === selected else { return }
        guard error == nil, let services = peripheral.services else {
            clear("idle", "The service check failed before this device’s treadmill support could be verified.",
                  result: "failed", code: "serviceDiscoveryFailed")
            return
        }
        if let information = services.first(where: { $0.uuid == info }) {
            discoveringIdentity = true
            peripheral.discoverCharacteristics([modelID, firmwareID, makerID], for: information)
        }
        let machine = services.first(where: { $0.uuid == service })
        report?.serviceFound = machine != nil
        guard let machine else {
            endProbe("incompatible", "serviceMissing", "The device connected, but did not expose the standard Fitness Machine Service.")
            return
        }
        peripheral.discoverCharacteristics([dataID, featuresID, inclineRangeID, controlID, statusID], for: machine)
        emit()
    }

    // A missing treadmill stream still leaves time for requested, optional identity and feature reads.
    private func endProbe(_ state: String, _ code: String, _ reason: String) {
        terminalProbe = (state, code, reason)
        controlSpent = true
        if control.active { releaseControl("Treadmill data is unavailable. Check the console.") }
        telemetry = ClimbTelemetry()
        expiry?.cancel()
        poll?.cancel()
        report?.state = state
        report?.reasonCode = code
        report?.message = reason
        if !finishProbeIfReady() {
            after(2.5) { [weak self] in self?.clear("idle", reason, result: state, code: code) }
            emit()
        }
    }

    @discardableResult
    private func finishProbeIfReady() -> Bool {
        guard !discoveringIdentity, optionalReads.isEmpty, let terminal = terminalProbe else { return false }
        clear("idle", terminal.reason, result: terminal.state, code: terminal.code)
        return true
    }

    private func readOptional(_ c: CBCharacteristic, from peripheral: CBPeripheral) {
        optionalReads.insert(c.uuid)
        peripheral.readValue(for: c)
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard peripheral === selected else { return }
        if service.uuid == info {
            discoveringIdentity = false
            if error == nil {
                for c in service.characteristics ?? [] where c.properties.contains(.read) { readOptional(c, from: peripheral) }
            }
            if !finishProbeIfReady() { emit() }
            return
        }
        guard service.uuid == self.service else { return }
        guard error == nil, let characteristics = service.characteristics else {
            endProbe("failed", "characteristicDiscoveryFailed", "The treadmill data characteristic could not be checked.")
            return
        }
        let belt = characteristics.first(where: { $0.uuid == dataID })
        let point = characteristics.first(where: { $0.uuid == controlID })
        report?.treadmillDataFound = belt != nil
        report?.details["controlPointFound"] = point != nil
        report?.details["controlPointWritable"] = point?.properties.contains(.write) == true
        report?.details["controlPointIndicates"] = point?.properties.contains(.indicate) == true
        report?.featureRead = "unsupported"
        for c in characteristics {
            if c.uuid == featuresID && c.properties.contains(.read) {
                report?.featureRead = "pending"
                readOptional(c, from: peripheral)
            }
            if c.uuid == inclineRangeID && c.properties.contains(.read) { readOptional(c, from: peripheral) }
            if c.uuid == controlID && c.properties.contains(.write) && c.properties.contains(.indicate) {
                controlPoint = c
            }
            if c.uuid == statusID && c.properties.contains(.notify) { statusPoint = c }
        }
        guard let belt else {
            report?.subscription = "unsupported"
            endProbe("incompatible", "treadmillDataMissing", "The Fitness Machine Service did not expose the Treadmill Data characteristic.")
            return
        }
        subscribeControlIfQualified(peripheral)
        if belt.properties.contains(.notify) || belt.properties.contains(.indicate) {
            report?.subscription = "pending"
            peripheral.setNotifyValue(true, for: belt)
        } else if belt.properties.contains(.read) {
            startReading(belt, from: peripheral)
        } else {
            report?.subscription = "unsupported"
            endProbe("incompatible", "treadmillDataUnavailable", "The Treadmill Data characteristic offers neither readings nor notifications.")
            return
        }
        emit()
    }

    private func startReading(_ belt: CBCharacteristic, from peripheral: CBPeripheral) {
        readingOnly = true
        // A polling-only link has never qualified for automatic incline.
        controlSpent = true
        if control.active { releaseControl("The treadmill stream ended. Use the console for incline.") }
        telemetry = ClimbTelemetry()
        report?.subscription = "readOnly"
        phase = "connected"
        timeout?.cancel()
        readBelt(belt, from: peripheral)
    }

    // Some bridges expose read instead of notify. Allow one outstanding request and release a silent peripheral.
    private func readBelt(_ belt: CBCharacteristic, from peripheral: CBPeripheral) {
        guard readingOnly, peripheral === selected else { return }
        after(10) { [weak self] in
            self?.clear("idle", "The treadmill stopped answering data reads.", result: "failed", code: "dataReadTimeout")
        }
        peripheral.readValue(for: belt)
    }

    private func scheduleRead(_ belt: CBCharacteristic, from peripheral: CBPeripheral) {
        guard readingOnly else { return }
        timeout?.cancel()
        poll?.cancel()
        let work = DispatchWorkItem { [weak self, weak peripheral] in
            guard let peripheral else { return }
            self?.readBelt(belt, from: peripheral)
        }
        poll = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1, execute: work)
    }

    private func subscribeControlIfQualified(_ peripheral: CBPeripheral) {
        guard ClimbQualification.qualified.contains(where: {
            $0.model == identity[modelID] && $0.firmware == identity[firmwareID] && $0.maker == identity[makerID]
        }) else { return }
        for c in [controlPoint, statusPoint].compactMap({ $0 }) where !c.isNotifying {
            peripheral.setNotifyValue(true, for: c)
        }
    }

    public func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral === selected, characteristic.uuid == controlID, error != nil else { return }
        releaseControl("The incline request failed. Check the deck on the console.")
        emit()
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral === selected else { return }
        if characteristic.uuid == statusID || characteristic.uuid == controlID {
            if control.active && (error != nil || !characteristic.isNotifying) { releaseControl("Treadmill control feedback was lost.") }
            emit(); return
        }
        guard characteristic.uuid == dataID else { return }
        guard error == nil, characteristic.isNotifying else {
            if characteristic.properties.contains(.read) {
                report?.details["notificationFailed"] = true
                startReading(characteristic, from: peripheral)
                emit()
            } else {
                report?.subscription = "failed"
                endProbe("failed", "subscriptionFailed", "The treadmill did not permit its data stream to be enabled.")
            }
            return
        }
        report?.subscription = "subscribed"
        timeout?.cancel()
        phase = "connected"
        emit()
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral === selected else { return }
        optionalReads.remove(characteristic.uuid)
        guard error == nil, let bytes = characteristic.value else {
            if characteristic.uuid == featuresID { report?.featureRead = "failed" }
            if characteristic.uuid == dataID {
                report?.subscription = "failed"
                let nsError = error as NSError?
                let deniedErrors: [CBATTError.Code] = [.readNotPermitted, .insufficientAuthentication, .insufficientAuthorization,
                                                       .insufficientEncryptionKeySize, .insufficientEncryption]
                let denied = nsError?.domain == CBATTErrorDomain && deniedErrors.contains { $0.rawValue == nsError?.code }
                endProbe("failed", denied ? "dataReadDenied" : "dataReadFailed",
                         denied ? "This treadmill denied access to its data readings." : "The treadmill data reading failed.")
                return
            }
            if !finishProbeIfReady() { emit() }
            return
        }
        let previouslyActive = control.active
        switch characteristic.uuid {
        case modelID, firmwareID, makerID:
            identity[characteristic.uuid] = String(data: bytes, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let identityKey = characteristic.uuid == modelID ? "model" : characteristic.uuid == firmwareID ? "firmware" : "manufacturer"
            if let text = identity[characteristic.uuid], !text.isEmpty { report?.details[identityKey] = String(text.prefix(128)) }
            if let maker = identity[makerID], !maker.isEmpty, let model = identity[modelID], !model.isEmpty,
               let firmware = identity[firmwareID], !firmware.isEmpty {
                report?.details["modelQualified"] = ClimbQualification.qualified.contains {
                    $0.maker == maker && $0.model == model && $0.firmware == firmware
                }
            }
            subscribeControlIfQualified(peripheral)
        case controlID: control.indication(bytes, now: uptime)
        case statusID: control.machineStatus(bytes)
        case featuresID:
            features = ClimbMachineFeatures(bytes)
            report?.featureRead = features == nil ? "failed" : "read"
            if let features {
                report?.details["advertisedMetrics"] = features.advertisedMetrics
                report?.details["speedTargets"] = features.speedTargets
                report?.details["inclineTargets"] = features.inclineTargets
            }
        case inclineRangeID:
            inclineRange = ClimbInclineRange(bytes)
            if let range = inclineRange {
                report?.details["inclineRange"] = ["min": range.minimum, "max": range.maximum, "step": range.increment]
            }
        case dataID:
            guard terminalProbe == nil else { return }
            scheduleRead(characteristic, from: peripheral)
            guard let frame = ClimbTreadmillFrame(bytes) else {
                report?.malformedCount += 1
                emit()
                return
            }
            let date = Date()
            report?.observe(frame.observedMetrics, at: date.timeIntervalSince1970 * 1000)
            telemetry.update(frame, uptime: uptime, date: date)
            expiry?.cancel()
            let work = DispatchWorkItem { [weak self] in self?.emit() }
            expiry = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 5.05, execute: work)
        default: return
        }
        if finishProbeIfReady() { return }
        if control.active && qualified == nil { releaseControl("Treadmill capability information changed.") }
        control.check(telemetry: telemetry, foreground: foreground, now: uptime)
        reconcileControl(previouslyActive)
        emit()
    }
}
#endif
