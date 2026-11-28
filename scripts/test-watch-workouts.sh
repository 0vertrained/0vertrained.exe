#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
swiftc ios/App/Shared/RehearsalCourse.swift ios/App/WatchApp/Plan.swift ios/App/WatchApp/LiftJournal.swift ios/App/App/WatchInbox.swift ios/Tests/WatchJournalTests.swift -o "$out/journal"
"$out/journal"
catalog=ios/App/WatchApp/RepExerciseCatalog.swift
profile=ios/App/WatchApp/RepCalibration.swift
store=ios/App/WatchApp/RepCalibrationStore.swift
vertical=ios/App/WatchApp/VerticalRepTracker.swift
swiftc "$catalog" "$profile" "$vertical" ios/App/WatchApp/RepMotionDetector.swift ios/Tests/RepMotionTests.swift -o "$out/reps"
"$out/reps"
swiftc "$catalog" ios/Tests/RepExerciseCatalogTests.swift -o "$out/catalog"
"$out/catalog"
swiftc "$vertical" ios/Tests/VerticalRepTests.swift -o "$out/vertical"
"$out/vertical"
swiftc "$catalog" "$profile" "$store" ios/Tests/RepCalibrationStoreTests.swift -o "$out/calibration-store"
"$out/calibration-store"
swiftc "$catalog" "$profile" "$store" ios/App/Shared/RehearsalCourse.swift ios/App/WatchApp/Plan.swift ios/App/WatchApp/GymSession.swift ios/Tests/WatchGymTests.swift -o "$out/gym"
"$out/gym"
swiftc ios/App/Shared/RunWorkout.swift ios/Tests/WatchCardioTests.swift -o "$out/cardio"
"$out/cardio"
swiftc ios/App/Shared/LiftMirrorProtocol.swift ios/Tests/LiftMirrorTests.swift -o "$out/mirror"
"$out/mirror"

swiftc ios/App/Shared/RehearsalCourse.swift ios/Tests/RehearsalCourseTests.swift -o "$out/rehearsal"
"$out/rehearsal"

swiftc ios/App/App/ClimbProtocol.swift ios/Tests/ClimbProtocolTests.swift -o "$out/climb-protocol"
"$out/climb-protocol"

swiftc ios/App/App/ClimbTreadmill.swift ios/Tests/ClimbDiscoveryTests.swift -o "$out/climb-discovery"
"$out/climb-discovery"
