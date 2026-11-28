import { useEffect, useState } from "react";
import { copyToClipboard } from "../clipboard";

const number = (value, digits = 1) => value.toLocaleString(undefined, {maximumFractionDigits:digits});
const unit = (symbol, digits) => value => `${number(value, digits)} ${symbol}`;
const speed = value => unit("km/h", 2)(value * 3.6);
const duration = seconds => `${Math.floor(Math.round(seconds) / 60)}:${String(Math.round(seconds) % 60).padStart(2,"0")}`;
const metricDefinitions = [
  ["speedMps", "Belt speed", speed], ["distanceMeters", "Belt distance", unit("m", 1)], ["inclinePercent", "Deck incline", unit("%", 1)],
  ["averageSpeedMps", "Average speed", speed], ["rampAngleDegrees", "Ramp angle", unit("°")],
  ["ascentMeters", "Ascent", unit("m")], ["descentMeters", "Descent", unit("m")],
  ["paceSecondsPerKm", "Pace", v => duration(v) + " /km"], ["averagePaceSecondsPerKm", "Average pace", v => duration(v) + " /km"],
  ["energyKcal", "Energy", unit("kcal")], ["energyKcalPerHour", "Energy per hour", unit("kcal/h")], ["energyKcalPerMinute", "Energy per minute", unit("kcal/min")],
  ["heartRateBpm", "Heart rate", unit("bpm", 0)], ["metabolicEquivalent", "Metabolic equivalent", unit("MET")],
  ["elapsedSeconds", "Elapsed time", duration], ["remainingSeconds", "Remaining time", duration],
  ["beltForceNewtons", "Belt force", unit("N")], ["powerWatts", "Power", unit("W", 0)],
];
const scanStates = {
  idle: "Ready to scan", scanning: "Scanning nearby machines…", unavailable: "Bluetooth unavailable",
  interrupted: "Scan interrupted", empty: "No matching machine found in this scan", found: "Scan found a matching broadcast",
};
const deviceStates = {
  connecting: "Connecting to the selected machine", checking: "Checking the machine’s services", receiving: "Treadmill data received",
  incompatible: "Treadmill stream unavailable", failed: "Connection check failed", disconnected: "Disconnected · last check",
};
const subscriptionStates = {
  unchecked:"Unchecked", pending:"Waiting for stream", subscribed:"Subscribed", readOnly:"Read only", failed:"Subscription failed", unsupported:"Stream unavailable",
};
const featureStates = {
  unchecked:"Unchecked", pending:"Reading", read:"Read successfully", failed:"Read failed", unsupported:"Unavailable",
};
const discoveryLabels = {advertisedFTMS:"FTMS advertised",connectedFTMS:"Connected FTMS service",nameMatch:"Broadcast name matched"};
const signal = value => value === true ? "Detected" : value === false ? "Absent" : "Unchecked";
const advertised = value => value === true ? "Advertised" : value === false ? "Not advertised" : "Unverified";
const clean = value => typeof value === "string" && value.trim() ? value.replace(/\s+/g," ").slice(0,120).trim() : null;
const validAt = t => Number.isFinite(t) && t > 0;

function age(at, now) {
  if (!validAt(at)) return "Time unknown";
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 1) return "Just now";
  if (seconds < 60) return `${seconds} s ago`;
  if (seconds < 3600) return `${Math.floor(seconds/60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds/3600)} h ago`;
  return `${Math.floor(seconds/86400)} d ago`;
}

function controlVerdict(report) {
  if (report.serviceFound === false || report.inclineTargets === false) return "No standard incline control reported by this connection.";
  const control = [report.controlPointFound,report.controlPointWritable,report.controlPointIndicates];
  if (report.inclineTargets === true) {
    if (control.every(value => value === true)) return "Advertises standard incline control. Physical response was not tested.";
    if (control.includes(false)) return "Advertises incline targets, but no usable control point was found.";
  }
  if (control.includes(false)) return "No usable standard incline control point was found on this connection.";
  return "Standard incline control has not been determined.";
}

