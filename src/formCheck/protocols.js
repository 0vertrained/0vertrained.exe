// Form Check movement protocols.
//
// Pure data + lookup helpers describing how to film a movement for local form
// analysis. No I/O, no React — safe to unit test and import anywhere.

export const DEFAULT_MOVEMENT = "squat-side-view";

const PROTOCOLS = [
  {
    key: "squat-side-view",
    label: "Squat — Side View",
    movement: "squat",
    view: "side",
    repsGuidance: "Record 2–5 controlled reps.",
    cameraSetup: [
      "Place your phone on the floor or a low tripod, lens roughly hip height.",
      "Stand so the camera sees you fully from the side (90° profile).",
      "Step back until your whole body — head to feet — stays in frame the entire rep.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film in a bright, evenly lit space so your joints are clearly visible.",
      "Wear fitted clothing so hips and knees are easy to see.",
      "Keep the background simple and uncluttered.",
    ],
    whatWeLookAt: [
      "Approximate squat depth (hip vs. knee height).",
      "General torso lean through the rep.",
    ],
  },
  {
    key: "deadlift-side-view",
    label: "Deadlift — Side View",
    movement: "deadlift",
    view: "side",
    repsGuidance: "Record 2–5 controlled reps.",
    cameraSetup: [
      "Place your phone on the floor or a low tripod, lens roughly hip height.",
      "Stand so the camera sees you fully from the side (90° profile), the bar or hands in frame if possible.",
      "Step back until your whole body — head to feet — stays in frame for the full lift.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film in a bright, evenly lit space so your hips, knees, and shoulders are clearly visible.",
      "Wear fitted clothing so your hip hinge is easy to see.",
      "Keep the background simple and uncluttered.",
    ],
    whatWeLookAt: [
      "Rough hip-hinge depth from body landmarks (not bar path).",
      "General torso angle and whether you reach a tall lockout.",
    ],
  },
  {
    key: "pushup-side-view",
    label: "Push-up — Side View",
    movement: "pushup",
    view: "side",
    repsGuidance: "Record 3–8 controlled reps.",
    cameraSetup: [
      "Place your phone on the floor a few feet to your side, lens low and level with your body.",
      "Set up so the camera sees you fully from the side (90° profile).",
      "Frame your whole body — hands to feet — for the entire set.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film in a bright, evenly lit space so your shoulders, elbows, and hips are clearly visible.",
      "Wear fitted clothing so your arm bend and body line are easy to see.",
      "Keep the background simple and uncluttered.",
    ],
    whatWeLookAt: [
      "Rough depth from how much the elbow bends.",
      "General body-line consistency (whether the hips sag or pike).",
    ],
  },
  {
    key: "benchpress-side-view",
    label: "Bench Press — Side View",
    movement: "benchpress",
    view: "side",
    repsGuidance: "Record 2–5 controlled reps.",
    cameraSetup: [
      "Place your phone on a low tripod or prop roughly at bench height, a couple of feet to your side.",
      "Set up so the camera sees you fully from the side (90° profile), with your arms and the bar path in frame.",
      "Frame your whole upper body — shoulders, elbows, and wrists — for the entire set.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film in a bright, evenly lit space so your shoulders, elbows, and wrists are clearly visible.",
      "Wear fitted clothing so your arm bend is easy to see.",
      "Keep the background simple and uncluttered.",
    ],
    whatWeLookAt: [
      "Rough press depth and lockout from how much the elbow bends and straightens.",
      "A coarse wrist-path proxy from body landmarks only — we do not track the bar.",
    ],
  },
  {
    key: "overheadpress-side-view",
    label: "Overhead Press — Side View",
    movement: "overheadpress",
    view: "side",
    repsGuidance: "Record 2–5 controlled reps.",
    cameraSetup: [
      "Place your phone on a tripod or prop roughly at shoulder height, a few feet to your side.",
      "Set up so the camera sees you fully from the side (90° profile), head to hips in frame.",
      "Frame your whole upper body and torso for the entire set.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film in a bright, evenly lit space so your shoulders, elbows, and hips are clearly visible.",
      "Wear fitted clothing so your arm bend and torso line are easy to see.",
      "Keep the background simple and uncluttered.",
    ],
    whatWeLookAt: [
      "Rough press depth and overhead lockout from how much the elbow bends and straightens.",
      "General forward/backward lean of the torso through the press.",
    ],
  },
  {
    key: "bentoverrow-side-view",
    label: "Bent-Over Row — Side View",
    movement: "bentoverrow",
    view: "side",
    repsGuidance: "Record 3–8 controlled reps.",
    cameraSetup: [
      "Place your phone on a low tripod or prop roughly at hip height, a few feet to your side.",
      "Set up so the camera sees you fully from the side (90° profile), with your hands and hips in frame.",
      "Frame your whole body — shoulders, hips, and hands — for the entire set.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film in a bright, evenly lit space so your shoulders, elbows, and hips are clearly visible.",
      "Wear fitted clothing so your hip hinge and arm bend are easy to see.",
      "Keep the background simple and uncluttered.",
    ],
    whatWeLookAt: [
      "Rough pull range from how much the elbows bend back.",
      "General hip-hinge stability (whether your torso angle holds steady).",
    ],
  },

  // V1.9 Full Movement Expansion Pack
  // Tier 1 — squat, hinge, press and pull variations of movements we already read.
  {
    key: "front-squat-side-view",
    label: "Front Squat — Side View",
    movement: "frontsquat",
    view: "side",
    repsGuidance: "Record 2–5 controlled reps.",
    cameraSetup: [
      "Place your phone on the floor or a low tripod, lens roughly hip height.",
      "Stand so the camera sees you fully from the side (90° profile), with the bar racked on your shoulders in frame.",
      "Step back until your whole body — head to feet — stays in frame the entire rep.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film in a bright, evenly lit space so your hips, knees, and torso are clearly visible.",
      "Wear fitted clothing so your hips and knees are easy to see.",
      "Keep the background simple and uncluttered.",
    ],
    whatWeLookAt: [
      "Approximate squat depth (hip vs. knee height).",
      "General torso angle — front squats stay more upright, so drift is worth reviewing.",
    ],
  },
  {
    key: "romanian-deadlift-side-view",
    label: "Romanian Deadlift — Side View",
    movement: "rdl",
    view: "side",
    repsGuidance: "Record 3–6 controlled reps.",
    cameraSetup: [
      "Place your phone on a low tripod or prop roughly at hip height, a few feet to your side.",
      "Set up so the camera sees you fully from the side (90° profile), with the bar and hips in frame.",
      "Frame your whole body — shoulders, hips, knees, and the bar path — for the full set.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film in a bright, evenly lit space so your hips, knees, and shoulders are clearly visible.",
      "Wear fitted clothing so your hip hinge and soft knee bend are easy to see.",
      "Keep the background simple and uncluttered.",
    ],
    whatWeLookAt: [
      "Coarse hip-hinge range from body landmarks (not bar path).",
      "General knee-bend and lockout consistency across reps — a proxy, not a spine assessment.",
    ],
  },
  {
    key: "incline-benchpress-side-view",
    label: "Incline Bench Press — Side View",
    movement: "inclinebench",
    view: "side",
    repsGuidance: "Record 2–5 controlled reps.",
    cameraSetup: [
      "Place your phone on a tripod or prop at roughly upper-chest height, a couple of feet to your side.",
      "Set up so the camera sees you fully from the side (90° profile), with your arms and the bar path in frame.",
      "Frame your whole upper body — shoulders, elbows, and wrists — for the entire set.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film in a bright, evenly lit space so your shoulders, elbows, and wrists are clearly visible.",
      "Wear fitted clothing so your arm bend is easy to see.",
      "Keep the background simple and uncluttered.",
    ],
    whatWeLookAt: [
      "Rough press depth and lockout from how much the elbow bends and straightens.",
      "A coarse wrist-path proxy from body landmarks only — we do not track the bar.",
    ],
  },
  {
    key: "dumbbell-shoulder-press-side-view",
    label: "Dumbbell Shoulder Press — Side View",
    movement: "dbshoulderpress",
    view: "side",
    repsGuidance: "Record 2–5 controlled reps.",
    cameraSetup: [
      "Place your phone on a tripod or prop roughly at shoulder height, a few feet to your side.",
      "Set up so the camera sees you fully from the side (90° profile), head to hips in frame.",
      "Frame your whole upper body and torso so the overhead lockout stays visible.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film in a bright, evenly lit space so your shoulders, elbows, and hips are clearly visible.",
      "Wear fitted clothing so your arm bend and torso line are easy to see.",
      "Keep the background simple and uncluttered.",
    ],
    whatWeLookAt: [
      "Rough press depth and overhead lockout from how much the elbow bends and straightens.",
      "General forward/backward lean of the torso through the press.",
    ],
  },
  {
    key: "pullup-front-view",
    label: "Pull-up / Chin-up — Front View",
    movement: "pullup",
    view: "front",
    repsGuidance: "Record 3–8 controlled reps.",
    cameraSetup: [
      "Place your phone on a tripod or prop a few feet in front of the bar, lens roughly at bar height.",
      "Set up so the camera sees your whole body straight on (front view) as you hang and pull.",
      "Frame from your hands on the bar down to your hips for the entire set.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film in a bright, evenly lit space so your shoulders and elbows are clearly visible.",
      "Wear fitted clothing so your arm bend and torso are easy to see.",
      "Keep the background simple so your body separates clearly from it.",
    ],
    whatWeLookAt: [
      "Coarse pull range and top position from how much the elbows bend.",
      "General bottom-extension and tempo consistency across reps — estimates only.",
    ],
  },
  {
    key: "lunge-side-view",
    label: "Lunge / Split Squat — Side View",
    movement: "lunge",
    view: "side",
    repsGuidance: "Record 3–6 controlled reps per side.",
    cameraSetup: [
      "Place your phone on the floor or a low tripod, lens roughly hip height, a few feet to your side.",
      "Set up so the camera sees you fully from the side (90° profile), front and back leg in frame.",
      "Step back until your whole body — head to feet — stays in frame for every rep.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film in a bright, evenly lit space so your hips and knees are clearly visible.",
      "Wear fitted clothing so your front-knee bend and torso line are easy to see.",
      "Film one side at a time so the working leg stays clearly in view.",
    ],
    whatWeLookAt: [
      "Approximate front-leg depth from how much the knee bends.",
      "General torso drift and rep-to-rep consistency — coarse estimates.",
    ],
  },

  // Tier 2 — additional common gym movements with conservative shared analysis.
  {
    key: "hip-thrust-side-view",
    label: "Hip Thrust / Glute Bridge — Side View",
    movement: "hipthrust",
    view: "side",
    repsGuidance: "Record 3–8 controlled reps.",
    cameraSetup: [
      "Place your phone on the floor or a low prop, lens roughly at hip height, a few feet to your side.",
      "Set up so the camera sees you fully from the side (90° profile), shoulders to knees in frame.",
      "Frame your whole torso and hips so the top lockout is clearly visible.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film in a bright, evenly lit space so your hips, shoulders, and knees are clearly visible.",
      "Wear fitted clothing so your hip extension is easy to see.",
      "Keep the background simple and uncluttered.",
    ],
    whatWeLookAt: [
      "Coarse hip-extension range and a top-hold proxy from body landmarks.",
      "General rep-to-rep range consistency — an estimate, not a glute-activation measure.",
    ],
  },
  {
    key: "goblet-squat-side-view",
    label: "Goblet Squat — Side View",
    movement: "gobletsquat",
    view: "side",
    repsGuidance: "Record 2–6 controlled reps.",
    cameraSetup: [
      "Place your phone on the floor or a low tripod, lens roughly hip height.",
      "Stand so the camera sees you fully from the side (90° profile), the weight held at your chest in frame.",
      "Step back until your whole body — head to feet — stays in frame the entire rep.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film in a bright, evenly lit space so your hips and knees are clearly visible.",
      "Wear fitted clothing so your hips and knees are easy to see.",
      "Keep the background simple and uncluttered.",
    ],
    whatWeLookAt: [
      "Approximate squat depth (hip vs. knee height).",
      "General torso angle and bottom-position consistency across reps.",
    ],
  },
  {
    key: "dumbbell-benchpress-side-view",
    label: "Dumbbell Bench Press — Side View",
    movement: "dbbench",
    view: "side",
    repsGuidance: "Record 2–5 controlled reps.",
    cameraSetup: [
      "Place your phone on a low tripod or prop roughly at bench height, a couple of feet to your side.",
      "Set up so the camera sees you fully from the side (90° profile), with your arms in frame.",
      "Frame your whole upper body — shoulders, elbows, and wrists — for the entire set.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film in a bright, evenly lit space so your shoulders, elbows, and wrists are clearly visible.",
      "Wear fitted clothing so your arm bend is easy to see.",
      "Keep the background simple and uncluttered.",
    ],
    whatWeLookAt: [
      "Rough press depth and lockout from how much the elbow bends and straightens.",
      "A coarse wrist-path proxy from body landmarks only — we do not track the dumbbells.",
    ],
  },
  {
    key: "seated-cable-row-side-view",
    label: "Seated Cable Row — Side View",
    movement: "cablerow",
    view: "side",
    repsGuidance: "Record 3–8 controlled reps.",
    cameraSetup: [
      "Place your phone on a low tripod or prop roughly at torso height, a few feet to your side.",
      "Set up so the camera sees you fully from the side (90° profile), hands and torso in frame.",
      "Frame your whole upper body — shoulders, elbows, and hips — for the entire set.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film in a bright, evenly lit space so your shoulders, elbows, and hips are clearly visible.",
      "Wear fitted clothing so your arm bend and torso are easy to see.",
      "Keep the background simple and uncluttered.",
    ],
    whatWeLookAt: [
      "Coarse pull range from how much the elbows bend back.",
      "A torso-stability proxy — whether your upper body stays steady through the pull.",
    ],
  },
  {
    key: "lat-pulldown-front-view",
    label: "Lat Pulldown — Front View",
    movement: "latpulldown",
    view: "front",
    repsGuidance: "Record 3–8 controlled reps.",
    cameraSetup: [
      "Place your phone on a tripod or prop a few feet in front of the seat, lens roughly at chest height.",
      "Set up so the camera sees your whole upper body straight on (front view) as you pull.",
      "Frame from your hands on the bar down to your hips for the entire set.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film in a bright, evenly lit space so your shoulders and elbows are clearly visible.",
      "Wear fitted clothing so your arm bend and torso are easy to see.",
      "Keep the background simple so your body separates clearly from it.",
    ],
    whatWeLookAt: [
      "Coarse pull range and top position from how much the elbows bend.",
      "General bottom-extension and tempo consistency across reps — estimates only.",
    ],
  },
  {
    key: "dip-side-view",
    label: "Dip — Side View",
    movement: "dip",
    view: "side",
    repsGuidance: "Record 3–8 controlled reps.",
    cameraSetup: [
      "Place your phone on a tripod or prop roughly at chest height, a few feet to your side.",
      "Set up so the camera sees you fully from the side (90° profile), shoulders to hips in frame.",
      "Frame your whole upper body and torso for the entire set.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film in a bright, evenly lit space so your shoulders and elbows are clearly visible.",
      "Wear fitted clothing so your arm bend and torso line are easy to see.",
      "Keep the background simple and uncluttered.",
    ],
    whatWeLookAt: [
      "Coarse depth and lockout from how much the elbows bend and straighten.",
      "A torso-lean proxy across reps — an estimate, not a shoulder-position diagnosis.",
    ],
  },

  // Tier 3 — advanced Olympic / ballistic lifts. Analysis is intentionally coarse
  // and conservative: phase, tempo and range proxies only, never precise technical
  // claims. Warm-up loads and a clear side/three-quarter angle help a lot.
  {
    key: "power-clean-side-view",
    label: "Power Clean — Side View",
    movement: "powerclean",
    view: "side",
    repsGuidance: "Record 2–4 controlled reps with a light warm-up load first.",
    cameraSetup: [
      "Place your phone on a low tripod or prop roughly at hip height, a few feet to your side or three-quarter angle.",
      "Set up so the camera sees you fully from the side, floor to overhead-rack height in frame.",
      "Keep your whole body — floor to catch — inside the frame for every rep.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film a light warm-up set first — coarse analysis is safest on submaximal, controlled reps.",
      "Use a side or three-quarter view and adequate lighting so joints track cleanly through the fast pull.",
      "Keep the full body in frame; explosive lifts easily clip out of the top of the shot.",
      "This is a coarse estimate only — it does not judge bar-path precision or catch mechanics.",
    ],
    whatWeLookAt: [
      "Very coarse phase and tempo proxies (pull, extension, catch) from body landmarks.",
      "Whether reps look rhythmically consistent — not a technical breakdown of the lift.",
    ],
  },
  {
    key: "snatch-side-view",
    label: "Snatch — Side View",
    movement: "snatch",
    view: "side",
    repsGuidance: "Record 2–4 controlled reps with a light warm-up load first.",
    cameraSetup: [
      "Place your phone on a low tripod or prop roughly at hip height, a few feet to your side or three-quarter angle.",
      "Set up so the camera sees you fully from the side, floor to full overhead lockout in frame.",
      "Keep your whole body — floor to overhead — inside the frame for every rep.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film a light warm-up set first — coarse analysis is safest on submaximal, controlled reps.",
      "Use a side or three-quarter view and adequate lighting so joints track through the fast pull.",
      "Keep the full body in frame; the overhead catch easily clips out of the top of the shot.",
      "This is a coarse estimate only — it does not judge bar path, overhead stability, or catch depth.",
    ],
    whatWeLookAt: [
      "Very coarse phase and tempo proxies (pull, turnover, overhead catch) from body landmarks.",
      "Whether reps look rhythmically consistent — not a technical breakdown of the lift.",
    ],
  },
  {
    key: "clean-and-jerk-side-view",
    label: "Clean & Jerk / Push Jerk — Side View",
    movement: "cleanjerk",
    view: "side",
    repsGuidance: "Record 1–3 controlled reps with a light warm-up load first.",
    cameraSetup: [
      "Place your phone on a low tripod or prop roughly at hip height, a few feet to your side or three-quarter angle.",
      "Set up so the camera sees you fully from the side, floor to full overhead lockout in frame.",
      "Keep your whole body — floor to overhead — inside the frame for the whole lift.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film a light warm-up set first — coarse analysis is safest on submaximal, controlled reps.",
      "Use a side or three-quarter view and adequate lighting so joints track through the dip and drive.",
      "Keep the full body in frame; the jerk lockout easily clips out of the top of the shot.",
      "This is a coarse estimate only — it does not judge bar path, split position, or overhead stability.",
    ],
    whatWeLookAt: [
      "Very coarse phase and tempo proxies (clean, dip-drive, overhead lockout) from body landmarks.",
      "Whether the lockout and rhythm look consistent — not a technical breakdown of the lift.",
    ],
  },
  {
    key: "kettlebell-swing-side-view",
    label: "Kettlebell Swing — Side View",
    movement: "kettlebellswing",
    view: "side",
    repsGuidance: "Record 5–10 controlled reps with a light warm-up load first.",
    cameraSetup: [
      "Place your phone on the floor or a low prop, lens roughly at hip height, a few feet to your side.",
      "Set up so the camera sees you fully from the side (90° profile), head to feet in frame.",
      "Keep your whole body and the bell's arc inside the frame for the whole set.",
      "Keep the camera still; prop it against something rather than holding it.",
    ],
    recordingTips: [
      "Film a light warm-up set first — coarse analysis is safest on controlled, rhythmic reps.",
      "Use a side view and adequate lighting so your hips and shoulders track cleanly.",
      "Keep the full body in frame; the bell swings up and out of a tight shot.",
      "This is a coarse estimate only — it does not judge hinge precision or spine position.",
    ],
    whatWeLookAt: [
      "Very coarse hip-hinge range and swing-rhythm proxies from body landmarks.",
      "Whether reps look rhythmically consistent — not a technical breakdown of the hinge.",
    ],
  },
];

const BY_KEY = new Map(PROTOCOLS.map(p => [p.key, p]));

export function listProtocols() {
  return PROTOCOLS.slice();
}

export function getProtocol(key) {
  return BY_KEY.get(key) || BY_KEY.get(DEFAULT_MOVEMENT) || null;
}

// Resolve a human-readable label for a stored movement key. Unlike getProtocol,
// this NEVER substitutes the default label for an unknown key — it echoes the
// raw key back so saved history can't be mislabeled as a different movement.
// Safe for rendering (React escapes the string).
export function movementLabel(key) {
  const p = BY_KEY.get(key);
  if (p) return p.label;
  if (typeof key === "string" && key.trim()) return key;
  return "Form Check";
}
