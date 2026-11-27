import Foundation

/// Exact movements for which the watch has a counting strategy. The raw
/// values also identify saved calibration; aliases share that one profile.
enum RepMotionExercise: String, CaseIterable, Codable {
    case curl = "Dumbbell Curl"
    case alternatingCurl = "Alternating Dumbbell Curl"
    case hammerCurl = "Hammer Curl"
    case inclineCurl = "Incline DB Curl"
    case ezBarCurl = "EZ Bar Curl"
    case cableCurl = "Cable Curl"
    case preacherCurl = "Preacher Curl"
    case machinePreacherCurl = "Machine Preacher Curl"
    case lateralRaise = "Lateral Raise"
    case cableLateralRaise = "Cable Lateral Raise"
    case cableYRaise = "Cable Y-Raise"
    case rearDeltFly = "Rear Delt Fly"
    case dumbbellFly = "DB Fly"
    case straightArmPulldown = "Straight-Arm Pulldown"
    case tricepsPushdown = "Triceps Pushdown"
    case ropePushdown = "Rope Pushdown"
    case straightBarPushdown = "Straight-Bar Pushdown"
    case skullCrusher = "Skull Crusher"
    case ezBarSkullCrusher = "EZ Bar Skull Crushers"
    case dumbbellSkullCrusher = "DB Skullcrusher"
    case overheadDumbbellExtension = "Overhead Triceps Extension"
    case overheadCableExtension = "Overhead Cable Triceps Extension"

    case backSquat = "Back Squat"
    case frontSquat = "Front Squat"
    case gobletSquat = "Goblet Squat"
    case benchPress = "Barbell Bench Press"
    case dumbbellBenchPress = "Dumbbell Bench Press"
    case floorPress = "DB Floor Press"
    case overheadPress = "Overhead Press"
    case standingDumbbellPress = "Standing DB Press"
    case seatedDumbbellPress = "Seated DB Press"

    var displayName: String { rawValue }

    init?(name: String) {
        guard let match = Self.byName[Self.normalize(name)] else { return nil }
        self = match
    }

    /// Only these bilateral lifts use vertical acceleration. The sign is the
    /// direction of travel on the first half of a rep from its given start.
    var verticalStart: Int? {
        switch self {
        case .backSquat, .frontSquat, .gobletSquat, .benchPress, .dumbbellBenchPress, .floorPress: return -1
        case .overheadPress, .standingDumbbellPress, .seatedDumbbellPress: return 1
        default: return nil
        }
    }

    /// Angle from the still starting pose for the gravity-arc detector.
    var riseAngle: Double {
        switch self {
        case .curl, .alternatingCurl, .hammerCurl, .inclineCurl, .ezBarCurl, .cableCurl: return 55
        case .preacherCurl, .machinePreacherCurl: return 48
        case .lateralRaise, .cableLateralRaise, .rearDeltFly: return 43
        case .cableYRaise, .dumbbellFly: return 45
        default: return 50
        }
    }

    var startCue: String {
        switch self {
        case .curl, .inclineCurl, .hammerCurl, .ezBarCurl, .cableCurl:
            return "Hold still with your watch arm lowered in the starting position."
        case .alternatingCurl:
            return "Hold both arms lowered. Count only reps by the arm wearing the watch."
        case .preacherCurl, .machinePreacherCurl:
            return "Rest your upper arms on the pad and hold the lowered position still."
        case .lateralRaise, .cableLateralRaise, .cableYRaise:
            return "Hold your watch arm still at the bottom of the raise."
        case .rearDeltFly:
            return "Set up for the fly and hold still with both arms hanging down."
        case .dumbbellFly, .dumbbellSkullCrusher, .skullCrusher, .ezBarSkullCrusher:
            return "Lie on the bench and hold your arms steady above your chest."
        case .straightArmPulldown:
            return "Hold the cable still in the arms-forward starting position."
        case .tricepsPushdown, .ropePushdown, .straightBarPushdown:
            return "Stand with elbows by your sides. Hold the bent-elbow starting position still."
        case .overheadDumbbellExtension, .overheadCableExtension:
            return "Set up for the extension and hold your arms steady in the extended overhead position."
        case .backSquat, .frontSquat, .gobletSquat:
            return "Stand still with the weight in position. Start each rep by squatting down."
        case .benchPress, .dumbbellBenchPress, .floorPress:
            return "Hold the weight steady above your chest with both arms extended. Lower it first."
        case .overheadPress, .standingDumbbellPress, .seatedDumbbellPress:
            return "Hold the weight steady at shoulder height. Press up with both arms."
        }
    }

    private static let byName: [String: Self] = {
        var matches = Dictionary(uniqueKeysWithValues: allCases.map { (normalize($0.rawValue), $0) })
        let aliases: [(Self, [String])] = [
            (.alternatingCurl, ["DB Alternating Curl", "Alternating DB Biceps Curl"]),
            (.hammerCurl, ["Dumbbell Hammer Curl"]),
            (.lateralRaise, ["Dumbbell Lateral Raise"]),
            (.ezBarCurl, ["EZ Curl"]),
            (.rearDeltFly, ["Bent-Over DB Reverse Fly", "DB Rear Delt Fly"]),
            (.tricepsPushdown, ["Cable Triceps Pushdown", "Cable Pushdown (Any Handle)"]),
            (.ropePushdown, ["Rope Triceps Pushdown"]),
            (.overheadDumbbellExtension, ["Overhead DB Triceps Extension", "DB Overhead Triceps Extension"]),
            (.overheadCableExtension, ["Overhead Cable Extension", "Cable Overhead Triceps Extension"]),
            (.backSquat, ["Barbell Back Squat"]),
            (.frontSquat, ["Barbell Front Squat"]),
            (.benchPress, ["Bench Press"]),
            (.overheadPress, ["Barbell Overhead Press", "Standing Overhead Press"]),
            (.standingDumbbellPress, ["Standing DB Shoulder Press"]),
            (.seatedDumbbellPress, ["Seated DB Shoulder Press"])
        ]
        for (exercise, names) in aliases {
            for name in names { matches[normalize(name)] = exercise }
        }
        return matches
    }()

    private static func normalize(_ name: String) -> String {
        let words = name.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted)
        return words.filter { !$0.isEmpty }.map { word in
            switch word {
            case "db": return "dumbbell"
            case "curls": return "curl"
            case "raises": return "raise"
            case "tricep": return "triceps"
            case "crushers": return "crusher"
            case "skullcrusher", "skullcrushers": return "skull crusher"
            default: return word
            }
        }.joined(separator: " ")
    }
}
