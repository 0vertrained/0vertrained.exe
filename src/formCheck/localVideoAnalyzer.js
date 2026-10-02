// Video analysis bridge for Form Check.
//
// Privacy model: the selected video is read locally only for basic metadata and
// validation, then uploaded to the hosted Form Check Engine for temporary
// processing. The hosted engine deletes the video immediately and returns only
// derived analysis results. This module never persists video, frames, object URLs,
// or raw landmarks.

import { validateVideo } from "./videoValidation";
import { assessConfidence } from "./confidence";
import { getProtocol, DEFAULT_MOVEMENT } from "./protocols";
import { analyzeVideoWithHostedEngine, mapHostedResultToAnalysis } from "./serverPoseClient";
import { getMovementModule } from "./movementRouting";

export function readVideoMetadata(file) {
  return new Promise((resolve, reject) => {
    if (!file || typeof URL === "undefined" || !URL.createObjectURL || typeof document === "undefined") {
      reject(new Error("Cannot read video metadata in this environment."));
      return;
    }
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
    };

    video.onloadedmetadata = () => {
      const meta = {
        durationSec: Number.isFinite(video.duration) ? video.duration : null,
        width: video.videoWidth || null,
        height: video.videoHeight || null,
      };
      cleanup();
      resolve(meta);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("Could not read this video file."));
    };
    video.src = url;
  });
}

function unavailableResult({ movement, reason }) {
  const confidence = {
    ...assessConfidence({ framesAnalyzed: 0, framesWithLandmarks: 0, avgVisibility: 0 }),
    reasons: [reason],
  };
  const result = getMovementModule(movement).analyze({}, { confidence });
  return { confidence, result };
}

export async function analyzeLocalVideo({ file, movement = DEFAULT_MOVEMENT, signal } = {}) {
  const protocol = getProtocol(movement);

  let metadata;
  try {
    metadata = await readVideoMetadata(file);
  } catch {
    metadata = null;
  }

  const validation = validateVideo({
    file,
    durationSec: metadata?.durationSec,
    width: metadata?.width,
    height: metadata?.height,
  });
  if (!validation.valid) {
    return { status: "invalid", movement, protocol, metadata, validation };
  }

  try {
    const hosted = await analyzeVideoWithHostedEngine({ file, movement, signal });
    return mapHostedResultToAnalysis(hosted, { protocol, metadata, validation });
  } catch (err) {
    const reason = err?.message || "Couldn't reach the hosted form check engine.";
    const { confidence, result } = unavailableResult({ movement, reason });
    return {
      status: "unavailable",
      movement,
      protocol,
      metadata,
      validation,
      analyzer: "hosted-formcheck-engine",
      confidence,
      result,
      privacy: { videoStored: false, retention: "not_processed" },
      retakeTips: [
        "Check your connection and try again.",
        "Use a short 5–12 second side-view clip so the hosted engine has less to process.",
      ],
    };
  }
}
