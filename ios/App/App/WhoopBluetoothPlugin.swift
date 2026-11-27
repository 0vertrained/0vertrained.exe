import Foundation
import CoreBluetooth
import UIKit
import Capacitor

/// A user-initiated, foreground connection to the athlete's strap. Only the
/// selected peripheral's identifier and display name survive an app restart.
@objc(WhoopBluetoothPlugin)
public final class WhoopBluetoothPlugin: CAPPlugin, CAPBridgedPlugin, CBCentralManagerDelegate, CBPeripheralDelegate {
    public let identifier = "WhoopBluetoothPlugin"
    public let jsName = "WhoopBluetooth"
    public let pluginMethods: [CAPPluginMethod] = ["setOwner", "getState", "scan", "stopScan", "connect", "disconnect"].map {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }

    private let hrService = CBUUID(string: "180D")
    private let hrMeasurement = CBUUID(string: "2A37")
    private let strapService = CBUUID(string: WhoopLiveProtocol.serviceUUID)
    private let commandID = CBUUID(string: WhoopLiveProtocol.commandUUID)
    private let dataID = CBUUID(string: WhoopLiveProtocol.dataUUID)
    private let responseID = CBUUID(string: WhoopLiveProtocol.responseUUID)
    private let savedKey = "ot.whoopBluetooth.selected.v1"

    private var owner: String?
    private var central: CBCentralManager?
    private var devices: [UUID: CBPeripheral] = [:]
    private var names: [UUID: String] = [:]
    private var active: CBPeripheral?
    private var pendingID: UUID?
    private var resumeOnForeground: (owner: String, id: UUID)?
    private var cancelling: Set<UUID> = []
    private var status = "idle"
    private var message: String?
    private var lastSample: [String: Any]?
    private var timer: DispatchWorkItem?
    private var vendorFallback: DispatchWorkItem?
    private var standardSource: CBCharacteristic?
    private var command: CBCharacteristic?
    private var vendorData: CBCharacteristic?
    private var vendorResponse: CBCharacteristic?
    private var discoveredServices: Set<CBUUID> = []
    private var vendorStarted = false
    private var waitingForPairingWrite = false
    private var requestedVendorStream = false
    private var decoder = WhoopLiveFrameDecoder()
    private var sampleSource: CBUUID?
    private var sampleUptime: TimeInterval = 0

    public override func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(didEnterBackground),
                                               name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(willEnterForeground),
                                               name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    @objc private func didEnterBackground() {
        if status == "scanning" {
            stopScanning()
            setStatus("idle")
        } else if status == "connected" || status == "connecting" {
            if status == "connected", let owner, let active {
                resumeOnForeground = (owner, active.identifier)
            }
            endConnection(stopVendor: true)
            setStatus("disconnected", "Heart rate paused while the app is in the background.")
        }
    }

    @objc private func willEnterForeground() {
        guard let resume = resumeOnForeground else { return }
        resumeOnForeground = nil
        guard owner == resume.owner, active == nil, pendingID == nil else { return }
        pendingID = resume.id
        setStatus("connecting", "Reconnecting to your WHOOP…")
        prepareBluetooth()
    }

    private var saved: [String: String]? {
        guard let owner, let stored = UserDefaults.standard.dictionary(forKey: savedKey) as? [String: String],
              stored["owner"] == owner, let id = stored["id"], let name = stored["name"] else { return nil }
        return ["id": id, "name": name]
    }

    private func row(_ id: UUID) -> [String: String] {
        ["id": id.uuidString, "name": names[id] ?? devices[id]?.name ?? saved?["name"] ?? "WHOOP"]
    }

    private var snapshot: [String: Any] {
        let device = (active?.identifier ?? pendingID).map(row)
        return [
            "owner": owner as Any? ?? NSNull(), "status": status, "message": message as Any? ?? NSNull(),
            "devices": devices.keys.map(row).sorted { ($0["name"] ?? "", $0["id"] ?? "") < ($1["name"] ?? "", $1["id"] ?? "") },
            "device": device as Any? ?? NSNull(), "savedDevice": saved as Any? ?? NSNull(),
            "lastSample": lastSample as Any? ?? NSNull()
        ]
    }

    private func setStatus(_ value: String, _ detail: String? = nil) {
        status = value
        message = detail
        notifyListeners("state", data: snapshot)
    }

