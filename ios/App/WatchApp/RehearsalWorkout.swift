import SwiftUI
import MapKit
import CoreLocation
import HealthKit
import WatchKit

extension RehearsalCourse {
    var run: RunSpec {
        RunSpec(id: id, date: date, name: name, location: "outdoor", activity: "run",
                sessionId: "rehearsal:" + id, blocks: [RunBlock(iterations: 1,
                steps: [RunStep(purpose: "work", goal: RunGoal(kind: "open"))])])
    }
}
private extension RehearsalCourse.Point {
    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lon) }
}

/// GPS is optional. Taking or skipping a checkpoint always requires a tap.
final class RehearsalTracker: NSObject, ObservableObject, CLLocationManagerDelegate {
    static let shared = RehearsalTracker()
    private let location = CLLocationManager()
    private var lastFix: CLLocation?
    @Published private(set) var position: RehearsalCourse.Point?
    @Published private(set) var gps = "Waiting for GPS"
    @Published private(set) var recovering = false
    private var recoveringAttempt: String?

    func start() {
        location.delegate = self
        location.activityType = .fitness
        location.allowsBackgroundLocationUpdates = true
        location.desiredAccuracy = kCLLocationAccuracyBest
        location.distanceFilter = 4
        if location.authorizationStatus == .notDetermined { location.requestWhenInUseAuthorization() }
        updateAuthorization()
    }

    func recoverIfNeeded() {
        let store = SessionStore.shared
        guard let attempt = store.rehearsalAttempt, !CardioWorkoutManager.shared.isActive,
              recoveringAttempt != attempt.id else { return }
        recovering = true
        recoveringAttempt = attempt.id
        HKHealthStore().recoverActiveWorkoutSession { session, error in
            DispatchQueue.main.async {
                guard self.recoveringAttempt == attempt.id, store.rehearsalAttempt?.id == attempt.id else { return }
                self.recovering = false
                if let session, session.state != .ended, !CardioWorkoutManager.shared.isActive,
                   !CardioWorkoutManager.shared.restore(session) { WorkoutManager.closeOrphan(session) }
                if error != nil { self.recoveringAttempt = nil }
                if !CardioWorkoutManager.shared.matchesRehearsal {
                    self.gps = error == nil ? "Health tracking ended. Saved checkpoints are ready." : "Health recovery unavailable. Your checkpoints are saved."
                }
            }
        }
    }

    func stop() {
        location.stopUpdatingLocation()
        location.allowsBackgroundLocationUpdates = false
        location.delegate = nil
        lastFix = nil
        position = nil
        recovering = false
        recoveringAttempt = nil
        gps = "Waiting for GPS"
    }

    private func updateAuthorization() {
        guard SessionStore.shared.rehearsalAttempt != nil else { return }
        switch location.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            gps = "Waiting for GPS"
            location.startUpdatingLocation()
        case .denied, .restricted:
            gps = "GPS off · tap checkpoints manually"
        default: gps = "Waiting for location permission"
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { updateAuthorization() }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        gps = "GPS unavailable · tap checkpoints manually"
        lastFix = nil
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let fix = locations.last, fix.horizontalAccuracy >= 0, fix.horizontalAccuracy <= 50,
              abs(fix.timestamp.timeIntervalSinceNow) < 15, SessionStore.shared.rehearsalAttempt != nil else { return }
        lastFix = fix
        let point = RehearsalCourse.Point(lat: fix.coordinate.latitude, lon: fix.coordinate.longitude)
        position = point
        gps = "GPS ±\(Int(fix.horizontalAccuracy.rounded())) m"
        SessionStore.shared.editRehearsal { attempt in
            attempt.locate(point)
            if attempt.prompt(at: Date(), fix: point) { WKInterfaceDevice.current().play(.notification) }
        }
    }

    func tick() {
        let fresh = lastFix.map { abs($0.timestamp.timeIntervalSinceNow) < 15 } == true ? position : nil
        SessionStore.shared.editRehearsal { attempt in
            if attempt.prompt(at: Date(), fix: fresh) { WKInterfaceDevice.current().play(.notification) }
        }
    }
}

private func lengthLabel(_ meters: Double) -> String {
    "\(Format.number((meters / 1609.344 * 100).rounded() / 100)) mi"
}
private func clockLabel(_ seconds: Double) -> String {
    let s = max(0, Int(seconds))
    return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
}

