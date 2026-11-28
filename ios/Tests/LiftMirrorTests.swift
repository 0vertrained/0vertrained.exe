import Foundation

@main
struct LiftMirrorTests {
    static func main() {
        let cursor = LiftMirrorCursor(owner: "athlete-a", workoutID: "evening", revision: "edit-a",
                                      section: "main", exercise: "Press", index: 1, lastSetID: "set-a")
        let weight = LiftMirrorField(prop: "weight", label: "Weight", unit: "lb", max: 1200, step: 2.5, required: false)
        let reps = LiftMirrorField(prop: "reps", label: "Reps", unit: "reps", max: 100, step: 1, required: true)
        var state = LiftMirrorSnapshot(cursor: cursor, title: "Strength", display: "Press", total: 3, fields: [weight, reps],
                                       values: ["reps": 5, "weight": 135], startedAt: 0)
        var command = LiftMirrorCommand(id: UUID(), cursor: cursor, action: .logSet, observedAt: state.sampledAt, values: ["weight": 132.5, "reps": 7])
        let packet = LiftMirrorPacket(kind: .command, command: command)
        precondition(LiftMirrorPacket.decode(packet.encode()!)?.command?.valid(for: state) == true)
        precondition(LiftMirrorPacket.decode(Data(repeating: 0, count: 16_385)) == nil)
        state.sampledAt += 16
        precondition(!command.valid(for: state))
        state.sampledAt = command.observedAt
        command.cursor.owner = "athlete-b"
        precondition(!command.valid(for: state))
        command.cursor = cursor
        command.cursor.workoutID = "morning"
        precondition(!command.valid(for: state))
        command.cursor = cursor
        state.cursor.index = 2
        precondition(!command.valid(for: state))
        state.cursor = cursor
        state.cursor.revision = "after-log-and-undo"
        precondition(!command.valid(for: state)) // Original slot reopened, delayed command stays spent.
        state.cursor = cursor
        for invalid in [["reps": 1.5], ["reps": 0], ["reps": 101], ["reps": 8, "weight": -1],
                        ["weight": 100], ["reps": 8, "rir": 4]] {
            command.values = invalid
            precondition(!command.valid(for: state))
        }
        command.values = ["reps": 8]
        command.action = .setTarget
        precondition(command.valid(for: state))
        state.liveReps = 0
        precondition(!command.valid(for: state))
        state.liveReps = nil
        command.action = .undo
        precondition(command.valid(for: state))
        state.cursor.lastSetID = "replacement"
        precondition(!command.valid(for: state))
        state.cursor = cursor
        state.cardio = CardioMirrorSnapshot(activity: "run", kind: "rehearsal", name: "Hill loop", distanceMeters: 850,
            checkpointName: "Water", checkpointMeters: 1000, checkpointTargetSeconds: 350,
            checkpointInstruction: "Refill", atStation: false)
        let cardioPacket = LiftMirrorPacket(kind: .state, state: state)
        precondition(LiftMirrorPacket.decode(cardioPacket.encode()!)?.state?.cardio?.checkpointName == "Water")
        for action in [LiftMirrorCommand.Action.logSet, .setTarget, .undo] {
            command.action = action
            precondition(!command.valid(for: state))
        }
        print("Lift mirror protocol, account isolation, set validation and replay checks passed")
    }
}
