import Foundation
import Capacitor

/// Progress photos, kept on this iPhone only: in the app's own folder,
/// protected while the phone is locked, never uploaded. The page picks and
/// shrinks each photo and sends a full and a thumbnail JPEG
/// (src/photos/progressPhotos.js); this keeps the files and their list.
@objc(PhotosPlugin)
public class PhotosPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PhotosPlugin"
    public let jsName = "OTPhotos"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    private struct Entry: Codable {
        var id: String
        var date: String
        var pose: String
        var savedAt: String
    }

    /// One file change at a time.
    private static let queue = DispatchQueue(label: "ovt.photos")
    private static let poses: Set<String> = ["front", "side", "back"]

    private var folder: URL? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let folder = base.appendingPathComponent("ProgressPhotos", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    /// Resolves { photos: [{ id, date, pose }] }, oldest first.
    @objc func list(_ call: CAPPluginCall) {
        Self.queue.async {
            let photos: [[String: Any]] = self.readIndex()
                .sorted { ($0.date, $0.savedAt) < ($1.date, $1.savedAt) }
                .map { ["id": $0.id, "date": $0.date, "pose": $0.pose] }
            call.resolve(["photos": photos])
        }
    }

    /// id, date ("2026-11-26"), pose (front, side or back), and full and
    /// thumb as base64 JPEG. Resolves { id, date, pose }.
    @objc func save(_ call: CAPPluginCall) {
        guard let id = Self.cleanId(call.getString("id")),
              let date = call.getString("date"), Self.isDay(date),
              let full = call.getString("full").flatMap({ Data(base64Encoded: $0) }),
              let thumb = call.getString("thumb").flatMap({ Data(base64Encoded: $0) }),
              let folder else {
            call.reject("No photo to save.")
            return
        }
        let pose = Self.poses.contains(call.getString("pose") ?? "") ? (call.getString("pose") ?? "front") : "front"
        Self.queue.async {
            do {
                try full.write(to: folder.appendingPathComponent("\(id).jpg"), options: [.atomic, .completeFileProtection])
                try thumb.write(to: folder.appendingPathComponent("\(id)-thumb.jpg"), options: [.atomic, .completeFileProtection])
                var entries = self.readIndex().filter { $0.id != id }
                entries.append(Entry(id: id, date: date, pose: pose, savedAt: ISO8601DateFormatter().string(from: Date())))
                try self.writeIndex(entries)
                call.resolve(["id": id, "date": date, "pose": pose])
            } catch {
                call.reject("The photo couldn't be saved.")
            }
        }
    }

    /// id and size ("thumb" or "full"). Resolves { data } as base64 JPEG.
    @objc func read(_ call: CAPPluginCall) {
        guard let id = Self.cleanId(call.getString("id")), let folder else {
            call.reject("No photo to read.")
            return
        }
        let name = call.getString("size") == "full" ? "\(id).jpg" : "\(id)-thumb.jpg"
        Self.queue.async {
            guard let data = try? Data(contentsOf: folder.appendingPathComponent(name)) else {
                call.reject("That photo isn't on this iPhone.")
                return
            }
            call.resolve(["data": data.base64EncodedString()])
        }
    }

    /// id. Deletes the photo and its thumbnail.
    @objc func remove(_ call: CAPPluginCall) {
        guard let id = Self.cleanId(call.getString("id")), let folder else {
            call.reject("No photo to remove.")
            return
        }
        Self.queue.async {
            try? FileManager.default.removeItem(at: folder.appendingPathComponent("\(id).jpg"))
            try? FileManager.default.removeItem(at: folder.appendingPathComponent("\(id)-thumb.jpg"))
            do {
                try self.writeIndex(self.readIndex().filter { $0.id != id })
                call.resolve()
            } catch {
                call.reject("The photo couldn't be removed.")
            }
        }
    }

    // MARK: - The list

    private var indexURL: URL? {
        folder?.appendingPathComponent("photos.json")
    }

    private func readIndex() -> [Entry] {
        guard let url = indexURL, let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([Entry].self, from: data)) ?? []
    }

    private func writeIndex(_ entries: [Entry]) throws {
        guard let url = indexURL else { return }
        let data = try JSONEncoder().encode(entries)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
    }

    /// Letters, digits and dashes only, so an id can't reach outside the folder.
    private static func cleanId(_ value: String?) -> String? {
        guard let value, !value.isEmpty, value.count <= 64 else { return nil }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-"))
        return value.unicodeScalars.allSatisfy { allowed.contains($0) } ? value : nil
    }

    private static func isDay(_ value: String) -> Bool {
        value.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression) != nil
    }
}
