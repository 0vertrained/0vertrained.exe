import Foundation
import CoreBluetooth
import UIKit
import Capacitor

/// Foreground streaming and import for the signed-in athlete's selected strap.
@objc(WhoopBluetoothPlugin)
public final class WhoopBluetoothPlugin: CAPPlugin, CAPBridgedPlugin, CBCentralManagerDelegate, CBPeripheralDelegate {
    public let identifier = "WhoopBluetoothPlugin"
    public let jsName = "WhoopBluetooth"
    public let pluginMethods: [CAPPluginMethod] = ["setOwner", "getState", "scan", "stopScan", "connect", "disconnect",
                                                       "startHistorySync", "readHistory"].map {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }

    private let hrService = CBUUID(string: "180D")
    private let hrMeasurement = CBUUID(string: "2A37")
    private let strapService = CBUUID(string: WhoopLiveProtocol.serviceUUID)
    private let commandID = CBUUID(string: WhoopLiveProtocol.commandUUID)
    private let eventID = CBUUID(string: WhoopLiveProtocol.eventUUID)
    private let dataID = CBUUID(string: WhoopLiveProtocol.dataUUID)
    private let responseID = CBUUID(string: WhoopLiveProtocol.responseUUID)
    private let pairings = WhoopPairings(defaults: .standard)
    private var pairing: WhoopPairing?

    private var owner: String?
    private var central: CBCentralManager?
    private var devices: [UUID: CBPeripheral] = [:]
    private var names: [UUID: String] = [:]
    private var active: CBPeripheral?
    private var pendingID: UUID?
    private var reconnectWork: DispatchWorkItem?
    private var reconnectFailures = 0
    private var automaticConnection = false
    private var automaticHistory = false
    private var historyNeedsReconnect = false
    private var cancelling: Set<UUID> = []
    private var status = "idle"
    private var message: String?
    private var lastSample: [String: Any]?
    private var timer: DispatchWorkItem?
    private var standardSource: CBCharacteristic?
    private var command: CBCharacteristic?
    private var vendorEvent: CBCharacteristic?
    private var vendorData: CBCharacteristic?
    private var vendorResponse: CBCharacteristic?
    private var discoveredServices: Set<CBUUID> = []
    private var vendorStarted = false
    private var waitingForPairingWrite = false
    private var requestedVendorStream = false
    private var decoder = WhoopLiveFrameDecoder()
    private var eventDecoder = WhoopLiveFrameDecoder()
    private var responseDecoder = WhoopLiveFrameDecoder()
    private let archiveQueue = DispatchQueue(label: "ot.whoop.history", qos: .userInitiated)
    private var transfer: WhoopHistoryTransfer?
    private var transferID = UUID()
    private var commitPending = false
    private var sequence: UInt8 = 4
    private var batterySequence: UInt8?
    private var historySequence: UInt8?
    private var ackSequence: UInt8?
    private var historyTimer: DispatchWorkItem?
    private var lastProgress: TimeInterval = 0
    private var historyStatus = "idle"
    private var historyMessage: String?
    private var imported = 0
    private var unsupported = 0
    private var lastSyncAt: Int64?
    private var batteryPercent: Int?
    private var batteryAt: Int64?
    private var lastLiveAt: Int64?
    private var lastImportedAt: Int64?
    private var lastReadingAt: Int64? {
        [lastLiveAt, lastImportedAt].compactMap { $0 }.max()
    }
    private var cachedAt: Int64 = 0
    private var lastIntervalUptime = -TimeInterval.infinity
    private var sampleSource: CBUUID?
    private var sampleUptime: TimeInterval = 0

