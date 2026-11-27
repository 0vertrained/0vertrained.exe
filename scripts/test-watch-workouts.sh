#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
swiftc ios/App/WatchApp/Plan.swift ios/App/WatchApp/LiftJournal.swift ios/App/App/WatchInbox.swift ios/Tests/WatchJournalTests.swift -o "$out/journal"
"$out/journal"
swiftc ios/App/WatchApp/RepMotionDetector.swift ios/Tests/RepMotionTests.swift -o "$out/reps"
"$out/reps"
swiftc ios/App/WatchApp/Plan.swift ios/App/WatchApp/GymSession.swift ios/Tests/WatchGymTests.swift -o "$out/gym"
"$out/gym"
swiftc ios/App/Shared/RunWorkout.swift ios/Tests/WatchCardioTests.swift -o "$out/cardio"
"$out/cardio"
