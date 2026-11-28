import Foundation
import SwiftUI
import WatchKit

/// Only a tap on this Watch starts a Health workout. Live prompts expire on
/// disconnect and are scoped to the signed-in athlete and physical recording.
final class ClimbWrist: ObservableObject {
    static let shared = ClimbWrist()
    struct Invite {
        let owner: String, recording: String, name: String, date: String
        let expires: Date
    }
    struct Cue {
        let recording: String, landmark: String
        let remaining: Double, grade: Double?, gap: Double?
        let received: Date
    }
    @Published var invite: Invite?
    @Published private(set) var cue: Cue?
    private var lastTap = Date.distantPast

    func receive(_ message: [String: Any], now: Date = Date()) -> Bool {
        guard let owner = message["owner"] as? String, !owner.isEmpty, owner == SessionStore.shared.athleteOwner,
              let id = message["recordingId"] as? String, UUID(uuidString: id) != nil,
              let stamp = message["issuedAt"] as? Double, abs(now.timeIntervalSince1970 - stamp) < 20 else { return false }
        let manager = CardioWorkoutManager.shared
        switch message["climbAction"] as? String {
        case "invite":
            if manager.record?.workoutID == id { return true }
            guard !manager.isActive, !WorkoutManager.shared.blocksCardioStart, SessionStore.shared.activeLift == nil,
                  SessionStore.shared.rehearsalAttempt == nil, let name = message["name"] as? String, !name.isEmpty,
                  let date = message["date"] as? String, date.count == 10 else { return false }
            if invite?.recording != id { WKInterfaceDevice.current().play(.notification) }
            invite = Invite(owner: owner, recording: id, name: String(name.prefix(120)), date: date, expires: now.addingTimeInterval(120))
            return true
        case "cue":
            guard manager.record?.owner == owner, manager.record?.workoutID == id,
                  let remaining = message["remaining"] as? Double, remaining.isFinite && remaining >= 0 else { return false }
            let landmark = String(((message["landmark"] as? String) ?? "").prefix(120))
            let grade = (message["grade"] as? Double).flatMap { $0.isFinite ? $0 : nil }
            let gap = (message["gap"] as? Double).flatMap { $0.isFinite ? $0 : nil }
            if let old = cue, old.recording == id, now.timeIntervalSince(lastTap) > 25,
               old.landmark != landmark || abs((old.grade ?? 0) - (grade ?? 0)) >= 3 {
                WKInterfaceDevice.current().play(.click)
                lastTap = now
            }
            cue = Cue(recording: id, landmark: landmark, remaining: remaining, grade: grade, gap: gap, received: now)
            return true
        case "close":
            if invite?.recording == id { invite = nil }
            if manager.record?.workoutID == id && manager.record?.owner == owner { manager.finish() }
            return true
        default: return false
        }
    }

    func start() {
        guard let prompt = invite, prompt.expires > Date(), prompt.owner == SessionStore.shared.athleteOwner else { invite = nil; return }
        let spec = RunSpec(id: prompt.recording, date: prompt.date, name: prompt.name, location: "indoor", activity: "run",
            sessionId: "climb:" + prompt.recording, blocks: [RunBlock(iterations: 1, steps: [RunStep(purpose: "work", goal: RunGoal(kind: "open"))])])
        CardioWorkoutManager.shared.start(spec)
    }
}

struct ClimbWristInvite: View {
    let invite: ClimbWrist.Invite
    @ObservedObject private var manager = CardioWorkoutManager.shared
    var body: some View {
        TimelineView(.periodic(from: .now, by: 2)) { context in
            List {
                Text(invite.name).font(.headline)
                if context.date < invite.expires {
                    Text("Record this indoor run with your Watch. Your iPhone shows the course.").font(.footnote)
                    Button("Record indoor run") { ClimbWrist.shared.start() }.disabled(manager.starting)
                } else { Text("Open the climb on your iPhone and connect again.").font(.footnote) }
                if let problem = manager.problem { Text(problem).font(.footnote) }
                Button("Dismiss") { ClimbWrist.shared.invite = nil }
            }
        }.navigationTitle("Race the Climb")
    }
}

struct ClimbWristMetrics: View {
    let recording: String
    @ObservedObject private var link = ClimbWrist.shared
    var body: some View {
        TimelineView(.periodic(from: .now, by: 3)) { context in
            if let cue = link.cue, cue.recording == recording, context.date.timeIntervalSince(cue.received) < 15 {
                VStack {
                    Text(String(format: "%.2f km to finish", cue.remaining / 1000)).monospacedDigit()
                    if let grade = cue.grade { Text(String(format: "Course grade %.1f%%", grade)).font(.footnote) }
                    if !cue.landmark.isEmpty { Text("Next · " + cue.landmark).font(.footnote) }
                    if let gap = cue.gap { Text(abs(gap) < 0.5 ? "Even with reference" : "\(Int(abs(gap).rounded())) s \(gap > 0 ? "ahead" : "behind")").font(.footnote) }
                }
            } else { Text("Recording on Watch · waiting for course updates").font(.footnote) }
        }
    }
}