    public override func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(didEnterBackground),
                                               name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(becameActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func didEnterBackground() {
        cancelRetry()
        if status == "scanning" {
            stopScanning()
            setStatus("idle")
        } else if status == "connected" || status == "connecting" {
            endConnection(stopVendor: true)
            setStatus("disconnected", "Heart rate paused while the app is in the background.")
        }
    }

    @objc private func becameActive() {
        if status == "connected" { refreshSavedStrap() }
        else { resumeSavedStrap() }
    }

    private func cancelRetry() {
        reconnectWork?.cancel()
        reconnectWork = nil
    }

    private var automaticTarget: UUID? {
        guard owner != nil else { return nil }
        return pairing?.automaticTarget(foreground: UIApplication.shared.applicationState == .active,
                                        authorized: CBManager.authorization == .allowedAlways)
    }

    private func resumeSavedStrap() {
        guard let id = automaticTarget, active == nil, pendingID == nil, status != "scanning" else { return }
        cancelRetry()
        pendingID = id
        automaticConnection = true
        setStatus("connecting", "Reconnecting to your WHOOP…")
        prepareBluetooth()
    }

    private func scheduleRetry() {
        guard let owner, let id = automaticTarget, central?.state == .poweredOn, reconnectWork == nil else { return }
        let delay = WhoopPairings.retryDelay(failures: reconnectFailures)
        reconnectFailures = min(reconnectFailures + 1, 4)
        reconnectWork = after(delay) { [weak self] in
            guard let self else { return }
            self.reconnectWork = nil
            if self.owner == owner, self.pairing?.id == id { self.resumeSavedStrap() }
        }
    }

    private var saved: [String: String]? {
        pairing.map { ["id": $0.id.uuidString, "name": $0.name] }
    }

    private func savePairing(_ value: WhoopPairing?) {
        guard let owner else { return }
        pairing = value
        pairings.save(value, owner: owner)
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
            "autoReconnect": pairing?.reconnect ?? false,
            "lastSample": lastSample as Any? ?? NSNull(),
            "batteryPercent": batteryPercent as Any? ?? NSNull(), "batteryAt": batteryAt as Any? ?? NSNull(),
            "lastReadingAt": lastReadingAt as Any? ?? NSNull(), "lastLiveAt": lastLiveAt as Any? ?? NSNull(),
            "historyAvailable": historyAvailable,
            "history": ["status": historyStatus, "message": historyMessage as Any? ?? NSNull(), "records": imported,
                        "unsupported": unsupported, "lastSyncAt": lastSyncAt as Any? ?? NSNull()] as [String: Any]
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
                self.cancelRetry()
                self.reconnectFailures = 0
                self.stopScanning()
                self.endConnection(stopVendor: true)
                self.devices.removeAll()
                self.names.removeAll()
                self.owner = next
                self.pairing = next.flatMap { self.pairings.load(owner: $0) }
                self.historyStatus = "idle"
                self.historyMessage = nil
                self.imported = 0
                self.unsupported = 0
                self.restoreReadings(id: self.saved?["id"])
                self.setStatus("idle")
                self.resumeSavedStrap()
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
            self.cancelRetry()
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
            self.cancelRetry()
            if var saved = self.pairing, saved.id == id {
                saved.reconnect = true
                self.savePairing(saved)
            }
            self.automaticConnection = false
            self.restoreReadings(id: id.uuidString)
            self.pendingID = id
            self.setStatus("connecting", "Connecting to your WHOOP…")
            self.prepareBluetooth()
            call.resolve(self.snapshot)
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        authorized(call) {
            self.cancelRetry()
            self.stopScanning()
            self.endConnection(stopVendor: true)
            if call.getBool("forget") == true {
                self.savePairing(nil)
                self.restoreReadings(id: nil)
            } else if var saved = self.pairing {
                saved.reconnect = false
                self.savePairing(saved)
            }
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
        timer = nil
        cacheReadings()
        if transfer != nil {
            historyStatus = "interrupted"
            historyMessage = "Sync paused. Saved blocks are on this iPhone."
        }
        resetTransfer()
        automaticHistory = false
        historyNeedsReconnect = false
        automaticConnection = false
        batterySequence = nil
        responseDecoder = WhoopLiveFrameDecoder()
        eventDecoder = WhoopLiveFrameDecoder()
        active = nil
        pendingID = nil
        standardSource = nil
        command = nil
        vendorEvent = nil
        vendorData = nil
        vendorResponse = nil
        discoveredServices.removeAll()
        vendorStarted = false
        waitingForPairingWrite = false
        requestedVendorStream = false
        decoder = WhoopLiveFrameDecoder()
        lastSample = nil
        sampleSource = nil
        lastIntervalUptime = -.infinity
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
        let retry = pairing.map { $0.id == active?.identifier || $0.id == pendingID } ?? false
        endConnection()
        setStatus("error", detail)
        if retry { scheduleRetry() }
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
            else if status == "unavailable" {
                setStatus("idle")
                resumeSavedStrap()
            }
            return
        case .unknown: return
        case .resetting: message = "Bluetooth is restarting. Try again when it’s ready."
        case .poweredOff: message = "Turn on Bluetooth in iPhone Settings to reach your strap."
        case .unauthorized: message = "Allow Bluetooth for 0VERTRAINED in iPhone Settings."
        case .unsupported: message = "This device does not support a Bluetooth strap connection."
        @unknown default: message = "Bluetooth is unavailable."
        }
        cancelRetry()
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
        // CoreBluetooth keeps a request for a known peripheral pending until
        // it returns within range. A foreground reconnect can wait for it.
        if !automaticConnection { startDiscoveryTimeout() }
    }

    private func startDiscoveryTimeout() {
        timer?.cancel()
        timer = after(55) { [weak self] in
            guard let self, self.status == "connecting" else { return }
            self.failed("No heart rate received. Wear the strap snugly, wake it, and check the iPhone pairing prompt.")
        }
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard peripheral === active else { return }
        startDiscoveryTimeout()
        setStatus("connecting", automaticConnection ? "Restoring your WHOOP connection…"
                  : "Waiting for heart rate. Accept the iPhone pairing prompt if shown.")
        peripheral.discoverServices([hrService, strapService])
    }

    private func linkEnded(_ central: CBCentralManager, _ p: CBPeripheral, _ detail: String) {
        if cancelling.remove(p.identifier) != nil {
            if pendingID == p.identifier, active == nil, central.state == .poweredOn { startConnection(central) }
            return
        }
        guard p === active else { return }
        let retry = p.identifier == automaticTarget
        clearConnection()
        setStatus("disconnected", retry ? "Your iPhone will reconnect when the strap is nearby." : detail)
        if retry { scheduleRetry() }
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
            peripheral.discoverCharacteristics(service.uuid == hrService ? [hrMeasurement] : [commandID, dataID, responseID, eventID], for: service)
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
                if c.uuid == eventID, notifiable(c) { vendorEvent = c }
                if c.uuid == responseID, notifiable(c) { vendorResponse = c }
                if c.uuid == hrMeasurement, notifiable(c) { standardSource = c }
            }
        }
        guard discoveredServices.isEmpty else { return }
        if let standardSource {
            peripheral.setNotifyValue(true, for: standardSource)
        }
        // The proprietary channel also carries R-R, battery and stored history
        // when the standard profile is already broadcasting.
        startVendorIfNeeded()
    }

    private func startVendorIfNeeded() {
        guard active?.state == .connected, !vendorStarted, let active else { return }
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
        } else if characteristic.uuid == responseID, error == nil, characteristic.isNotifying {
            requestBatteryIfDue()
            historyReady()
        } else if characteristic.uuid == dataID {
            guard error == nil, characteristic.isNotifying, let command else {
                if standardSource == nil { failed("Couldn’t subscribe to the strap. Check the iPhone pairing prompt and retry.") }
                return
            }
            requestedVendorStream = true
            peripheral.writeValue(WhoopLiveProtocol.setStreaming(true), for: command, type: .withResponse)
            historyReady()
        }
    }

    public func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral === active, characteristic.uuid == commandID else { return }
        if error != nil {
            if transfer != nil { abortHistory("The strap declined a sync write. Reconnect and retry."); return }
            if standardSource == nil { failed("The strap declined the live connection. Check the iPhone pairing prompt and reconnect.") }
            return
        }
        if waitingForPairingWrite, let vendorData {
            waitingForPairingWrite = false
            if let vendorEvent { peripheral.setNotifyValue(true, for: vendorEvent) }
            if let vendorResponse { peripheral.setNotifyValue(true, for: vendorResponse) }
            peripheral.setNotifyValue(true, for: vendorData)
        }
    }

    public func peripheral(_ peripheral: CBPeripheral, didModifyServices services: [CBService]) {
        guard peripheral === active, services.contains(where: { $0.uuid == strapService || $0.uuid == hrService }) else { return }
        failed("The strap restarted its Bluetooth service. Reconnect to resume live heart rate.")
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral === active else { return }
        guard error == nil, let data = characteristic.value else {
            if [dataID, responseID, eventID].contains(characteristic.uuid), transfer != nil { abortHistory("A history notification was lost. Reconnect and retry.") }
            return
        }
        if characteristic.uuid == hrMeasurement, let reading = HeartRateMeasurement(data) {
            received(reading.bpm, rrMs: reading.rrMs, from: characteristic.uuid)
        } else {
            let frames: [Data]
            let discarded: Int
            switch characteristic.uuid {
            case dataID:
                frames = decoder.frames(data)
                discarded = decoder.discardedBytes
            case responseID:
                frames = responseDecoder.frames(data)
                discarded = responseDecoder.discardedBytes
            case eventID:
                frames = eventDecoder.frames(data)
                discarded = eventDecoder.discardedBytes
            default: return
            }
            if discarded > 0, transfer != nil {
                abortHistory("A history packet failed its checksum. Reconnect and retry.")
                return
            }
            for frame in frames {
                guard peripheral === active else { return }
                switch frame[4] {
                case 36: handleResponse(frame)
                case 40:
                    if let reading = WhoopLiveFrameDecoder.decodeHeartRate(frame) {
                        received(reading.bpm, rrMs: reading.rrMs.map(Double.init), from: characteristic.uuid)
                    }
                case 48 where characteristic.uuid == eventID:
                    // Real-time battery events can interleave with a disk commit.
                    if let value = WhoopHistoryReading.batteryEvent(frame) { updateBattery(value) }
                default:
                    if transfer != nil { routeHistory(frame, peripheral: peripheral, source: characteristic.uuid) }
                }
            }
        }
    }

    private func received(_ bpm: Int, rrMs: [Double], from source: CBUUID) {
        guard let owner else { return }
        let now = ProcessInfo.processInfo.systemUptime
        let hasIntervals = rrMs.contains { $0 > 0 }
        if let sampleSource, sampleSource != source, now - sampleUptime < 5 {
            // Switch from HR-only to a source carrying beats. Drop the first
            // overlapping packet while handing over to avoid counting beats twice.
            guard now - lastIntervalUptime >= 5, hasIntervals else { return }
            self.sampleSource = source
            lastIntervalUptime = now
            sampleUptime = now
            return
        }
        if hasIntervals { lastIntervalUptime = now }
        sampleSource = source
        sampleUptime = now
        let sample: [String: Any] = ["owner": owner, "bpm": bpm, "rrMs": rrMs, "timestamp": Int64(Date().timeIntervalSince1970 * 1000)]
        lastSample = sample
        lastLiveAt = Self.now
        if Self.now - cachedAt >= 60_000 { cacheReadings() }
        if status != "connected", let active {
            timer?.cancel()
            rememberSelection(active)
            setStatus("connected")
        }
        notifyListeners("sample", data: sample)
    }
}

