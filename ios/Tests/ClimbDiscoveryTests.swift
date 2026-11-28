import Foundation

@main
struct ClimbDiscoveryTests {
    static func main() {
        let discovery = ClimbScanEvidence.discovery
        precondition(discovery("ftms", false, nil) == "advertisedFTMS")
        precondition(discovery("peloton", false, "Headphones") == nil)
        precondition(discovery("peloton", false, nil) == nil)
        for name in ["PELOTON 0", "Living room Tread", "FiTsWiTcH"] {
            precondition(discovery("peloton", false, name) == "nameMatch")
        }
        precondition(discovery("ftms", true, nil) == "advertisedFTMS")
        precondition(discovery("peloton", true, "Tread") == "advertisedFTMS")

        var scan = ClimbScanEvidence()
        precondition(scan.snapshot["state"] as? String == "idle")
        scan.finish("unavailable", at: 45)
        precondition(scan.state == "unavailable" && scan.snapshot["startedAt"] == nil)
        scan.begin(peloton: true, at: 50)
        scan.finish("unavailable", at: 55)
        scan.finish(at: 56)
        precondition(scan.state == "unavailable" && scan.mode == "peloton")
        scan.begin(peloton: false, at: 60)
        precondition(scan.found == 0 && scan.snapshot["endedAt"] == nil)
        scan.finish("interrupted", at: 65)
        precondition(scan.state == "interrupted")
        scan.begin(peloton: false, at: 70)
        scan.finish(at: 82)
        precondition(scan.state == "empty")
        scan.begin(peloton: true, at: 90)
        scan.seen(2)
        scan.finish(at: 102)
        scan.seen(5)
        precondition(scan.state == "found" && scan.found == 2)

        var device = ClimbDeviceEvidence(deviceName: "Tread", discovery: "nameMatch", startedAt: 110)
        precondition(device.snapshot["serviceFound"] == nil && device.snapshot["advertisedMetrics"] == nil)
        device.serviceFound = true
        device.treadmillDataFound = true
        device.subscription = "subscribed"
        device.details["advertisedMetrics"] = ["distanceMeters": true]
        device.observe(["speedMps": 2.25, "heartRateBpm": .nan], at: 120)
        device.observe(["inclinePercent": 0], at: 124)
        precondition(device.state == "receiving")
        device.finish("disconnected", reason: "connectionLost", message: "Link lost.", at: 140)
        device.observe(["speedMps": 10], at: 145)
        device.finish("failed", reason: "other", message: nil, at: 150)
        let previous = device.snapshot
        let metrics = previous["metrics"] as? [String: [String: Double]]
        precondition(metrics == ["speedMps": ["value": 2.25, "at": 120], "inclinePercent": ["value": 0, "at": 124]])
        precondition(previous["lastSampleAt"] as? Double == 124 && previous["endedAt"] as? Double == 140)
        precondition(previous["sampleCount"] as? Int == 2 && previous["reasonCode"] as? String == "connectionLost")
        precondition(previous["advertisedMetrics"] as? [String: Bool] == ["distanceMeters": true])
        precondition(JSONSerialization.isValidJSONObject(previous))

        var next = ClimbDeviceEvidence(deviceName: "Second treadmill", discovery: "advertisedFTMS", startedAt: 160)
        next.featureRead = "pending"
        next.subscription = "pending"
        next.finish("failed", reason: "serviceDiscoveryFailed", message: "Could not check.", at: 163)
        precondition(next.featureRead == "interrupted" && next.subscription == "interrupted")
        precondition(next.snapshot["serviceFound"] == nil && next.snapshot["lastSampleAt"] == nil)
        precondition(next.snapshot["sampleCount"] as? Int == 0 && next.snapshot["advertisedMetrics"] == nil)
        var unsupported = ClimbDeviceEvidence(deviceName: "Tread", discovery: "nameMatch", startedAt: 170)
        unsupported.serviceFound = false
        unsupported.finish("incompatible", reason: "serviceMissing", message: "No FTMS.", at: 174)
        precondition(unsupported.snapshot["serviceFound"] as? Bool == false)
        print("Climb treadmill discovery and session evidence tests passed.")
    }
}
