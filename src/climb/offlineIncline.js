// Browser counterpart to ClimbInclineReplay's virtual deck in ClimbProtocol.swift.
// All input, including measured grade, comes from the supplied timeline.
const virtualDeck = Object.freeze({
  step: 0.5, maxChange: 2, interval: 3, tolerance: 0.26,
  feedbackAge: 5, goalLease: 6, ackTimeout: 4, settleTimeout: 8,
});

const messages = {
  telemetry: "Automatic incline released. Check belt speed and deck grade on the console.",
  expired: "Course target expired. Use the console to set incline.",
  timeout: "The treadmill took too long to confirm its incline. Use the console.",
  measuredOverride: "The measured incline changed. The console now controls the deck.",
  rejected: "The treadmill did not accept the control procedure. Use manual incline.",
  console: "The console changed the target incline. Follow the console.",
  pause: "Manual incline. Check the deck on the console.",
  background: "Automatic incline released while the app is inactive.",
  disconnect: "Treadmill disconnected. Reconnect or continue with manual readings.",
};

export function simulateIncline(events, cap, simulateAcknowledgements = true) {
  if (!Array.isArray(events) || events.length > 60_000 || !Number.isFinite(cap) || cap < 0 || cap > 15) {
    throw new Error("Replay requires at most 60,000 events and a cap between 0% and 15%.");
  }

  let stage = "manual", acquired = false, reason;
  let speed = 0, measuredGrade, speedAt = -Infinity, inclineAt = -Infinity;
  let desiredGrade, targetGrade, lastSequence = 0, lastWrite = 0, lastTime = 0;
  let goalDeadline = 0, procedureDeadline = 0;

  function hasFeedback(at) {
    return speed > 0 && at - speedAt < virtualDeck.feedbackAge && at - inclineAt < virtualDeck.feedbackAge;
  }
  function release(message) {
    stage = "manual";
    desiredGrade = undefined;
    targetGrade = undefined;
    reason = message;
  }
  function check(at) {
    if (stage === "manual") return;
    if (!hasFeedback(at)) return release(messages.telemetry);
    if (at >= goalDeadline) return release(messages.expired);
    if (stage !== "armed" && at >= procedureDeadline) return release(messages.timeout);
    const onTarget = Math.abs(measuredGrade - targetGrade) <= virtualDeck.tolerance;
    if (stage === "settling" && inclineAt >= lastWrite && onTarget) stage = "armed";
    else if (stage === "armed" && !onTarget) release(messages.measuredOverride);
  }
  function acknowledge(opcode, ok, at) {
    if (stage === "manual") return;
    if (!ok || at >= procedureDeadline) return release(messages.rejected);
    if (stage === "acquiring" && opcode === 0) stage = "armed";
    else if (stage === "acknowledging" && opcode === 3) {
      stage = "settling";
      procedureDeadline = at + virtualDeck.settleTimeout;
    } else release(messages.rejected);
  }
  function nextCommand(at) {
    check(at);
    if (stage !== "armed" || desiredGrade == null || at - lastWrite < virtualDeck.interval) return;
    const low = Math.max(0, measuredGrade - virtualDeck.maxChange);
    const high = Math.min(cap, measuredGrade + virtualDeck.maxChange);
    const lowTick = Math.ceil(low / virtualDeck.step - 0.000001);
    const highTick = Math.floor(high / virtualDeck.step + 0.000001);
    if (lowTick > highTick) return;
    const next = virtualDeck.step * Math.min(highTick, Math.max(lowTick, Math.round(desiredGrade / virtualDeck.step)));
    if (Math.abs(next - measuredGrade) <= virtualDeck.tolerance) return;
    targetGrade = next;
    lastWrite = at;
    procedureDeadline = at + virtualDeck.ackTimeout;
    stage = "acknowledging";
    return "incline";
  }

  const rows = [];
  for (const [index, event] of events.entries()) {
    const invalid = () => new Error(`Invalid replay event at index ${index}.`);
    if (!event || !Number.isFinite(event.at) || event.at < lastTime) throw invalid();
    const { at, type, speedMps, inclinePercent, grade, sequence, opcode, ok } = event;
    if ([speedMps, inclinePercent, grade].some(value => value != null && !Number.isFinite(value)) ||
        [sequence, opcode].some(value => value != null && !Number.isSafeInteger(value)) ||
        (ok != null && typeof ok !== "boolean")) throw invalid();
    lastTime = at;
    let command;
    switch (type) {
    case "telemetry":
      if ((speedMps == null && inclinePercent == null) || (speedMps != null && speedMps < 0) ||
          (inclinePercent != null && Math.abs(inclinePercent) > 100)) throw invalid();
      if (speedMps != null) { speed = speedMps; speedAt = at; }
      if (inclinePercent != null) { measuredGrade = inclinePercent; inclineAt = at; }
      break;
    case "arm":
      if (!acquired && hasFeedback(at) && measuredGrade >= 0 && measuredGrade <= cap) {
        acquired = true;
        targetGrade = measuredGrade;
        stage = "acquiring";
        lastWrite = at;
        goalDeadline = at + virtualDeck.goalLease;
        procedureDeadline = at + virtualDeck.ackTimeout;
        command = "acquire";
      }
      break;
    case "target":
      if (!Number.isFinite(grade) || !Number.isSafeInteger(sequence) || sequence < 1) throw invalid();
      check(at);
      if (stage !== "manual" && sequence > lastSequence) {
        desiredGrade = Math.min(cap, Math.max(0, grade));
        lastSequence = sequence;
        goalDeadline = at + virtualDeck.goalLease;
      }
      break;
    case "tick":
      command = nextCommand(at);
      break;
    case "ack":
      if (![0, 3].includes(opcode) || typeof ok !== "boolean") throw invalid();
      check(at);
      acknowledge(opcode, ok, at);
      break;
    case "console": {
      if (!Number.isFinite(grade) || Math.abs(grade) > 100) throw invalid();
      // Standard FTMS status carries signed tenths. Swift rounds ties away from zero.
      const consoleGrade = Math.sign(grade) * Math.round(Math.abs(grade) * 10) / 10;
      if (stage !== "manual" && Math.abs(consoleGrade - targetGrade) > virtualDeck.tolerance) release(messages.console);
      break;
    }
    case "background":
    case "pause":
    case "disconnect":
      if (stage !== "manual") release(messages[type]);
      break;
    default:
      throw invalid();
    }
    const row = { at, type };
    if (command) {
      row.command = command;
      if (command === "incline") row.commandGrade = targetGrade;
      if (simulateAcknowledgements) acknowledge(command === "incline" ? 3 : 0, true, at);
    }
    check(at);
    row.stage = stage;
    if (desiredGrade != null) row.desiredGrade = desiredGrade;
    if (targetGrade != null) row.targetGrade = targetGrade;
    if (measuredGrade != null) row.measuredGrade = measuredGrade;
    if (reason) row.reason = reason;
    rows.push(row);
  }
  return { version: 1, rows };
}