extension WhoopBluetoothPlugin {
    private static var now: Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    private var historyAvailable: Bool {
        !historyNeedsReconnect && active?.state == .connected && command != nil
            && vendorData?.isNotifying == true && vendorResponse?.isNotifying == true
    }

    private func rememberSelection(_ peripheral: CBPeripheral) {
        let selected = WhoopPairing(id: peripheral.identifier, name: row(peripheral.identifier)["name"] ?? "WHOOP", reconnect: true)
        if selected != pairing { savePairing(selected) }
        reconnectFailures = 0
    }

    private func historyReady() {
        guard historyAvailable, let active else { return }
        timer?.cancel()
        rememberSelection(active)
        setStatus("connected")
        refreshSavedStrap()
    }

    private func requestBatteryIfDue() {
        guard transfer == nil, vendorResponse?.isNotifying == true, batterySequence == nil,
              WhoopPairings.historyDue(now: Self.now, lastCompleted: batteryAt) else { return }
        batterySequence = send(26, [0])
    }

    private func refreshSavedStrap() {
        guard let id = automaticTarget, id == active?.identifier, status == "connected", transfer == nil else { return }
        requestBatteryIfDue()
        if historyAvailable, WhoopPairings.historyDue(now: Self.now, lastCompleted: lastSyncAt) {
            beginHistory(automatic: true)
        }
    }

