// Event seconds are relative to the recording. Expected steps describe virtual commands;
// all deck measurements in each vector are explicit telemetry observations.
const telemetry = (at, speedMps, inclinePercent) => ({type:"telemetry", at, speedMps, inclinePercent});
const goal = (at, grade, sequence) => ({type:"target", at, grade, sequence});
const tick = at => ({type:"tick", at});
const ack = (at, opcode, ok = true) => ({type:"ack", at, opcode, ok});
const event = (at, type) => ({at, type});
const start = [telemetry(0, 3, 0), event(0, "arm")];
const firstStep = [...start, goal(0.2, 8, 1), tick(2.99), tick(3)];
const reasons = {
  expired:"Course target expired.", stale:"Automatic incline released. Check belt",
  timedOut:"The treadmill took too long", rejected:"The treadmill did not accept",
};
const vector = (name, events, commands, stage, options = {}) => ({
  name, events, commands, stage, cap:10, simulateAcknowledgements:true, ...options,
});

const hill = [...firstStep];
for (let step = 1; step <= 3; step++) {
  hill.push(telemetry(step * 3 + 1, 3, step * 2), goal(step * 3 + 1, 8, step + 1), tick(step * 3 + 3));
}
hill.push(telemetry(13, 3, 8), tick(15));

export const inclineReplayVectors = [
  vector("a sustained hill advances after each measured step", hill, [2,4,6,8], "armed"),
  vector("command feedback arrives before its explicit ack", [...start, goal(0.1,8,1), ack(0.2,0), tick(3),
    telemetry(4,3,2), goal(4.1,8,2), ack(4.5,3), tick(6)], [2,4], "acknowledging", {simulateAcknowledgements:false}),
  vector("a newer descent replaces a hill while settling", [...firstStep, goal(3.1,0,4), goal(3.2,12,2),
    telemetry(4,3,2),tick(6)], [2,0], "settling"),
  vector("a cap between machine increments rounds down", [...firstStep, telemetry(4,3,2), goal(4,8,2),tick(6),
    telemetry(7,3,3), goal(7,8,3),tick(9)], [2,3], "armed", {cap:3.2}),
  vector("a duplicate heartbeat cannot keep an old course alive", [...firstStep, telemetry(4,3,2), goal(5,8,1),
    tick(6.2), goal(7,10,2)], [2], "manual", {reason:reasons.expired}),
  vector("speed and grade expire independently", [...firstStep,telemetry(4,null,2),goal(4,8,2),tick(5)],
    [2],"manual",{reason:reasons.stale}),
  vector("a stopped belt releases with fresh timestamps", [...firstStep,telemetry(3.2,0,1)], [2],"manual",{reason:reasons.stale}),
  vector("a console override wins during a pending step", [...firstStep,{at:3.2,type:"console",grade:-0.25},ack(4,3),
    goal(4.1,8,2),tick(5)], [2],"manual",{reason:"The console changed"}),
  vector("an uncommanded deck movement releases a settled deck", [...start,telemetry(1,3,0.3)], [],"manual",
    {reason:"The measured incline changed"}),
  vector("a rejected acquisition requires another connection", [...start,ack(1,0,false),event(2,"arm"),tick(3)], [],
    "manual",{simulateAcknowledgements:false,reason:reasons.rejected}),
  vector("an unmatched acknowledgment releases acquisition", [...start,ack(1,3)], [],"manual",
    {simulateAcknowledgements:false,reason:reasons.rejected}),
  vector("an acknowledgment exactly at the deadline cannot rearm", [...start,goal(1,8,1),ack(1.1,0),tick(3),
    telemetry(5,3,2),goal(5.1,8,2),ack(7,3),tick(8)], [2],"manual",{simulateAcknowledgements:false,reason:reasons.timedOut}),
  vector("a deck that never reaches its command times out", [...firstStep,telemetry(4,3,0),goal(4,8,2),
    telemetry(8,3,0.1),goal(8,8,3),tick(11)], [2],"manual",{reason:reasons.timedOut}),
  vector("arming can retry after missing initial feedback", [event(0,"arm"),telemetry(1,3,null),event(1,"arm"),
    telemetry(2,null,0),event(2,"arm"),goal(3,1.25,1),tick(5),telemetry(5.2,3,1.5)], [1.5],"armed"),
  vector("half-steps and a zero target remain representable", [...start,goal(1,1.25,1), tick(3),telemetry(4,3,1.5),
    goal(4,-5,2), tick(6),telemetry(7,3,0)], [1.5,0],"armed"),
  vector("arming refuses an initial grade above the cap", [telemetry(0,3,11),event(0,"arm"),goal(1,1,1),tick(3)], [],"manual"),
  ...["pause","background","disconnect"].map(type => vector(type+" cancels all later course work", [...firstStep,
    event(3.2,type),telemetry(4,3,2),ack(4,3),goal(4,8,2),event(5,"arm"),tick(6)], [2],"manual")),
];
