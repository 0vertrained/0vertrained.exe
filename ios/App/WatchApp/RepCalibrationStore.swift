import Foundation

/// Learning stays on this Watch. Profiles are separated by signed-in athlete
/// and the canonical performed lift, including when an exercise is swapped.
struct RepCalibrationStore {
    let defaults: UserDefaults

    private func key(owner: String?, exerciseID: String) -> String? {
        guard let owner, !owner.isEmpty, RepMotionExercise(rawValue: exerciseID) != nil else { return nil }
        return "repCalibration.v1." + String(owner.utf8.count) + "." + owner + "." + exerciseID
    }

    func profile(owner: String?, exerciseID: String) -> RepCalibrationProfile {
        guard let key = key(owner: owner, exerciseID: exerciseID), let data = defaults.data(forKey: key),
              let profile = try? JSONDecoder().decode(RepCalibrationProfile.self, from: data),
              profile.exercise?.rawValue == exerciseID else { return .init() }
        return profile
    }

    func save(_ profile: RepCalibrationProfile, owner: String?, exerciseID: String) {
        guard let key = key(owner: owner, exerciseID: exerciseID),
              profile.exercise?.rawValue == exerciseID, let data = try? JSONEncoder().encode(profile) else { return }
        defaults.set(data, forKey: key)
    }

    func isLearningEnabled(owner: String?, exerciseID: String) -> Bool {
        guard let key = key(owner: owner, exerciseID: exerciseID) else { return false }
        return defaults.object(forKey: key + ".enabled") as? Bool ?? true
    }

    func setLearningEnabled(_ enabled: Bool, owner: String?, exerciseID: String) {
        guard let key = key(owner: owner, exerciseID: exerciseID) else { return }
        defaults.set(enabled, forKey: key + ".enabled")
    }

    func reset(owner: String?, exerciseID: String) {
        guard let key = key(owner: owner, exerciseID: exerciseID) else { return }
        defaults.removeObject(forKey: key)
    }

    func undo(setID: String, owner: String?, exerciseName: String) {
        guard let id = RepMotionExercise(name: exerciseName)?.rawValue,
              let key = key(owner: owner, exerciseID: id), defaults.data(forKey: key) != nil else { return }
        var saved = profile(owner: owner, exerciseID: id)
        saved.remove(setID: setID)
        save(saved, owner: owner, exerciseID: id)
    }
}