    private func restoreReadings(id: String?) {
        cachedAt = 0
        let defaults = UserDefaults.standard
        let prefix = owner.map { "ot.whoopBluetooth." + WhoopHistoryStore.key($0) }
        let saved = prefix.flatMap { key in id.flatMap { defaults.dictionary(forKey: key + "." + $0) } }
        lastSyncAt = (saved?["lastSyncAt"] as? NSNumber)?.int64Value
        // Previous versions saved the last successful import against the owner.
        if lastSyncAt == nil, id != nil, id == pairing?.id.uuidString, let prefix {
            lastSyncAt = (defaults.object(forKey: prefix + ".lastSync") as? NSNumber)?.int64Value
            if let lastSyncAt, let id {
                var values = saved ?? [:]
                values["lastSyncAt"] = NSNumber(value: lastSyncAt)
                defaults.set(values, forKey: prefix + "." + id)
                defaults.removeObject(forKey: prefix + ".lastSync")
            }
        }
        batteryPercent = (saved?["batteryPercent"] as? NSNumber)?.intValue
        batteryAt = (saved?["batteryAt"] as? NSNumber)?.int64Value
        lastLiveAt = (saved?["lastLiveAt"] as? NSNumber)?.int64Value
        lastImportedAt = nil
        guard let owner, let id else { return }
        archiveQueue.async {
            let latest = try? WhoopHistoryStore(owner: owner).latestPulse(device: id)
            DispatchQueue.main.async {
                let selected = (self.active?.identifier ?? self.pendingID)?.uuidString ?? self.saved?["id"]
                guard self.owner == owner, selected == id, let latest else { return }
                self.lastImportedAt = max(self.lastImportedAt ?? 0, latest)
                self.notifyListeners("state", data: self.snapshot)
            }
        }
    }