private struct RehearsalTrace: View {
    let course: RehearsalCourse
    var next: String?
    var position: RehearsalCourse.Point?
    var body: some View {
        Canvas { ctx, size in
            guard let start = course.points.first else { return }
            let points = course.points.map { $0.offset(from: start) }
            let xs = points.map(\.x), ys = points.map(\.y)
            let left = xs.min() ?? 0, right = xs.max() ?? 0, low = ys.min() ?? 0, high = ys.max() ?? 0
            let scale = min((size.width - 20) / max(1, right - left), (size.height - 20) / max(1, high - low))
            func project(_ point: (x: Double, y: Double)) -> CGPoint {
                CGPoint(x: size.width / 2 + (point.x - (left + right) / 2) * scale,
                        y: size.height / 2 - (point.y - (high + low) / 2) * scale)
            }
            var line = Path()
            line.move(to: project(points[0]))
            for point in points.dropFirst() { line.addLine(to: project(point)) }
            ctx.stroke(line, with: .color(Ledger.ink2), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            func dot(_ point: CGPoint, radius: CGFloat, color: Color) {
                ctx.fill(Path(ellipseIn: CGRect(x: point.x - radius, y: point.y - radius, width: 2 * radius, height: 2 * radius)), with: .color(color))
            }
            for cp in course.checkpoints where points.indices.contains(cp.pointIndex) {
                dot(project(points[cp.pointIndex]), radius: cp.id == next ? 5 : 3, color: cp.id == next ? Ledger.earned : Ledger.ink)
            }
            if let position {
                let point = project(position.offset(from: start))
                dot(point, radius: 5, color: .black)
                dot(point, radius: 3.5, color: Ledger.good)
            }
        }
        .frame(height: 92)
        .background(Ledger.surface, in: RoundedRectangle(cornerRadius: 8))
        .accessibilityLabel("Offline course outline with \(course.checkpoints.count) checkpoints")
    }
}

private struct RehearsalMap: View {
    let course: RehearsalCourse
    var position: RehearsalCourse.Point?
    var body: some View {
        Map {
            MapPolyline(coordinates: course.points.map(\.coordinate)).stroke(Ledger.earned, lineWidth: 3)
            ForEach(course.checkpoints) { cp in
                Marker(cp.name, coordinate: course.points[cp.pointIndex].coordinate)
            }
            if let position { Marker("You", systemImage: "location.fill", coordinate: position.coordinate).tint(.blue) }
        }.navigationTitle("Course map")
    }
}

struct RehearsalPreview: View {
    let course: RehearsalCourse
    @ObservedObject private var cardio = CardioWorkoutManager.shared
    @EnvironmentObject private var store: SessionStore
    @EnvironmentObject private var workout: WorkoutManager
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text(course.name).font(.headline)
                Text("\(lengthLabel(course.distanceMeters)) · \(course.checkpoints.count) checkpoints").font(.footnote)
                RehearsalTrace(course: course, next: course.checkpoints.first?.id)
                NavigationLink("Course map") { RehearsalMap(course: course) }
                Button("Start rehearsal") { cardio.start(course.run, rehearsal: course) }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(workout.phase != .idle || store.activeLift != nil || cardio.isActive || store.athleteOwner == nil)
                if workout.phase != .idle || store.activeLift != nil { Text("End your lift to start.").font(.footnote) }
                if let problem = cardio.problem { Text(problem).font(.footnote) }
                ForEach(course.checkpoints) { cp in
                    Text("\(cp.name) · \(lengthLabel(cp.meters))").font(.caption)
                }
            }
        }.navigationTitle("Rehearsal")
    }
}

struct RehearsalWorkoutView: View {
    let attempt: RehearsalAttempt
    @EnvironmentObject private var store: SessionStore
    @ObservedObject private var tracker = RehearsalTracker.shared
    @ObservedObject private var cardio = CardioWorkoutManager.shared
    @State private var confirmFinish = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack { Text(attempt.start, style: .timer).monospacedDigit(); Spacer(); Text(lengthLabel(attempt.distanceMeters)) }
                RehearsalTrace(course: attempt.course, next: attempt.next?.id, position: tracker.position)
                if attempt.atStop, let mark = attempt.marks.last {
                    Text("At \(mark.name)").font(.headline)
                    Text("Arrival \(clockLabel(Double(mark.elapsedSeconds)))").font(.caption)
                    Button("Leave stop") { store.editRehearsal { $0.depart(at: Date()) } }.buttonStyle(PrimaryButtonStyle())
                } else if let cp = attempt.next {
                    Text(cp.name).font(.headline)
                    Text("\(cp.kind.capitalized) · \(lengthLabel(cp.meters))").font(.footnote)
                    if let target = cp.targetSeconds { Text("Target \(clockLabel(target))").font(.caption) }
                    if let note = cp.instruction, !note.isEmpty { Text(note).font(.footnote) }
                    Button(cp.kind == "finish" ? "Mark finish & save" : cp.isStop ? "Arrived" : "Mark reached") {
                        store.editRehearsal { $0.mark(taken: true, at: Date()) }
                        WKInterfaceDevice.current().play(.success)
                        if cp.kind == "finish" { finish() }
                    }.buttonStyle(PrimaryButtonStyle()).disabled(tracker.recovering)
                    Button("Skip checkpoint") { store.editRehearsal { $0.mark(taken: false, at: Date()) } }
                } else { Text("Checkpoints complete").foregroundStyle(Ledger.good) }
                Text(tracker.gps).font(.caption2)
                NavigationLink("Course map") { RehearsalMap(course: attempt.course, position: tracker.position) }
                Button("Finish rehearsal") { confirmFinish = true }.disabled(tracker.recovering || cardio.finishing)
            }
        }
        .onAppear { tracker.recoverIfNeeded() }
        .navigationTitle("Rehearsal")
        .confirmationDialog("Finish and save this rehearsal?", isPresented: $confirmFinish) {
            Button("Finish rehearsal", action: finish)
        }
    }

    private func finish() {
        if cardio.matchesRehearsal { cardio.finish() }
        else { store.finishRehearsal(at: Date()); tracker.stop() }
    }
}
