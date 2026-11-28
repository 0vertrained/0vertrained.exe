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
            self.clear("idle", "Reconnect the treadmill when you return to Race the Climb.")
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.snapshot()) }
    }

    @objc func scan(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.selected == nil else { call.reject("Disconnect the selected treadmill before scanning."); return }
            self.wantsScan = true
            self.phase = "scanning"
            self.message = nil
            self.devices.removeAll()
            self.names.removeAll()
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
            self.stopScan()
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
        DispatchQueue.main.async { self.clear("idle", nil); call.resolve(self.snapshot()) }
    }

    private func after(_ seconds: Double, _ action: @escaping () -> Void) {
        timeout?.cancel()
        let work = DispatchWorkItem(block: action)
        timeout = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    private func connectionTimeout() {
        after(15) { [weak self] in self?.clear("idle", "The treadmill did not start a data connection. Try waking its console.") }
    }

    private func stopScan() {
        wantsScan = false
        if central?.isScanning == true { central?.stopScan() }
        timeout?.cancel()
        timeout = nil
    }

    private func clear(_ status: String, _ reason: String?) {
        stopScan()
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
        phase = status
        message = reason
        emit()
    }

    private func snapshot() -> [String: Any] {
        let now = ProcessInfo.processInfo.systemUptime
        var value: [String: Any] = [
            "status": phase, "autoIncline": qualified != nil, "controlStage": control.stage.rawValue,
            "fresh": telemetry.distance?.fresh(now) == true || telemetry.speed?.fresh(now) == true,
            "devices": devices.keys.sorted { (names[$0] ?? "", $0.uuidString) < (names[$1] ?? "", $1.uuidString) }
                .map { ["id": $0.uuidString, "name": names[$0] ?? "Fitness machine"] }
        ]
        value["message"] = control.reason ?? message
        value["armToken"] = control.token?.uuidString
        value["targetIncline"] = control.target
        value["deviceId"] = selected?.identifier.uuidString
        value["deviceName"] = selected.flatMap { names[$0.identifier] }
        value["connectionId"] = connectionID
        value["sampleAt"] = [telemetry.distance, telemetry.speed].compactMap { $0?.wallMilliseconds }.max()
        func put(_ reading: ClimbTelemetry.Value?, _ field: String, _ time: String) {
            guard let reading else { return }
            value[time] = reading.wallMilliseconds
            if reading.fresh(now) { value[field] = reading.number }
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
        if central.state != .poweredOn {
            if central.state == .unknown { return }
            cancelling.removeAll()
            devices.removeAll()
            names.removeAll()
            clear("unavailable", central.state == .unauthorized ? "Allow Bluetooth access for 0VERTRAINED in Settings." : "Treadmill Bluetooth is unavailable.")
            return
        }
        guard wantsScan else { return }
        for device in central.retrieveConnectedPeripherals(withServices: [service]) {
            devices[device.identifier] = device
            names[device.identifier] = device.name
        }
        central.scanForPeripherals(withServices: [service], options: nil)
        after(12) { [weak self] in
            guard let self, self.phase == "scanning" else { return }
            self.stopScan()
            self.phase = "idle"
            if self.devices.isEmpty { self.message = "No fitness machines found. Wake the console or use manual cues." }
            self.emit()
        }
        emit()
    }

    public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                               advertisementData: [String: Any], rssi RSSI: NSNumber) {
        guard phase == "scanning", devices.count < 64 || devices[peripheral.identifier] != nil else { return }
        devices[peripheral.identifier] = peripheral
        names[peripheral.identifier] = advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? peripheral.name
        emit()
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard peripheral === selected else { central.cancelPeripheralConnection(peripheral); return }
        peripheral.discoverServices([service, info])
    }

    public func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        cancelling.remove(peripheral.identifier)
        if peripheral === selected { clear("idle", "The connection failed. Select the treadmill to retry.") }
    }

    public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        cancelling.remove(peripheral.identifier)
        if peripheral === selected { clear("idle", "Treadmill disconnected. Reconnect or continue with manual readings.") }
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard peripheral === selected else { return }
        guard error == nil, let machine = peripheral.services?.first(where: { $0.uuid == service }) else {
            clear("idle", "This device did not expose a fitness machine service."); return
        }
        peripheral.discoverCharacteristics([dataID, featuresID, inclineRangeID, controlID, statusID], for: machine)
        if let information = peripheral.services?.first(where: { $0.uuid == info }) {
            peripheral.discoverCharacteristics([modelID, firmwareID, makerID], for: information)
        }
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard peripheral === selected else { return }
        if service.uuid == info {
            for c in service.characteristics ?? [] where c.properties.contains(.read) { peripheral.readValue(for: c) }
            return
        }
        guard error == nil, let characteristics = service.characteristics,
              let belt = characteristics.first(where: { $0.uuid == dataID }),
              belt.properties.contains(.notify) || belt.properties.contains(.indicate) else {
            clear("idle", "This fitness machine does not broadcast treadmill readings."); return
        }
        for c in characteristics {
            if (c.uuid == featuresID || c.uuid == inclineRangeID) && c.properties.contains(.read) { peripheral.readValue(for: c) }
            if c.uuid == controlID && c.properties.contains(.write) && c.properties.contains(.indicate) {
                controlPoint = c
            }
            if c.uuid == statusID && c.properties.contains(.notify) { statusPoint = c }
        }
        subscribeControlIfQualified(peripheral)
        peripheral.setNotifyValue(true, for: belt)
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
            clear("idle", "The treadmill did not enable its data stream."); return
        }
        timeout?.cancel()
        phase = "connected"
        emit()
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral === selected, error == nil, let bytes = characteristic.value else { return }
        let previouslyActive = control.active
        switch characteristic.uuid {
        case modelID, firmwareID, makerID:
            identity[characteristic.uuid] = String(data: bytes, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            subscribeControlIfQualified(peripheral)
        case controlID: control.indication(bytes, now: uptime)
        case statusID: control.machineStatus(bytes)
        case featuresID: features = ClimbMachineFeatures(bytes)
        case inclineRangeID: inclineRange = ClimbInclineRange(bytes)
        case dataID:
            guard let frame = ClimbTreadmillFrame(bytes) else { return }
            telemetry.update(frame, uptime: ProcessInfo.processInfo.systemUptime, date: Date())
            expiry?.cancel()
            let work = DispatchWorkItem { [weak self] in self?.emit() }
            expiry = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 5.05, execute: work)
        default: return
        }
        if control.active && qualified == nil { releaseControl("Treadmill capability information changed.") }
        control.check(telemetry: telemetry, foreground: foreground, now: uptime)
        reconcileControl(previouslyActive)
        emit()
    }
}