function formatReading(key, value, format, distanceUnit) {
  if (distanceUnit !== "mi") return format(value);
  if (key === "distanceMeters") return unit("mi",3)(value/1609.344);
  if (key === "speedMps" || key === "averageSpeedMps") return unit("mph",2)(value*3600/1609.344);
  if (key === "paceSecondsPerKm" || key === "averagePaceSecondsPerKm") return duration(value*1.609344) + " /mi";
  if (key === "ascentMeters" || key === "descentMeters") return unit("ft",1)(value/0.3048);
  return format(value);
}

function reportContent(reading, now, distanceUnit) {
  const {scan, report} = reading;
  const rows = [];
  if (scan && scan.state !== "idle") {
    rows.push(["Search", scan.mode === "peloton" ? "FTMS or Peloton broadcast name" : "Bluetooth Fitness Machine Service (FTMS)"]);
    rows.push(["Scan result", scanStates[scan.state] || "Unknown"]);
    if (Number.isInteger(scan.found)) rows.push(["Candidates", String(scan.found)]);
  }
  const reason = clean(report?.message || reading.message);
  if (reason) rows.push(["Status detail",reason]);
  if (!report) {
    if (scan?.state === "empty") rows.push(["Incline control check","Incline control could not be checked without a connection."]);
    return {rows, metrics:[]};
  }
  rows.push(["Machine", clean(report.deviceName) || "Unnamed machine"], ["Connection", deviceStates[report.state] || "Unchecked"]);
  if (discoveryLabels[report.discovery]) rows.push(["Discovery", discoveryLabels[report.discovery]]);
  for (const [field,label] of [["manufacturer","Manufacturer"],["model","Model"],["firmware","Firmware"]]) rows.push([label, clean(report[field]) || "Unreported"]);
  rows.push(["FTMS service",signal(report.serviceFound)], ["Treadmill Data characteristic",signal(report.treadmillDataFound)],
    ["Treadmill stream",subscriptionStates[report.subscription] || "Unchecked"], ["Feature flags",featureStates[report.featureRead] || "Unchecked"],
    ["Speed targets",advertised(report.speedTargets)], ["Incline targets",advertised(report.inclineTargets)], ["Control point",signal(report.controlPointFound)]);
  if (typeof report.controlPointWritable === "boolean") rows.push(["Control point writes",signal(report.controlPointWritable)]);
  if (typeof report.controlPointIndicates === "boolean") rows.push(["Control point indications",signal(report.controlPointIndicates)]);
  rows.push(["Incline control check",controlVerdict(report)]);
  const range = report.inclineRange;
  if (range && [range.min,range.max,range.step].every(Number.isFinite)) rows.push(["Incline range",`${number(range.min)}% to ${number(range.max)}% in ${number(range.step)}% steps`]);
  const qualified = report.modelQualified;
  rows.push(["0vertrained auto incline", qualified === true || reading.autoIncline === true ? "Qualified model and firmware" : qualified === false ? "Model and firmware unqualified · manual incline" : "Qualification unverified · manual incline"]);
  if (Number.isInteger(report.sampleCount)) rows.push(["Valid data packets",String(report.sampleCount)]);
  if (validAt(report.lastSampleAt)) rows.push(["Last valid packet",age(report.lastSampleAt,now)]);
  if (report.malformedCount > 0) rows.push(["Malformed packets",String(report.malformedCount)]);
  const metrics = metricDefinitions.flatMap(([key,label,format], index) => {
    const record = report.metrics?.[key], flag = report.advertisedMetrics?.[key], observed = Number.isFinite(record?.value);
    if (index > 2 && !observed && flag !== true) return [];
    return [{key,label,advertised:key === "speedMps" ? "No FTMS flag" : advertised(flag), observed: observed ? formatReading(key,record.value,format,distanceUnit) : "No reading", age: observed ? age(record.at,now) : ""}];
  });
  return {rows, metrics};
}

function distanceAdvice(report) {
  if (report.state === "disconnected") return "Reconnect to use treadmill distance, or choose Watch indoor distance or console readings.";
  if (report.state === "failed" || report.state === "incompatible") return "Use Watch indoor distance or enter console readings to run this climb.";
  if (Number.isFinite(report.metrics?.distanceMeters?.value)) return "Belt distance received. During a climb, choose Treadmill telemetry as the distance source.";
  if (Number.isFinite(report.metrics?.speedMps?.value)) return "Belt speed received. Race the Climb can estimate distance from fresh speed readings.";
  return "Use the treadmill normally and check here for belt speed or distance. Either reading can move you along the climb.";
}