    private func cacheReadings() {
        guard let owner, let id = active?.identifier else { return }
        var values: [String: NSNumber] = [:]
        if let lastLiveAt { values["lastLiveAt"] = NSNumber(value: lastLiveAt) }
        if let lastSyncAt { values["lastSyncAt"] = NSNumber(value: lastSyncAt) }
        if let batteryAt, let batteryPercent {
            values["batteryAt"] = NSNumber(value: batteryAt)
            values["batteryPercent"] = NSNumber(value: batteryPercent)
        }
        UserDefaults.standard.set(values, forKey: "ot.whoopBluetooth." + WhoopHistoryStore.key(owner) + "." + id.uuidString)
        cachedAt = Self.now
    }

    private func send(_ number: UInt8, _ payload: [UInt8]) -> UInt8? {
        guard let active, let command, active.state == .connected else { return nil }
        sequence &+= 1
        let data = WhoopLiveProtocol.command(number, sequence: sequence, payload: payload)
        active.writeValue(data, for: command, type: .withResponse)
        return sequence
    }

    private func updateBattery(_ value: Int) {
        batteryPercent = value
        batteryAt = Self.now
        cacheReadings()
        notifyListeners("state", data: snapshot)
    }

    private func handleResponse(_ frame: Data) {
        guard frame.count >= 13, frame[4] == 36 else { return }
        if let seq = batterySequence, frame[6] == 26, frame[7] == seq {
            batterySequence = nil
            if let value = WhoopHistoryReading.battery(frame, sequence: seq) { updateBattery(value) }
        }
        guard transfer != nil,
              (frame[6] == 22 && frame[7] == historySequence) || (frame[6] == 23 && frame[7] == ackSequence) else { return }
        if frame[8] != 1 && frame[8] != 2 {
            abortHistory("Your strap declined the history request. Wake it and reconnect to try again.")
        }
    }

    @objc func startHistorySync(_ call: CAPPluginCall) {
        authorized(call) {
            if self.transfer != nil { call.resolve(self.snapshot); return }
            guard self.historyAvailable else { call.reject("Connect to your WHOOP 4.0 history channel first."); return }
            self.beginHistory(automatic: false)
            call.resolve(self.snapshot)
        }
    }

    private func beginHistory(automatic: Bool) {
        guard historyAvailable, transfer == nil, let request = send(22, [0]) else { return }
        automaticHistory = automatic
        transfer = WhoopHistoryTransfer()
        transferID = UUID()
        historyStatus = "syncing"
        historyMessage = nil
        imported = 0
        unsupported = 0
        historySequence = request
        lastProgress = ProcessInfo.processInfo.systemUptime
        watchHistory()
        notifyListeners("state", data: snapshot)
    }

    private func watchHistory() {
        historyTimer?.cancel()
        historyTimer = after(30) { [weak self] in
            guard let self, self.transfer != nil else { return }
            if ProcessInfo.processInfo.systemUptime - self.lastProgress >= 30 {
                self.abortHistory("The strap stopped sending history. Reconnect to continue the import.")
            } else { self.watchHistory() }
        }
    }

