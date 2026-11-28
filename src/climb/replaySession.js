import { nativePlugin } from "../native";
import { gradeAt } from "./course";
import { simulateIncline } from "./offlineIncline";

const second = 1000;
const freshMs = 5000;
const valid = Number.isFinite;
const interruptions = { pause: "pause", background: "background", disconnect: "disconnect", reset: "disconnect", gap: "disconnect" };

// A labeled example is available before an athlete has a transmitter. The
// positions and measured grades in a saved check always come from that check.
const demoSamples = Array.from({length: 61}, (_, s) => ({
  at: 1000 + s * second, segment: 0, phase: s < 18 ? "baseline" : "observe",
  distanceMeters: 180 + s * 2, speedMps: 2, inclinePercent: Math.min(4, Math.max(0, s - 18))
}));
export const DEMO_CHECK = {
  id: "example", version: 1, physicalMachine: "Example treadmill", transmitter: {name: "Simulated transmitter"},
  startedAt: 1000, endedAt: 61000, outcome: "completed", samples: demoSamples,
  markers: [{kind:"baseline",at:1000},{kind:"adjust",at:19000},{kind:"observe",at:23000},{kind:"finish",at:61000}],
  stats: {packets:61, intervals:60, durationMs:60000, meanIntervalMs:1000, longestGapMs:1000, interruptions:0, missedPackets:0,
    baselineGrade:0, observedGrade:4, gradeResponse:"changed", responseDelayMs:1000}
};

function timeline(check, course, startMeters, cap) {
  if (!course?.points?.length || !valid(startMeters) || startMeters < 0 || startMeters >= course.distanceMeters)
    throw new Error("Choose a starting position before the crest of this course.");
  if (!valid(cap) || cap < 0 || cap > 15) throw new Error("Choose a replay incline cap between 0% and 15%.");
  if (!Array.isArray(check?.samples) || check.samples.length > 6000 || !Array.isArray(check.markers) || check.markers.length > 256 ||
      !valid(check.startedAt) || !valid(check.endedAt) || Math.abs(check.startedAt)>8.64e15 || Math.abs(check.endedAt)>8.64e15 || check.endedAt < check.startedAt)
    throw new Error("This check has an incomplete or unsupported timeline.");

  const buckets = new Map();
  const bucket = at => {
    if (!buckets.has(at)) buckets.set(at, {samples:[], markers:[]});
    return buckets.get(at);
  };
  const inside = at => valid(at) && Math.abs(at)<=8.64e15 && at >= check.startedAt && at <= check.endedAt;
  for (const sample of check.samples) {
    if (!inside(sample.at)) continue;
    bucket(sample.at).samples.push(sample);
  }
  for (const marker of check.markers) if (inside(marker.at) && interruptions[marker.kind])
    bucket(marker.at).markers.push(interruptions[marker.kind]);
  bucket(check.startedAt); bucket(check.endedAt);
  // Run the virtual watchdog through the freshness timeout, even in silence.
  // A night between two readings adds no hours of fabricated intermediate data.
  const observations = [...buckets.keys()].sort((a,b) => a-b);
  // Match the native half-second watchdog. For unusually long, sparse captures
  // use whole-second ticks to stay inside the native event/bridge budget.
  const activeMs=observations.slice(1).reduce((total,at,i)=>total+Math.min(at-observations[i],freshMs+second),0);
  const tickMs=activeMs/500 + activeMs/2000 + 3*check.samples.length > 55000 ? second : 500;
  for (let i=1; i<observations.length; i++) {
    const previous = observations[i-1];
    const firstTick = check.startedAt + (Math.floor((previous-check.startedAt)/tickMs)+1)*tickMs;
    for (let at=firstTick; at<observations[i] && at<=previous+freshMs+tickMs; at+=tickMs) bucket(at);
  }

  let meters=startMeters, estimatedMeters=0, segment=null;
  let counter=null, speed=null, incline=null, lastSampleAt=null;
  let armAttempted=false, abandoned=false, sequence=0, lastGoalAt=-Infinity, lastGrade=null;
  const events=[], points=[];
  for (const [at,b] of [...buckets].sort(([a],[z]) => a-z)) {
    const t=(at-check.startedAt)/second;
    const emit = (type,fields) => events.push({at:t,type,...fields});
    const interrupt = kind => {
      if (armAttempted && !abandoned) { emit(kind); abandoned=true; }
      counter=null; speed=null; incline=null; lastSampleAt=null;
    };
    for (const kind of b.markers) interrupt(kind);
    for (const sample of b.samples) {
      if (segment !== sample.segment || (lastSampleAt!==null && at-lastSampleAt>=freshMs)) interrupt("disconnect");
      segment=sample.segment; lastSampleAt=at;
      const values={};
      // A grade-only stream cannot bridge an interval with no movement signal.
      const lastMotion=Math.max(counter?.at??-Infinity,speed?.at??-Infinity);
      if (at-lastMotion>=freshMs) {counter=null; speed=null;}
      if (valid(sample.speedMps) && sample.speedMps>=0) {
        values.speedMps=sample.speedMps;
        if ((!counter || at-counter.at>=freshMs) && speed && at-speed.at<freshMs && Math.max(speed.value, sample.speedMps)<=14) {
          const advance=Math.min(course.distanceMeters-meters,(speed.value+sample.speedMps)/2*(at-speed.at)/second);
          estimatedMeters+=advance; meters+=advance;
        }
        speed={at,value:sample.speedMps};
      }
      if (valid(sample.distanceMeters) && sample.distanceMeters>=0) {
        if (counter) {
          const elapsed=(at-counter.at)/second, delta=sample.distanceMeters-counter.value;
          if (elapsed>0 && delta>=0 && delta<=14*elapsed+2) {
            // Reconcile any intervening speed estimate against the new counter.
            // An overlapping reading confirms distance already credited.
            const fromCounter=Math.min(delta,course.distanceMeters-counter.meters);
            const estimatedSinceCounter=estimatedMeters-counter.estimatedMeters;
            estimatedMeters-=Math.min(estimatedSinceCounter,fromCounter);
            meters=Math.max(meters,counter.meters+fromCounter);
          }
        }
        counter={at,value:sample.distanceMeters,meters,estimatedMeters};
      }
      if (valid(sample.inclinePercent) && Math.abs(sample.inclinePercent)<=100) {
        values.inclinePercent=sample.inclinePercent; incline={at,value:sample.inclinePercent};
      }
      if (Object.keys(values).length) emit("telemetry",values);
    }
    const freshSpeed=speed && at-speed.at<freshMs;
    const positionKnown=(counter && at-counter.at<freshMs) || freshSpeed;
    const grade=positionKnown ? gradeAt(course,meters) : null;
    const measuredGrade=incline && at-incline.at<freshMs ? incline.value : null;
    const atCrest=meters>=course.distanceMeters;
    if (!armAttempted && freshSpeed && speed.value>0 && valid(measuredGrade) && measuredGrade>=0 && measuredGrade<=cap && valid(grade) && !atCrest) {
      emit("arm"); armAttempted=true;
    }
    if (armAttempted && !abandoned) {
      if (atCrest || (!valid(grade) && positionKnown)) { emit("pause"); abandoned=true; }
      else if (valid(grade) && (at-lastGoalAt>=2000 || grade!==lastGrade)) {
        emit("target",{grade,sequence:++sequence}); lastGoalAt=at; lastGrade=grade;
      }
      // Sensor events and the watchdog remain separate; only a tick can advance
      // the virtual deck, even when several fields arrived in the same packet.
      if (at===check.startedAt || (at-check.startedAt)%tickMs===0 || at-lastGoalAt>=freshMs) emit("tick");
    }
    points.push({at:t,meters,segment:segment??0,courseGrade:grade,measuredGrade,lastEvent:events.length-1});
  }
  if (events.length>=60000) throw new Error("This capture has too many events for one replay.");
  return {events,points,trackedMeters:meters-startMeters,estimatedMeters,durationSeconds:(check.endedAt-check.startedAt)/second};
}