function MetricTable({metrics}) {
  return <table className="cl-signal-table"><thead><tr><th scope="col">Reading</th><th scope="col">Machine flag</th><th scope="col">Last seen</th></tr></thead>
    <tbody>{metrics.map(m=><tr key={m.key}><th scope="row">{m.label}</th><td>{m.advertised}</td>
      <td>{m.observed}{m.age && <small>{m.age}</small>}</td></tr>)}</tbody></table>;
}

export function TreadmillReport({reading,distanceUnit="km"}) {
  const {scan,report} = reading;
  const [now,setNow] = useState(Date.now);
  const [copied,setCopied] = useState(false), [manual,setManual] = useState("");
  const hasSamples = Boolean(Object.keys(report?.metrics || {}).length) || validAt(report?.lastSampleAt);
  useEffect(()=>{
    if (!hasSamples) return;
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return ()=>clearInterval(timer);
  },[hasSamples]);
  if (!report && (!scan || scan.state === "idle")) return null;
  const {rows,metrics} = reportContent(reading,now,distanceUnit);
  const copy = async () => {
    const captured = Date.now(), snapshot = reportContent(reading,captured,distanceUnit);
    const text = ["0vertrained treadmill compatibility report", new Date(captured).toISOString(), ...snapshot.rows.map(([label,value])=>`${label}: ${value}`),
      ...snapshot.metrics.map(m=>`${m.label}: ${m.advertised}; ${m.key === "heartRateBpm" && m.age ? "Signal received" : m.observed}${m.age ? ` (${m.age})` : ""}`)].join("\n");
    if (await copyToClipboard(text)) {setCopied(true);setManual("");} else {setCopied(false);setManual(text);}
  };
  const identity = rows.filter(([key])=>["Manufacturer","Model","Firmware"].includes(key));
  return <section className="cl-report" aria-label="Treadmill compatibility report"><h3 className="t-h">Compatibility report</h3>
    {!report && <p className="t-s" role="status">{scanStates[scan.state] || "Checking nearby machines"}</p>}
    {!report && scan.state === "empty" && <p className="t-s c2">An empty scan only describes what the phone could see. Wake the console, open its Bluetooth settings and scan again. You can also use Watch indoor distance or enter console readings.</p>}
    {!report && scan.found > 0 && <p className="t-s c2">Select your machine to check its services and listen for treadmill data.</p>}
    {report && <><p className="t-s"><strong>{clean(report.deviceName) || "Unnamed machine"}</strong> · {deviceStates[report.state] || "Checking"}</p>
      <p className="t-s c2">{distanceAdvice(report)}</p>
      {identity.some(([,value])=>value !== "Unreported") && <p className="t-s c2">{identity.filter(([,value])=>value !== "Unreported").map(([label,value])=>label + " " + value).join(" · ")}</p>}
      <p className="t-s"><strong>Incline control</strong> · {controlVerdict(report)}<br/>0vertrained auto incline · {rows.find(([key])=>key === "0vertrained auto incline")[1]}</p>
    </>}
    {report?.message && report.message !== reading.message && <p className="t-s c2">{report.message}</p>}
    {!!metrics.length && <><h4>Last machine readings</h4>
      {validAt(report.lastSampleAt) && <p className="t-s c2">Last valid data packet · {age(report.lastSampleAt,now)}</p>}
      <MetricTable metrics={metrics.slice(0,3)}/>
      {metrics.length > 3 && <details><summary>Additional readings ({metrics.length-3})</summary><MetricTable metrics={metrics.slice(3)}/></details>}
    </>}
    {report && <details><summary>Machine details</summary><dl className="cl-report-facts">{rows.map(([key,val])=><div key={key}><dt>{key}</dt><dd>{val}</dd></div>)}</dl></details>}
    {scan?.state !== "scanning" && <button type="button" className="btn btn-s" onClick={copy}>Copy compatibility report</button>}
    {copied && <p className="t-s" role="status">Report copied.</p>}
    {manual && <label className="field"><span className="lbl">Select and copy the report</span><textarea className="input" rows={6} value={manual} readOnly onFocus={e=>e.target.select()}/></label>}
  </section>;
}
