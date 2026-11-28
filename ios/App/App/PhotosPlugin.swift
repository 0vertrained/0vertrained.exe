import Foundation

/// The unsuffixed ProgressPhotos directory predates athlete accounts. Only an
/// explicit, authenticated import moves that entire directory into one album.
struct AthletePhotoAlbum {
    struct Entry: Codable {
        let id: String
        let date: String
        let pose: String
        let savedAt: String
    }

    private let base: URL
    private let current: URL
    private let imported: URL
    private let fm = FileManager.default
    private var oldAlbum: URL { base.appendingPathComponent("ProgressPhotos", isDirectory: true) }

    init(base: URL, owner: UUID) {
        self.base = base
        let root = base.appendingPathComponent("AthleteProgressPhotos", isDirectory: true)
            .appendingPathComponent(owner.uuidString, isDirectory: true)
        current = root.appendingPathComponent("Current", isDirectory: true)
        imported = root.appendingPathComponent("Imported", isDirectory: true)
    }

    private func missing(_ error: Error) -> Bool {
        let ns = error as NSError
        return ns.domain == NSCocoaErrorDomain && (ns.code == NSFileReadNoSuchFileError || ns.code == NSFileNoSuchFileError)
    }

    private func entries(in folder: URL) throws -> [Entry] {
        let index = folder.appendingPathComponent("photos.json")
        do {
            return try JSONDecoder().decode([Entry].self, from: Data(contentsOf: index))
        } catch where missing(error) {
            return []
        }
    }

    private func write(_ entries: [Entry], in folder: URL) throws {
        let data = try JSONEncoder().encode(entries)
        try data.write(to: folder.appendingPathComponent("photos.json"), options: [.atomic, .completeFileProtection])
    }

    private func prepare(_ folder: URL) throws {
        try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        #if os(iOS)
        var root = base.appendingPathComponent("AthleteProgressPhotos", isDirectory: true)
        var options = URLResourceValues()
        options.isExcludedFromBackup = true
        try root.setResourceValues(options)
        #endif
    }

    var hasLegacy: Bool {
        fm.fileExists(atPath: oldAlbum.appendingPathComponent("photos.json").path)
    }

    func importLegacy() throws {
        guard hasLegacy else { return }
        _ = try entries(in: oldAlbum)
        try prepare(imported.deletingLastPathComponent())
        // On the same volume a rename preserves the protected files, index and
        // identities together. Independent imports are serialized by the plugin.
        try fm.moveItem(at: oldAlbum, to: imported)
    }

    func list() throws -> [Entry] {
        let older = try entries(in: imported).map {
            Entry(id: "imported:" + $0.id, date: $0.date, pose: $0.pose, savedAt: $0.savedAt)
        }
        return try (entries(in: current) + older).sorted { ($0.date, $0.savedAt) < ($1.date, $1.savedAt) }
    }

    private func components(_ id: String) throws -> (URL, String) {
        let legacy = id.hasPrefix("imported:")
        let key = legacy ? String(id.dropFirst("imported:".count)) : id
        guard !key.isEmpty, key.count <= 64,
              key.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.contains($0) || $0 == "-" }) else {
            throw CocoaError(.fileReadInvalidFileName)
        }
        return (legacy ? imported : current, key)
    }

    func read(_ id: String, full: Bool) throws -> Data {
        let (folder, key) = try components(id)
        guard try entries(in: folder).contains(where: { $0.id == key }) else { throw CocoaError(.fileReadNoSuchFile) }
        return try Data(contentsOf: folder.appendingPathComponent(full ? key + ".jpg" : key + "-thumb.jpg"))
    }

    func save(_ entry: Entry, full: Data, thumb: Data) throws {
        let (folder, key) = try components(entry.id)
        guard folder == current else { throw CocoaError(.fileWriteInvalidFileName) }
        var rows = try entries(in: folder)
        guard !rows.contains(where: { $0.id == key }) else { throw CocoaError(.fileWriteFileExists) }
        try prepare(folder)
        let fullURL = folder.appendingPathComponent(key + ".jpg")
        let thumbURL = folder.appendingPathComponent(key + "-thumb.jpg")
        try full.write(to: fullURL, options: [.atomic, .completeFileProtection])
        do {
            try thumb.write(to: thumbURL, options: [.atomic, .completeFileProtection])
            rows.append(entry)
            try write(rows, in: folder)
        } catch {
            try? fm.removeItem(at: fullURL)
            try? fm.removeItem(at: thumbURL)
            throw error
        }
    }

    func remove(_ id: String) throws {
        let (folder, key) = try components(id)
        let rows = try entries(in: folder)
        guard rows.contains(where: { $0.id == key }) else { return }
        // Leave the entry indexed until both files have gone. A partially
        // completed deletion can then be retried with the same identifier.
        for suffix in [".jpg", "-thumb.jpg"] {
            do { try fm.removeItem(at: folder.appendingPathComponent(key + suffix)) }
            catch where missing(error) { continue }
        }
        try write(rows.filter { $0.id != key }, in: folder)
    }
}

