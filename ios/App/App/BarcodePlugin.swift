import Foundation
import AVFoundation
import UIKit
import Vision
import VisionKit
import Capacitor

/// Food barcodes: scans one with the camera, and looks the product up in
/// Open Food Facts. The lookup runs here rather than in the page so the
/// page's content security policy stays as it is. Fuel decides what to log
/// (src/barcode.js).
@objc(BarcodePlugin)
public class BarcodePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BarcodePlugin"
    public let jsName = "OTBarcode"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lookup", returnType: CAPPluginReturnPromise)
    ]

    // The scanner on screen and what answers it, while a scan is open.
    private var scanner: UIViewController?
    private var scanDelegate: AnyObject?

    /// { supported }: whether this iPhone can scan barcodes with the camera.
    @objc func status(_ call: CAPPluginCall) {
        Task { @MainActor in
            if #available(iOS 16.0, *) {
                call.resolve(["supported": DataScannerViewController.isSupported])
            } else {
                call.resolve(["supported": false])
            }
        }
    }

    /// Opens the camera until a barcode is read or Cancel is tapped.
    /// Resolves { code } or { cancelled: true }; rejects when the camera
    /// isn't allowed or this iPhone can't scan.
    @objc func scan(_ call: CAPPluginCall) {
        guard #available(iOS 16.0, *) else {
            call.reject("Barcode scanning needs iOS 16 or later.", "unsupported")
            return
        }
        Task { @MainActor in
            guard DataScannerViewController.isSupported else {
                call.reject("This iPhone can't scan barcodes.", "unsupported")
                return
            }
            guard await Self.cameraAllowed() else {
                call.reject("0VERTRAINED isn't allowed to use the camera.", "camera")
                return
            }
            self.present(call)
        }
    }

    @available(iOS 16.0, *)
    @MainActor
    private func present(_ call: CAPPluginCall) {
        guard scanner == nil, let host = bridge?.viewController else {
            call.reject("A scan is already open.", "busy")
            return
        }
        let dataScanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.ean13, .ean8, .upce, .code128])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isHighlightingEnabled: true
        )
        let delegate = ScanDelegate { [weak self] code in
            self?.finish(call, code: code)
        }
        dataScanner.delegate = delegate
        dataScanner.title = "Scan a barcode"
        dataScanner.navigationItem.leftBarButtonItem = UIBarButtonItem(
            systemItem: .cancel,
            primaryAction: UIAction { [weak self] _ in self?.finish(call, code: nil) }
        )
        let navigation = UINavigationController(rootViewController: dataScanner)
        navigation.modalPresentationStyle = .fullScreen
        scanner = navigation
        scanDelegate = delegate
        host.present(navigation, animated: true) {
            try? dataScanner.startScanning()
        }
    }

    @MainActor
    private func finish(_ call: CAPPluginCall, code: String?) {
        guard let shown = scanner else { return }
        scanner = nil
        scanDelegate = nil
        if #available(iOS 16.0, *), let navigation = shown as? UINavigationController,
           let dataScanner = navigation.viewControllers.first as? DataScannerViewController {
            dataScanner.stopScanning()
        }
        shown.dismiss(animated: true) {
            if let code { call.resolve(["code": code]) } else { call.resolve(["cancelled": true]) }
        }
    }

    private static func cameraAllowed() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .video)
        default: return false
        }
    }

    /// code: a barcode. Resolves { found, code, name, brand, serving,
    /// perServing?, per100g? }, each macro set as { calories, protein, carbs,
    /// fats }. { found: false } when Open Food Facts doesn't have it, and
    /// { found: false, offline: true } when it can't be reached.
    @objc func lookup(_ call: CAPPluginCall) {
        let code = (call.getString("code") ?? "").filter(\.isNumber)
        guard (6...14).contains(code.count),
              var components = URLComponents(string: "https://world.openfoodfacts.org/api/v2/product/\(code).json") else {
            call.reject("That isn't a barcode.")
            return
        }
        components.queryItems = [URLQueryItem(name: "fields", value: "product_name,brands,serving_size,nutriments")]
        guard let url = components.url else {
            call.reject("That isn't a barcode.")
            return
        }
        var request = URLRequest(url: url, timeoutInterval: 8)
        // Open Food Facts asks apps to say who they are.
        request.setValue("0VERTRAINED iOS - personal training log", forHTTPHeaderField: "User-Agent")
        Task {
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                guard (response as? HTTPURLResponse)?.statusCode == 200,
                      let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      Self.number(json["status"]) == 1,
                      let product = json["product"] as? [String: Any] else {
                    call.resolve(["found": false, "code": code])
                    return
                }
                call.resolve(Self.describe(product, code: code))
            } catch {
                call.resolve(["found": false, "code": code, "offline": true])
            }
        }
    }

    private static func describe(_ product: [String: Any], code: String) -> [String: Any] {
        let nutriments = product["nutriments"] as? [String: Any] ?? [:]
        var result: [String: Any] = [
            "found": true,
            "code": code,
            "name": (product["product_name"] as? String) ?? "",
            "brand": ((product["brands"] as? String) ?? "").split(separator: ",").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? "",
            "serving": (product["serving_size"] as? String) ?? ""
        ]
        if let perServing = macros(nutriments, suffix: "_serving") { result["perServing"] = perServing }
        if let per100g = macros(nutriments, suffix: "_100g") { result["per100g"] = per100g }
        return result
    }

    private static func macros(_ nutriments: [String: Any], suffix: String) -> [String: Double]? {
        guard let calories = number(nutriments["energy-kcal\(suffix)"]) else { return nil }
        return [
            "calories": calories,
            "protein": number(nutriments["proteins\(suffix)"]) ?? 0,
            "carbs": number(nutriments["carbohydrates\(suffix)"]) ?? 0,
            "fats": number(nutriments["fat\(suffix)"]) ?? 0
        ]
    }

    private static func number(_ value: Any?) -> Double? {
        if let value = value as? NSNumber { return value.doubleValue }
        if let value = value as? String { return Double(value) }
        return nil
    }
}

/// Hands the first barcode read back once.
@available(iOS 16.0, *)
private final class ScanDelegate: NSObject, DataScannerViewControllerDelegate {
    private var onCode: ((String) -> Void)?

    init(onCode: @escaping (String) -> Void) {
        self.onCode = onCode
    }

    func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
        for item in addedItems {
            guard case .barcode(let barcode) = item, let code = barcode.payloadStringValue, !code.isEmpty else { continue }
            let handler = onCode
            onCode = nil
            handler?(code)
            return
        }
    }
}