    @objc func setOwner(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let next = call.getString("owner").flatMap { $0.isEmpty ? nil : $0 }
            if next != self.owner || next == nil {
                self.resumeOnForeground = nil
                self.stopScanning()
                self.endConnection(stopVendor: true)
                self.devices.removeAll()
                self.names.removeAll()
                self.owner = next
                if next == nil || self.saved == nil { UserDefaults.standard.removeObject(forKey: self.savedKey) }
                self.setStatus("idle")
            }
            call.resolve(self.snapshot)
        }
    }

    private func authorized(_ call: CAPPluginCall, _ action: @escaping () -> Void) {
        DispatchQueue.main.async {
            guard let owner = self.owner, call.getString("owner") == owner else {
                call.reject("Sign in to use the WHOOP connection.")
                return
            }
            action()
        }
    }

    @objc func getState(_ call: CAPPluginCall) {
        // Initializing a CBCentralManager can prompt for permission. The web UI
        // may read state on mount without asking to use Bluetooth.
        authorized(call) { call.resolve(self.snapshot) }
    }

    @objc func scan(_ call: CAPPluginCall) {
        authorized(call) {
            guard self.active == nil, self.pendingID == nil else {
                call.reject("Disconnect your strap before scanning again.")
                return
            }
            self.stopScanning()
            self.devices.removeAll()
            self.names.removeAll()
            self.setStatus("scanning")
            self.prepareBluetooth()
            call.resolve(self.snapshot)
        }
    }

    @objc func stopScan(_ call: CAPPluginCall) {
        authorized(call) {
            if self.status == "scanning" {
                self.stopScanning()
                self.setStatus("idle")
            }
            call.resolve(self.snapshot)
        }
    }

    @objc func connect(_ call: CAPPluginCall) {
        authorized(call) {
            guard let text = call.getString("id"), let id = UUID(uuidString: text),
                  self.devices[id] != nil || id.uuidString == self.saved?["id"] else {
                call.reject("Scan for your WHOOP and select it from the list.")
                return
            }
            if let selected = self.active?.identifier ?? self.pendingID {
                guard id == selected else { call.reject("Disconnect the current strap first."); return }
                call.resolve(self.snapshot)
                return
            }
            self.stopScanning()
            self.pendingID = id
            self.setStatus("connecting", "Connecting to your WHOOP…")
            self.prepareBluetooth()
            call.resolve(self.snapshot)
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        authorized(call) {
            self.resumeOnForeground = nil
            if call.getBool("forget") == true { UserDefaults.standard.removeObject(forKey: self.savedKey) }
            self.stopScanning()
            self.endConnection(stopVendor: true)
            self.setStatus("idle")
            call.resolve(self.snapshot)
        }
    }

    private func after(_ seconds: TimeInterval, perform: @escaping () -> Void) -> DispatchWorkItem {
        let item = DispatchWorkItem(block: perform)
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: item)
        return item
    }

    private func stopScanning() {
        if central?.isScanning == true { central?.stopScan() }
        if status == "scanning" { timer?.cancel(); timer = nil }
    }

    private func clearConnection() {
        timer?.cancel()
        vendorFallback?.cancel()
        timer = nil
        vendorFallback = nil
        active = nil
        pendingID = nil
        standardSource = nil
        command = nil
        vendorData = nil
        vendorResponse = nil
        discoveredServices.removeAll()
        vendorStarted = false
        waitingForPairingWrite = false
        requestedVendorStream = false
        decoder = WhoopLiveFrameDecoder()
        lastSample = nil
        sampleSource = nil
    }

    private func endConnection(stopVendor: Bool = false) {
        let peripheral = active
        let stopCommand = stopVendor && requestedVendorStream ? command : nil
        clearConnection()
        guard let peripheral, peripheral.state != .disconnected, central?.state == .poweredOn else { return }
        cancelling.insert(peripheral.identifier)
        if let stopCommand, peripheral.state == .connected {
            // Release the per-connection stream even when iOS keeps the
            // physical link up for another app. Allow the write to go out.
            peripheral.writeValue(WhoopLiveProtocol.setStreaming(false), for: stopCommand, type: .withResponse)
            _ = after(0.4) { [weak self] in
                guard let self, self.cancelling.contains(peripheral.identifier) else { return }
                self.central?.cancelPeripheralConnection(peripheral)
            }
        } else {
            central?.cancelPeripheralConnection(peripheral)
        }
    }

    private func failed(_ detail: String) {
        endConnection()
        setStatus("error", detail)
    }

    private func prepareBluetooth() {
        if let central { centralManagerDidUpdateState(central) }
        else {
            central = CBCentralManager(delegate: self, queue: .main,
                                       options: [CBCentralManagerOptionShowPowerAlertKey: false])
        }
    }

    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            if status == "scanning", !central.isScanning { startScan(central) }
            else if status == "connecting", active == nil { startConnection(central) }
            else if status == "unavailable" { setStatus("idle") }
            return
        case .unknown: return
        case .resetting: message = "Bluetooth is restarting. Try again when it’s ready."
        case .poweredOff: message = "Turn on Bluetooth in iPhone Settings, then try again."
        case .unauthorized: message = "Allow Bluetooth for 0VERTRAINED in iPhone Settings."
        case .unsupported: message = "This device does not support a Bluetooth strap connection."
        @unknown default: message = "Bluetooth is unavailable."
        }
        clearConnection()
        devices.removeAll()
        names.removeAll()
        cancelling.removeAll()
        setStatus("unavailable", message)
    }

    private func startScan(_ central: CBCentralManager) {
        // A strap can already be connected to iOS and absent from advertisements.
        for p in central.retrieveConnectedPeripherals(withServices: [strapService]) {
            remember(p, advertisedName: nil)
        }
        for p in central.retrieveConnectedPeripherals(withServices: [hrService]) where isWhoop(p, advertisedName: nil) {
            remember(p, advertisedName: nil)
        }
        // Some WHOOP firmware advertises only its name. Restrict displayed
        // candidates to known WHOOP services/names, then require user selection.
        central.scanForPeripherals(withServices: nil, options: nil)
        timer?.cancel()
        timer = after(15) { [weak self] in
            guard let self, self.status == "scanning" else { return }
            self.stopScanning()
            self.setStatus("idle", self.devices.isEmpty ? "No WHOOP found. Wake your strap and scan again." : nil)
        }
        notifyListeners("state", data: snapshot)
    }

    private func isWhoop(_ p: CBPeripheral, advertisedName: String?) -> Bool {
        [advertisedName, p.name].contains { $0?.localizedCaseInsensitiveContains("whoop") == true } ||
            p.identifier.uuidString == saved?["id"]
    }

    private func remember(_ p: CBPeripheral, advertisedName: String?) {
        devices[p.identifier] = p
        names[p.identifier] = advertisedName ?? p.name ?? names[p.identifier] ?? "WHOOP"
    }

    public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                               advertisementData: [String: Any], rssi RSSI: NSNumber) {
        guard status == "scanning" else { return }
        let advertisedName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        let services = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []
        guard services.contains(strapService) || isWhoop(peripheral, advertisedName: advertisedName) else { return }
        remember(peripheral, advertisedName: advertisedName)
        notifyListeners("state", data: snapshot)
    }

    private func startConnection(_ central: CBCentralManager) {
        guard let id = pendingID else { return }
        // Wait for the previous disconnect callback if the athlete immediately
        // reconnects. This prevents a late callback from tearing down a new link.
        if cancelling.contains(id) { return }
        guard let p = devices[id] ?? central.retrievePeripherals(withIdentifiers: [id]).first else {
            failed("This iPhone can’t find the saved strap. Scan for it again.")
            return
        }
        remember(p, advertisedName: names[id])
        active = p
        p.delegate = self
        central.connect(p, options: nil)
        timer?.cancel()
        timer = after(55) { [weak self] in
            guard let self, self.status == "connecting" else { return }
            self.failed("No heart rate received. Wear the strap snugly, wake it, and check the iPhone pairing prompt.")
        }
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard peripheral === active else { return }
        setStatus("connecting", "Waiting for heart rate. Accept the iPhone pairing prompt if shown.")
        peripheral.discoverServices([hrService, strapService])
    }

    private func linkEnded(_ central: CBCentralManager, _ p: CBPeripheral, _ detail: String) {
        if cancelling.remove(p.identifier) != nil {
            if pendingID == p.identifier, active == nil, central.state == .poweredOn { startConnection(central) }
            return
        }
        guard p === active else { return }
        clearConnection()
        setStatus("disconnected", detail)
    }

    public func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        linkEnded(central, peripheral, "Couldn’t connect to your WHOOP. Bring it near your iPhone and try again.")
    }

    public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        linkEnded(central, peripheral, "Your WHOOP disconnected. Reconnect when the strap is nearby.")
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard peripheral === active else { return }
        guard error == nil else { failed("Couldn’t read the strap’s Bluetooth services."); return }
        let services = (peripheral.services ?? []).filter { $0.uuid == hrService || $0.uuid == strapService }
        guard !services.isEmpty else {
            failed("This strap hasn’t exposed a supported live heart-rate service.")
            return
        }
        discoveredServices = Set(services.map(\.uuid))
        for service in services {
            peripheral.discoverCharacteristics(service.uuid == hrService ? [hrMeasurement] : [commandID, dataID, responseID], for: service)
        }
    }

    private func notifiable(_ c: CBCharacteristic) -> Bool {
        c.properties.contains(.notify) || c.properties.contains(.indicate)
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard peripheral === active else { return }
        discoveredServices.remove(service.uuid)
        if error == nil {
            for c in service.characteristics ?? [] {
                if c.uuid == commandID, c.properties.contains(.write) { command = c }
                if c.uuid == dataID, notifiable(c) { vendorData = c }
                if c.uuid == responseID, notifiable(c) { vendorResponse = c }
                if c.uuid == hrMeasurement, notifiable(c) { standardSource = c }
            }
        }
        guard discoveredServices.isEmpty else { return }
        if let standardSource {
            peripheral.setNotifyValue(true, for: standardSource)
            // Prefer the standard profile when already broadcasting. A strap
            // can expose that characteristic but stay silent until streaming
            // is enabled through its own service.
            vendorFallback = after(4) { [weak self] in self?.startVendorIfNeeded() }
        } else {
            startVendorIfNeeded()
        }
    }

    private func startVendorIfNeeded() {
        guard status == "connecting", !vendorStarted, let active else { return }
        guard vendorData != nil, let command else {
            if standardSource == nil { failed("The strap has no supported live heart-rate channel.") }
            return
        }
        vendorStarted = true
        // A confirmed battery request lets iOS establish the normal encrypted
        // link before subscribing to characteristics that require pairing.
        waitingForPairingWrite = true
        active.writeValue(WhoopLiveProtocol.pairingRead, for: command, type: .withResponse)
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral === active else { return }
        if characteristic.uuid == hrMeasurement, error != nil || !characteristic.isNotifying {
            standardSource = nil
            startVendorIfNeeded()
        } else if characteristic.uuid == dataID {
            guard error == nil, characteristic.isNotifying, let command else {
                if standardSource == nil { failed("Couldn’t subscribe to the strap. Check the iPhone pairing prompt and retry.") }
                return
            }
            requestedVendorStream = true
            peripheral.writeValue(WhoopLiveProtocol.setStreaming(true), for: command, type: .withResponse)
        }
    }

    public func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral === active, characteristic.uuid == commandID else { return }
        if error != nil {
            if standardSource == nil { failed("The strap declined the live connection. Check the iPhone pairing prompt and reconnect.") }
            return
        }
        if waitingForPairingWrite, let vendorData {
            waitingForPairingWrite = false
            if let vendorResponse { peripheral.setNotifyValue(true, for: vendorResponse) }
            peripheral.setNotifyValue(true, for: vendorData)
        }
    }

    public func peripheral(_ peripheral: CBPeripheral, didModifyServices services: [CBService]) {
        guard peripheral === active, services.contains(where: { $0.uuid == strapService || $0.uuid == hrService }) else { return }
        failed("The strap restarted its Bluetooth service. Reconnect to resume live heart rate.")
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral === active, error == nil, let data = characteristic.value else { return }
        if characteristic.uuid == hrMeasurement, let reading = HeartRateMeasurement(data) {
            received(reading.bpm, rrMs: reading.rrMs, from: characteristic.uuid)
        } else if characteristic.uuid == dataID {
            for reading in decoder.append(data) {
                received(reading.bpm, rrMs: reading.rrMs.map(Double.init), from: characteristic.uuid)
            }
        }
    }

    private func received(_ bpm: Int, rrMs: [Double], from source: CBUUID) {
        guard let owner else { return }
        let now = ProcessInfo.processInfo.systemUptime
        if let sampleSource, sampleSource != source, now - sampleUptime < 5 { return }
        sampleSource = source
        sampleUptime = now
        let sample: [String: Any] = ["owner": owner, "bpm": bpm, "rrMs": rrMs, "timestamp": Int64(Date().timeIntervalSince1970 * 1000)]
        lastSample = sample
        if status != "connected", let active {
            timer?.cancel()
            vendorFallback?.cancel()
            var selected = row(active.identifier)
            selected["owner"] = owner
            UserDefaults.standard.set(selected, forKey: savedKey)
            setStatus("connected")
        }
        notifyListeners("sample", data: sample)
    }
}
