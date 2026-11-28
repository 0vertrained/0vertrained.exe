// Rows carry one true sensor timestamp, continuity segment, belt counter,
// speed and incline. Legacy/native split packets can have separate timestamps.
// Null fields stay unknown. Only this compact block is saved in the local run.
const LIMIT = 6000, BREAK_LIMIT = 254, PERIOD = 1000, STALE = 5000;
const fields = [["distanceMeters","distanceAt"],["speedMps","speedAt"],["inclinePercent","inclineAt"]];
const clean = x => typeof x === "string" ? x.replace(/\s+/g," ").slice(0,120).trim() : "";

export class WorkoutBeltCapture {
  constructor(run) {
    this.id=run.id;this.startedAt=run.startedAt;
    const previous=run.beltReplay;
    this.data=previous?.version===1 && Array.isArray(previous.rows) && Array.isArray(previous.breaks) ? previous : {version:1,rows:[],breaks:[],transmitter:{},truncated:false};
    this.segment=this.data.rows.at(-1)?.[1] || 0;
    this.after=this.startedAt; this.connection=null; this.latest=0; this.counter=null; this.seen=[]; this.kept=[];
    this.pendingResume=Boolean(this.data.rows.length);
  }
  interrupt(kind, now) {
    if (!this.data.rows.length || this.data.truncated) return;
    if (this.data.breaks.length>=BREAK_LIMIT) {this.data={...this.data,truncated:true};return;}
    const offset=Math.max(now-this.startedAt,this.data.rows.at(-1)?.[0]??0,this.data.breaks.at(-1)?.[0]??0);
    const last=this.data.breaks.at(-1);
    if (!last || last[0]!==offset || last[1]!==kind) this.data={...this.data,breaks:[...this.data.breaks,[offset,kind]]};
    this.segment++;this.after=this.startedAt+offset;this.latest=0;this.counter=null;this.seen=[];this.kept=[];
  }
  record(packet, now=Date.now()) {
    if (this.data.truncated || !packet) return;
    if (packet.status!=="connected" && !(packet.status==null && packet.fresh===true)) {
      if (this.connection!==null) {this.interrupt("disconnect",now);this.connection=null;}
      return;
    }
    const conn=packet.connectionId || packet.report?.startedAt || "linked";
    if (this.device && packet.deviceId && this.device!==packet.deviceId) {
      this.data={...this.data,truncated:true,reason:"transmitterChanged"};return;
    }
    this.device ||= packet.deviceId;
    if (this.pendingResume) {this.interrupt("gap",now);this.pendingResume=false;}
    if (this.connection!==null && conn!==this.connection) this.interrupt("disconnect",now);
    this.connection=conn;
    const entries=new Map();
    fields.forEach(([key,clock],i)=>{
      const item=packet.report?.metrics?.[key];
      const at=item?.at ?? packet[clock], value=item?.value ?? packet[key];
      if (!Number.isFinite(at) || !Number.isFinite(value) || at<this.after || at>now || now-at>STALE || at<=(this.seen[i]??-Infinity)) return;
      const vals=entries.get(at) || [null,null,null];vals[i]=value;entries.set(at,vals);
    });
    for (const [at,values] of [...entries].sort(([a],[b])=>a-b)) {
      if (this.data.truncated || at<this.startedAt+(this.data.rows.at(-1)?.[0]||0)) continue;
      if (this.latest && at-this.latest>=STALE) this.interrupt("gap",at);
      if (values[0]!==null && this.counter!==null && values[0]<this.counter) this.interrupt("reset",at);
      this.latest=at;
      if (values[0]!==null) this.counter=values[0];
      const saved=values.map((v,i)=>{
        if(v===null)return null;
        this.seen[i]=at;
        if(at-(this.kept[i]??-Infinity)<PERIOD)return null;
        this.kept[i]=at;return v;
      });
      if(saved.every(v=>v===null))continue;
      const previous=this.data.rows.at(-1), offset=at-this.startedAt;
      const same=previous && previous[0]===offset && previous[1]===this.segment;
      if (!same && this.data.rows.length>=LIMIT) {this.data={...this.data,truncated:true};break;}
      const row=[offset,this.segment,...saved.map((v,i)=>v??(same?previous[i+2]:null))];
      const rows=same ? [...this.data.rows.slice(0,-1),row] : [...this.data.rows,row];
      const identity={...this.data.transmitter};
      for(const [key,value] of Object.entries({name:packet.report?.deviceName || packet.deviceName,manufacturer:packet.report?.manufacturer,model:packet.report?.model,firmware:packet.report?.firmware})) {
        if(clean(value))identity[key]=clean(value);
      }
      this.data={...this.data,rows,transmitter:identity};
    }
  }
}

export function workoutReplayCheck({course,run,dateKey}={}) {
  const block=run?.beltReplay;
  if (!run?.id || !["finished","partial"].includes(run.status) || !Number.isFinite(run.startedAt) || !Number.isFinite(run.endedAt) ||
      block?.version!==1 || !Array.isArray(block.rows) || !block.rows.length || block.rows.length>LIMIT || !Array.isArray(block.breaks)) return null;
  const samples=block.rows.flatMap(row=>{
    if(!Array.isArray(row)||!Number.isFinite(row[0])||row[0]<0 || run.startedAt+row[0]>run.endedAt || !Number.isInteger(row[1]))return [];
    const sample={at:run.startedAt+row[0],segment:row[1],phase:"observe"};
    fields.forEach(([key],index)=>{if(Number.isFinite(row[2+index]))sample[key]=row[2+index];});
    return fields.some(([key])=>Number.isFinite(sample[key])) ? [sample] : [];
  });
  if (!samples.length)return null;
  const startedAt=run.startedAt, endedAt=block.truncated ? samples.at(-1).at : run.endedAt;
  const markers=[{at:startedAt,kind:"baseline"},...block.breaks.slice(0,BREAK_LIMIT).filter(b=>Array.isArray(b)&&Number.isFinite(b[0])&&b[0]>=0&&startedAt+b[0]<=endedAt)
    .map(([offset,kind])=>({at:startedAt+offset,kind})),{kind:"finish",at:endedAt,note:block.reason==="transmitterChanged" ? "The transmitter changed. Replay ends with the original machine’s readings." : block.truncated ? "Capture limit reached. Replay ends at the last retained reading." : "Recorded during the timed indoor climb. Each signal is retained at most once per second within a continuous segment."}];
  let interval=0, intervals=0, longest=null;
  for(let i=1;i<samples.length;i++)if(samples[i].segment===samples[i-1].segment){const dt=samples[i].at-samples[i-1].at;interval+=dt;intervals++;longest=Math.max(longest??0,dt);}
  // Only an athlete-supplied name identifies the physical machine. The BLE
  // model can identify a separate adapter (for example, FitSwitch).
  return {id:"workout-"+run.id,origin:"workout",version:1,name:"Indoor climb · "+(course?.name||"Treadmill run"),physicalMachine:clean(run.physicalMachine)||"Physical treadmill unverified",
    transmitter:block.transmitter || {},courseRevision:run.courseRevision,dateKey,startedAt,endedAt,outcome:run.status==="finished"&&!block.truncated?"completed":"partial",truncated:Boolean(block.truncated),
    samples,markers,stats:{packets:samples.length,durationMs:endedAt-startedAt,intervals,meanIntervalMs:intervals?interval/intervals:null,longestGapMs:longest,interruptions:markers.length-2,
      baselineGrade:null,observedGrade:null,gradeResponse:"unknown"}};
}
