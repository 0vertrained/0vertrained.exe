import Foundation

@main enum PhotoAlbumTests {
    static func main() throws {
        let fm = FileManager.default
        let base = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? fm.removeItem(at: base) }
        try fm.createDirectory(at: base, withIntermediateDirectories: true)
        let owner = UUID(), otherOwner = UUID()
        let album = AthletePhotoAlbum(base: base, owner: owner)
        let other = AthletePhotoAlbum(base: base, owner: otherOwner)
        let entry = AthletePhotoAlbum.Entry(id: "front-01", date: "2026-11-27", pose: "front", savedAt: "2026-11-27")
        func require(_ value: Bool, _ message: String) {
            precondition(value, message)
        }
        func fails(_ message: String, _ operation: () throws -> Void) {
            do { try operation(); preconditionFailure(message) } catch { }
        }

        try album.save(entry, full: Data([1]), thumb: Data([2]))
        require(try other.list().isEmpty, "A second athlete saw the first album")
        fails("A second athlete opened the first photo") { _ = try other.read(entry.id, full: true) }
        try other.remove(entry.id)
        require(try album.read(entry.id, full: true) == Data([1]), "Removing a photo affected a different album")
        try other.save(entry, full: Data([8]), thumb: Data([9]))
        require(try other.read(entry.id, full: false) == Data([9]), "Owner keys collided")

        let old = base.appendingPathComponent("ProgressPhotos")
        try fm.createDirectory(at: old, withIntermediateDirectories: true)
        try JSONEncoder().encode([entry]).write(to: old.appendingPathComponent("photos.json"))
        try Data([11]).write(to: old.appendingPathComponent(entry.id + ".jpg"))
        require(album.hasLegacy, "Original album was not preserved")
        require(try album.list().count == 1, "Legacy entries became visible without import")
        fails("Legacy data was readable without import") { _ = try album.read("imported:" + entry.id, full: true) }
        try album.importLegacy()
        require(!other.hasLegacy, "Legacy import was not exclusive")
        require(try Set(album.list().map(\.id)) == [entry.id, "imported:" + entry.id], "Import overwrote a matching current ID")
        require(try album.read("imported:" + entry.id, full: true) == Data([11]), "Wrong original image")
        try other.importLegacy()
        require(try other.list().count == 1, "Legacy photos moved twice")

        // A thumbnail already deleted in a prior interrupted attempt is safe to retry.
        try album.remove("imported:" + entry.id)
        require(try album.list().count == 1, "Incomplete deletion could not finish")
        let current = base.appendingPathComponent("AthleteProgressPhotos/\(owner.uuidString)/Current")
        let index = current.appendingPathComponent("photos.json")
        // Unprivileged devices cannot unlink files while their directory is
        // read-only. The gallery must retain the entry so the user can retry.
        if getuid() != 0 {
            try fm.setAttributes([.posixPermissions: 0o555], ofItemAtPath: current.path)
            fails("An unlink failure was reported as a successful deletion") { try album.remove(entry.id) }
            try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: current.path)
            require(try album.list().count == 1, "The failed deletion orphaned both images")
        }
        try Data("bad index".utf8).write(to: index)
        fails("Damaged index became an empty gallery") { _ = try album.list() }
        fails("Deleting on a damaged index erased data") { try album.remove(entry.id) }
        fails("Saving on a damaged index replaced it") { try album.save(entry, full: Data([4]), thumb: Data([4])) }
        require(try Data(contentsOf: index) == Data("bad index".utf8), "A damaged album was overwritten")
        require(try Data(contentsOf: current.appendingPathComponent(entry.id + ".jpg")) == Data([1]), "Photo lost on failed delete")
        print("Athlete photo album isolation, legacy import, delete retry and damaged-index fixtures passed.")
    }
}