    private func resetTransfer() {
        historyTimer?.cancel()
        historyTimer = nil
        transferID = UUID()
        transfer = nil
        commitPending = false
        ackSequence = nil
        historySequence = nil
    }

    private func abortHistory(_ detail: String) {
        resetTransfer()
        historyStatus = "error"
        historyMessage = detail
        if automaticHistory {
            // A late END on the same connection must never acknowledge a new
            // transfer. Keep live workout HR running until the next connection.
            historyNeedsReconnect = true
            historyMessage = "Stored readings will retry after reconnecting. Live heart rate is still available."
            notifyListeners("state", data: snapshot)
            return
        }
        // A local timeout does not cancel the strap's transfer. Close this
        // connection so a subsequent attempt cannot receive its late END.
        failed(detail)
    }

    private func routeHistory(_ frame: Data, peripheral: CBPeripheral, source: CBUUID) {
        let onDataChannel = source == dataID
        guard let owner, WhoopHistoryTransfer.carriesHistory(frame, onDataChannel: onDataChannel) else { return }
        lastProgress = ProcessInfo.processInfo.systemUptime
        // A control frame can arrive on …0003 while a fragmented record is on
        // …0005. Never trim across an incomplete record on the data channel.
        if source != dataID, frame[4] == 49, [2, 3].contains(frame[6]), decoder.hasPartialFrame {
            abortHistory("A history block ended with a partial packet. Reconnect to retry.")
            return
        }
        if commitPending {
            abortHistory("History continued before the last block was confirmed. Reconnect to retry.")
            return
        }
        do {
            switch try transfer?.ingest(frame, onDataChannel: onDataChannel) {
            case .commit(let frames, let token):
                commitPending = true
                let current = transferID
                let device = peripheral.identifier.uuidString
                archiveQueue.async {
                    let result = Result { try WhoopHistoryStore(owner: owner).commit(frames, token: token, device: device) }
                    DispatchQueue.main.async {
                        // The disk commit remains valid across a disconnect. Only
                        // its original live session can deliver its trim ACK.
                        if case .success(let counts) = result, self.owner == owner,
                           let latest = counts.latestPulse {
                            let selected = (self.active?.identifier ?? self.pendingID)?.uuidString ?? self.saved?["id"]
                            if selected == device { self.lastImportedAt = max(self.lastImportedAt ?? 0, latest) }
                        }
                        guard current == self.transferID, self.owner == owner, self.active === peripheral else {
                            if self.owner == owner { self.notifyListeners("state", data: self.snapshot) }
                            return
                        }
                        self.commitPending = false
                        switch result {
                        case .success(let counts):
                            self.imported += counts.records
                            self.unsupported += counts.unsupported
                            self.ackSequence = self.send(23, [1] + token)
                            self.notifyListeners("state", data: self.snapshot)
                        case .failure(let error): self.abortHistory(error.localizedDescription)
                        }
                    }
                }
            case .complete:
                resetTransfer()
                historyStatus = "complete"
                lastSyncAt = Self.now
                cacheReadings()
                notifyListeners("state", data: snapshot)
            default: break
            }
        } catch { abortHistory(error.localizedDescription) }
    }

    @objc func readHistory(_ call: CAPPluginCall) {
        authorized(call) {
            guard let owner = self.owner, let from = call.getInt("from"), let to = call.getInt("to"), from >= 0, to >= from else {
                call.reject("Choose a valid period to read WHOOP history.")
                return
            }
            let after = max(0, call.getInt("after") ?? 0)
            let limit = min(4096, max(1, call.getInt("limit") ?? 1000))
            self.archiveQueue.async {
                let result = Result { try WhoopHistoryStore(owner: owner).read(from: Int64(from), to: Int64(to), after: Int64(after), limit: limit) }
                DispatchQueue.main.async {
                    guard self.owner == owner else { call.reject("The signed-in account changed."); return }
                    switch result {
                    case .success(let page):
                        call.resolve(["owner": owner, "records": page.records, "nextAfter": page.nextAfter as Any? ?? NSNull()])
                    case .failure(let error): call.reject(error.localizedDescription)
                    }
                }
            }
        }
    }
}