#if canImport(Capacitor)
import Capacitor
import LocalAuthentication

@objc(PhotosPlugin)
public class PhotosPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PhotosPlugin"
    public let jsName = "OTPhotos"
    public let pluginMethods: [CAPPluginMethod] = ["albumList", "albumSave", "albumRead", "albumRemove", "importLegacyAlbum"].map {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }

    private static let queue = DispatchQueue(label: "ovt.photos")

    private func album(_ call: CAPPluginCall) -> AthletePhotoAlbum? {
        guard let owner = call.getString("owner").flatMap(UUID.init(uuidString:)),
              let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            call.reject("Open your athlete profile to use progress photos.")
            return nil
        }
        return AthletePhotoAlbum(base: base, owner: owner)
    }

    @objc func albumList(_ call: CAPPluginCall) {
        guard let album = album(call) else { return }
        Self.queue.async {
            do {
                let photos = try album.list().map { ["id": $0.id, "date": $0.date, "pose": $0.pose] }
                call.resolve(["version": 2, "photos": photos, "hasLegacy": album.hasLegacy])
            } catch { call.reject("The photo list couldn’t be read.") }
        }
    }

    @objc func albumSave(_ call: CAPPluginCall) {
        guard let album = album(call) else { return }
        guard let id = call.getString("id"), let date = call.getString("date"),
              date.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression) != nil,
              let pose = call.getString("pose"), ["front", "side", "back"].contains(pose),
              let full = call.getString("full").flatMap({ Data(base64Encoded: $0) }), !full.isEmpty,
              let thumb = call.getString("thumb").flatMap({ Data(base64Encoded: $0) }), !thumb.isEmpty else {
            call.reject("No photo to save.")
            return
        }
        Self.queue.async {
            do {
                try album.save(.init(id: id, date: date, pose: pose, savedAt: ISO8601DateFormatter().string(from: Date())), full: full, thumb: thumb)
                call.resolve(["id": id, "date": date, "pose": pose])
            } catch { call.reject("The photo couldn’t be saved.") }
        }
    }

    @objc func albumRead(_ call: CAPPluginCall) {
        guard let album = album(call) else { return }
        guard let id = call.getString("id") else { call.reject("Select a photo."); return }
        Self.queue.async {
            do {
                let data = try album.read(id, full: call.getString("size") == "full")
                call.resolve(["data": data.base64EncodedString()])
            } catch { call.reject("The photo couldn’t be opened.") }
        }
    }

    @objc func albumRemove(_ call: CAPPluginCall) {
        guard let album = album(call) else { return }
        guard let id = call.getString("id") else { call.reject("Select a photo."); return }
        Self.queue.async {
            do { try album.remove(id); call.resolve() }
            catch { call.reject("The photo couldn’t be removed.") }
        }
    }

    @objc func importLegacyAlbum(_ call: CAPPluginCall) {
        guard let album = album(call) else { return }
        let context = LAContext()
        let reason = "Import this iPhone’s older progress photos into the current 0vertrained athlete profile."
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, _ in
            guard success else { call.reject("Device authentication is required to import photos."); return }
            Self.queue.async {
                do { try album.importLegacy(); call.resolve() }
                catch { call.reject("The older photos couldn’t be imported.") }
            }
        }
    }
}
#endif