// This dispatch has only one native entry point. The fallback runs the same
// replay vectors in JavaScript for browsers and previously installed shells.
async function execute(events, cap) {
  const plugin=nativePlugin("OTClimb");
  if (typeof plugin?.replayIncline === "function") {
    try {
      const result=await plugin.replayIncline({events,cap,simulateAcknowledgements:true});
      if (result?.version!==1 || result.rows?.length!==events.length) throw new Error("The iPhone returned an incomplete incline replay.");
      return {rows:result.rows,controller:"iPhone"};
    } catch (error) {
      if (error?.code!=="UNIMPLEMENTED" && !/not implemented/i.test(error?.message || "")) throw error;
    }
  }
  return {rows:simulateIncline(events,cap,true).rows,controller:"Browser"};
}

export async function runSessionReplay({check,course,startMeters=0,cap=10,scenario="recorded"}) {
  if (!["recorded","background","disconnect","console"].includes(scenario)) throw new Error("Choose a replay scenario.");
  const plan=timeline(check,course,startMeters,cap);
  let {rows,controller}=await execute(plan.events,cap);
  let faultAt=null, insertion=-1;
  if (scenario!=="recorded") {
    const acquire=rows.findIndex(row => row.command==="acquire");
    if (acquire>=0) {
      // Prefer a point at which the controller is actually following the hill.
      // If recorded feedback caused an earlier release, inject just after arming.
      const step=rows.findIndex(row => row.command==="incline");
      const pivot=step>=0?step:acquire;
      const before=rows[pivot];
      faultAt=before.at; insertion=pivot+1;
      const fault={at:faultAt,type:scenario};
      if (scenario==="console") fault.grade=(before.targetGrade??0)>=7.5?0:15;
      const changed=[...plan.events.slice(0,insertion),fault,...plan.events.slice(insertion)];
      ({rows,controller}=await execute(changed,cap));
    }
  }
  const commands=rows.filter(row=>row.command==="incline").map(row=>({at:row.at,grade:row.commandGrade}));
  const release=rows.find(row=>row.stage==="manual" && row.reason);
  // Arming stores the initial deck reading as a reference but emits no incline
  // target. Draw the requested line only after a real simulated step.
  let lastRequested = null;
  const requests = rows.map(row => {
    if (row.command === "incline") lastRequested = row.commandGrade;
    if (row.stage === "manual") lastRequested = null;
    return lastRequested;
  });
  const points=plan.points.map(({lastEvent,...point})=>{
    const index=lastEvent+(insertion>=0 && lastEvent>=insertion-1 ? 1:0);
    const row=rows[index];
    return {...point,requestedGrade:requests[index]??null, stage:row?.stage??"manual"};
  });
  return {points,commands,controller,durationSeconds:plan.durationSeconds,trackedMeters:plan.trackedMeters,estimatedMeters:plan.estimatedMeters,
    acquired:rows.some(row=>row.command==="acquire"),releasedAt:release?.at??null,releaseReason:release?.reason??null,faultAt,
    faultSkipped:scenario!=="recorded" && insertion<0,afterFaultCommands:insertion<0?0:rows.slice(insertion+1).filter(row=>row.command==="incline").length};
}
