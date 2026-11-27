import Foundation

@main
struct RepCalibrationStoreTests {
    static func main() {
        let suite = "rep-learning-fixture-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = RepCalibrationStore(defaults: defaults)
        let id = RepMotionExercise.curl.rawValue
        let other = RepMotionExercise.hammerCurl.rawValue
        let date = Date()
        let repeated = RepMotionEvidence(exercise: .curl, counts: [10,10,8,7,6], detected: 8, uninterrupted: true)
        var profile = store.profile(owner: "athleteA", exerciseID: id)
        precondition(!store.isLearningEnabled(owner: nil, exerciseID: id))
        for i in 1...3 { precondition(profile.review(repeated, confirmed: 10, setID: "set-\(i)", on: date)) }
        store.save(profile, owner: "athleteA", exerciseID: id)
        store.save(profile, owner: "athleteA", exerciseID: other)
        let reopened = RepCalibrationStore(defaults: UserDefaults(suiteName: suite)!)
        precondition(reopened.profile(owner: "athleteA", exerciseID: id).setting(asOf: date) < 0)
        precondition(reopened.profile(owner: "athleteB", exerciseID: id).reviewCount() == 0)
        precondition(reopened.profile(owner: "athleteA", exerciseID: other).reviewCount() == 0)
        store.undo(setID: "set-1", owner: "athleteA", exerciseName: "DB Curl")
        let afterUndo = reopened.profile(owner: "athleteA", exerciseID: id)
        precondition(afterUndo.reviewCount() == 2 && afterUndo.setting() == 0)
        store.setLearningEnabled(false, owner: "athleteA", exerciseID: id)
        store.reset(owner: "athleteA", exerciseID: id)
        precondition(reopened.profile(owner: "athleteA", exerciseID: id).reviewCount() == 0)
        precondition(!reopened.isLearningEnabled(owner: "athleteA", exerciseID: id))
        precondition(reopened.isLearningEnabled(owner: "athleteB", exerciseID: id))
        print("Watch learning persists per athlete and movement; undo and reset passed")
    }
}
