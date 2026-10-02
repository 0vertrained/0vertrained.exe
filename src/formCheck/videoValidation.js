// Local video validation for Form Check.
//
// Pure helper — validates a selected/recorded clip BEFORE hosted analysis.
// This only gates obviously-unusable input so the UI can give fast, friendly
// feedback before upload. It performs no upload and no storage itself; the
// hosted analyzer handles temporary processing and deletion.
//
// V1.1: Stricter limits aligned to backend, with warnings for non-ideal input
// (duration, file size, resolution). Warnings do not block upload but allow
// the UI to show guidance and optional retake tips.

export const VIDEO_LIMITS = {
  acceptedTypePrefix: "video/",
  minDurationSec: 1,
  maxDurationSec: 20, // Direct upload limit; backend accepts ≤ 20s
  idealDurationSec: 12, // Sweet spot: 5–12s recommended for 2–5 reps
  minIdealDurationSec: 5,
  maxBytes: 30 * 1024 * 1024, // 30 MB hard limit, aligned to backend
  idealResolutionMinDim: 360, // Warn if dimension < 360p
};

function result(valid, code, message, warnings = [], retakeTips = []) {
  return { valid, code, message, warnings, retakeTips };
}

// V1.1: Return object includes warnings (non-blocking) and retakeTips.
// durationSec and metadata may be null/undefined when metadata hasn't been read yet.
export function validateVideo({ file, durationSec, width, height } = {}) {
  const warnings = [];
  const retakeTips = [];

  if (!file) {
    return result(false, "missing-file", "Choose or record a video first.");
  }

  const type = typeof file.type === "string" ? file.type : "";
  if (!type.startsWith(VIDEO_LIMITS.acceptedTypePrefix)) {
    return result(false, "invalid-type", "That file isn't a video. Use a short video clip.");
  }

  if (typeof file.size === "number" && file.size > VIDEO_LIMITS.maxBytes) {
    return result(
      false,
      "too-large",
      `That clip exceeds ${VIDEO_LIMITS.maxBytes / 1024 / 1024}MB. Record a shorter or lower-quality clip.`,
    );
  }

  // Check duration with warnings for non-ideal ranges.
  if (durationSec != null && Number.isFinite(durationSec)) {
    if (durationSec > VIDEO_LIMITS.maxDurationSec) {
      return result(
        false,
        "too-long",
        `Keep it under ${VIDEO_LIMITS.maxDurationSec}s — record just a few reps.`,
      );
    }
    if (durationSec < VIDEO_LIMITS.minDurationSec) {
      return result(false, "too-short", "That clip is too short to read. Record a few full reps.");
    }
    // Warn if outside ideal range.
    if (durationSec < VIDEO_LIMITS.minIdealDurationSec || durationSec > VIDEO_LIMITS.idealDurationSec) {
      warnings.push(
        `Ideal clip length is ${VIDEO_LIMITS.minIdealDurationSec}–${VIDEO_LIMITS.idealDurationSec}s (2–5 reps); this is ${durationSec.toFixed(1)}s.`,
      );
      retakeTips.push(
        `Record 2–5 reps in ${VIDEO_LIMITS.minIdealDurationSec}–${VIDEO_LIMITS.idealDurationSec}s for better accuracy.`,
      );
    }
  }

  // Warn if resolution is low.
  if (width != null && height != null) {
    const minDim = Math.min(width, height);
    if (minDim < VIDEO_LIMITS.idealResolutionMinDim) {
      warnings.push(`Video is ${width}×${height} (low resolution). Clearer framing improves accuracy.`);
      retakeTips.push("Use a clearer camera angle; better resolution helps the form check.");
    }
  }

  // Warn if file size is large (even under limit).
  if (typeof file.size === "number") {
    const sizeMB = file.size / 1024 / 1024;
    if (sizeMB > 20) {
      warnings.push(`File is ${sizeMB.toFixed(1)}MB. Smaller clips upload faster.`);
      retakeTips.push("Consider a shorter or lower-bitrate recording.");
    }
  }

  return result(true, "ok", "Looks good.", warnings, retakeTips);
}
