import Foundation

@main
struct RepExerciseCatalogTests {
    static func main() {
        func match(_ input: String) -> RepMotionExercise? { RepMotionExercise(name: input) }
        for exercise in RepMotionExercise.allCases {
            precondition(match(exercise.displayName) == exercise, "Catalog name must reopen the same calibration")
            precondition(!exercise.startCue.isEmpty)
            if exercise.verticalStart == nil { precondition((30...90).contains(exercise.riseAngle)) }
        }

        let synonyms: [(String, RepMotionExercise)] = [
            ("  DB CURL  ", .curl), ("Hammer Curls", .hammerCurl), ("Incline Dumbbell Curl", .inclineCurl),
            ("DB alternating curl", .alternatingCurl), ("DB Lateral Raise", .lateralRaise),
            ("Cable Lateral Raises", .cableLateralRaise), ("EZ-Bar Curl", .ezBarCurl),
            ("Dumbbell Fly", .dumbbellFly), ("Overhead DB Tricep Extension", .overheadDumbbellExtension),
            ("Overhead Cable Extension", .overheadCableExtension), ("Skullcrusher", .skullCrusher),
            ("Rope Tricep Pushdown", .ropePushdown), ("DB skullcrusher", .dumbbellSkullCrusher),
            ("bench press", .benchPress), ("Seated DB Shoulder Press", .seatedDumbbellPress)
        ]
        for (input, expected) in synonyms { precondition(match(input) == expected, input) }

        let downFirst: Set<RepMotionExercise> = [.backSquat, .frontSquat, .gobletSquat, .benchPress, .dumbbellBenchPress, .floorPress]
        let upFirst: Set<RepMotionExercise> = [.overheadPress, .seatedDumbbellPress, .standingDumbbellPress]
        precondition(Set(RepMotionExercise.allCases.filter { $0.verticalStart == -1 }) == downFirst)
        precondition(Set(RepMotionExercise.allCases.filter { $0.verticalStart == 1 }) == upFirst)
        for name in ["Leg Press", "Lying Leg Curl", "Push-Up", "Assisted Pull-Up", "Machine Lateral Raise",
                     "Pec Deck / Cable Fly", "Cable Fly", "Reverse Pec Deck", "Pallof Press", "Single-Arm DB Press"] {
            precondition(match(name) == nil, "Incorrect counting strategy for " + name)
        }
        precondition(match("Preacher Curl") != match("Machine Preacher Curl"))
        precondition(match("DB Fly") != match("Rear Delt Fly"))
        precondition(match("Triceps Pushdown") != match("Rope Tricep Pushdown"))
        precondition(match("Barbell Bench Press") != match("DB Bench Press"))
        print("Watch rep exercise catalog fixtures passed (\(RepMotionExercise.allCases.count) movements)")
    }
}
