// One user-initiated, read-only field check. Only public machine identity and
// treadmill movement signals leave this recorder. Bluetooth IDs stay in memory.
const MAX_SAMPLES = 6000, MAX_MARKERS = 256, LONG_INTERVAL = 5000;
const clean = value => typeof value === "string" ? value.replace(/\s+/g," ").trim().slice(0,120) : "";
const capabilityFields = ["serviceFound","treadmillDataFound","inclineTargets","controlPointFound","controlPointWritable","controlPointIndicates","modelQualified"];
const movementFields = ["speedMps","distanceMeters","inclinePercent"];
const terminal = state => ["disconnected","incompatible","failed"].includes(state);
const linked = reading => reading?.status === "connected" && !terminal(reading?.report?.state);

export class GuidedCheckCapture {
  constructor(name, reading, now = Date.now(), id = crypto.randomUUID()) {
    this.result = {version:1,id,physicalMachine:clean(name),transmitter:{name:""},startedAt:now,endedAt:null,outcome:"partial",
      markers:[{at:now,kind:"baseline"}],samples:[],capabilities:{},stats:{packets:0,intervals:0,durationMs:0,meanIntervalMs:null,longestGapMs:null,
        duplicateSnapshots:0,missedPackets:0,interruptions:0,gradeResponse:"unknown",baselineGrade:null,observedGrade:null,responseDelayMs:null}};
    this.phase="baseline"; this.segment=0; this.segmentStart=now; this.paused=false; this.hidden=false;
    this.lastFrame=null; this.sequence=null; this.intervalSum=0; this.lastGrade=null; this.gradeAnchor=null; this.lastCounter=null;
    this.online=linked(reading); this.deviceId=this.online ? reading.deviceId : null; this.connectionId=this.online ? this.attachment(reading) : null;
    this.sequence=this.online ? reading.report?.sampleCount ?? null : null;
    this.initialProbe=reading?.report?.startedAt;
    if (reading?.report) this.identity(reading);
  }
  get finished() { return this.result.endedAt !== null; }
  attachment(reading) { return reading.connectionId || reading.report?.startedAt || null; }
  identity(reading) {
    const {report} = reading;
    if (!report) return;
    const transmitter=this.result.transmitter;
    for (const [key,value] of [["name",report.deviceName || reading.deviceName],["manufacturer",report.manufacturer],["model",report.model],["firmware",report.firmware]]) {
      if (clean(value)) transmitter[key]=clean(value);
    }
    for (const key of capabilityFields) if (typeof report[key] === "boolean") this.result.capabilities[key]=report[key];
  }
  mark(kind, at, note) {
    if (this.finished) return;
    if (this.result.markers.length >= MAX_MARKERS-1) {this.finish(at,"Marker limit reached"); return;}
    const marker={kind,at:Math.max(this.result.markers.at(-1).at,this.result.samples.at(-1)?.at||0,at)};
    if (note) marker.note=clean(note);
    this.result.markers.push(marker);
  }
  boundary(kind, at, note) {
    this.mark(kind,at,note);
    if (this.finished) return false;
    this.segment++; this.segmentStart=this.result.markers.at(-1).at; this.lastFrame=null; this.lastGrade=null; this.lastCounter=null;
    this.result.stats.interruptions++;
    return true;
  }
  setPaused(value, at=Date.now()) {
    if (this.finished || value===this.paused) return;
    this.paused=value; this.boundary(value?"pause":"resume",at);
  }
  setHidden(value, at=Date.now()) {
    if (this.finished || value===this.hidden) return;
    this.hidden=value; this.boundary(value?"background":"foreground",at);
  }
  nextPhase(at=Date.now(), manualGrade) {
    if (this.finished || this.paused || this.hidden || this.phase === "observe") return;
    if (this.phase === "baseline") {
      this.phase="adjust";
      if (this.lastGrade && at-this.lastGrade.at>=0 && at-this.lastGrade.at<=LONG_INTERVAL) {
        this.gradeAnchor={...this.lastGrade,at,segment:this.segment}; this.result.stats.baselineGrade=this.lastGrade.value;
      }
      this.mark("adjust",at,Number.isFinite(manualGrade)?`Console set to ${manualGrade}%`:undefined);
    } else {this.phase="observe";this.mark("observe",at);}
  }
  record(reading, now=Date.now()) {
    if (this.finished || !reading) return;
    if (reading.controlStage && reading.controlStage !== "manual") {this.finish(now,"Automatic incline became active");return;}
    const {report}=reading;
    if (!linked(reading)) {
      if (this.online) {this.online=false;this.sequence=null;this.boundary("disconnect",now);}
      if (!this.deviceId && report && terminal(report.state)) this.identity(reading);
      return;
    }
    if (this.deviceId && reading.deviceId && this.deviceId!==reading.deviceId) {this.finish(now,"A different transmitter was selected");return;}
    this.deviceId ||= reading.deviceId;
    const attachment=this.attachment(reading);
    if (!this.online || (this.connectionId && attachment && this.connectionId!==attachment)) {
      if (this.initialProbe && report?.startedAt!==this.initialProbe) {this.result.transmitter={name:""};this.result.capabilities={};}
      this.online=true;this.sequence=null;this.connectionId=attachment;if(!this.boundary("reconnect",now))return;
    }
    this.connectionId ||= attachment;
    this.identity(reading);
    const sequence=report?.sampleCount, at=report?.lastSampleAt;
    if (!Number.isInteger(sequence) || sequence<1 || !Number.isFinite(at)) return;
    const previousSequence=this.sequence;
    if (previousSequence===sequence) {this.result.stats.duplicateSnapshots++; return;}
    if (previousSequence!==null && sequence<previousSequence && !this.boundary("reset",now,"Packet counter restarted")) return;
    this.sequence=sequence;
    if (this.paused || this.hidden || at<this.segmentStart || at<this.result.startedAt || at>now+1000) return;
    if (this.lastFrame!==null && at<this.lastFrame) {this.boundary("reset",now,"Packet clock went backwards");return;}
    const gap=this.lastFrame===null?null:at-this.lastFrame;
    const missed=previousSequence===null ? 0 : Math.max(0,sequence-previousSequence-1);
    const stats=this.result.stats;
    if (gap!==null) {
      stats.longestGapMs=Math.max(stats.longestGapMs??0,gap);
      if (!missed) {this.intervalSum+=gap;stats.intervals++;stats.meanIntervalMs=this.intervalSum/stats.intervals;}
    }
    if (missed || gap>LONG_INTERVAL) {stats.missedPackets+=missed;if(!this.boundary("gap",at,missed?`${missed} packets missed`:"Long packet interval"))return;}
    // The native report caches fields across notifications. A value belongs to
    // this frame only when its native observation time matches this packet.
    const phase=this.result.markers.findLast(m=>["baseline","adjust","observe"].includes(m.kind) && m.at<=at)?.kind || "baseline";
    const sample={at,segment:this.segment,phase};
    for (const field of movementFields) {
      const metric=report.metrics?.[field];
      if (metric?.at===at && Number.isFinite(metric.value)) sample[field]=metric.value;
    }
    if (Number.isFinite(sample.distanceMeters)) {
      if (this.lastCounter!==null && sample.distanceMeters<this.lastCounter) {
        if(!this.boundary("reset",at,"Belt distance counter restarted"))return;
        sample.segment=this.segment;
      }
      this.lastCounter=sample.distanceMeters;
    }
    if (Number.isFinite(sample.inclinePercent)) {
      this.lastGrade={value:sample.inclinePercent,at};
      if (this.gradeAnchor?.segment===this.segment && at>this.gradeAnchor.at) {
        stats.observedGrade=sample.inclinePercent;
        if (Math.abs(sample.inclinePercent-this.gradeAnchor.value)>=0.0999) {
          stats.gradeResponse="changed";stats.responseDelayMs??=at-this.gradeAnchor.at;
        } else if (stats.gradeResponse!=="changed") stats.gradeResponse="unchanged";
      }
    }
    this.result.samples.push(sample);stats.packets++;this.lastFrame=at;
    if (this.result.samples.length>=MAX_SAMPLES) this.finish(now,"Sample limit reached");
  }
  finish(at=Date.now(), note) {
    if (this.finished) return this.result;
    this.result.endedAt=Math.max(this.result.startedAt,at,this.result.markers.at(-1).at,this.result.samples.at(-1)?.at||0);
    this.result.stats.durationMs=this.result.endedAt-this.result.startedAt;
    const measured = phase => this.result.samples.some(s=>s.phase===phase && movementFields.some(key=>Number.isFinite(s[key])));
    this.result.outcome=!note && this.phase==="observe" && measured("baseline") && measured("observe") ? "completed" : "partial";
    const marker={kind:"finish",at:this.result.endedAt};if(note)marker.note=clean(note);
    this.result.markers.push(marker);return this.result;
  }
}
