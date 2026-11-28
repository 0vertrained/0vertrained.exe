import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { buildCourse } from "../rehearsal/course";
import RaceRehearsal from "../rehearsal/RaceRehearsal";

vi.mock("../rehearsal/CourseMap", () => ({
  default: ({ onAddPoint, onPickPoint, onInsertCheckpointPoint, points }) => <div aria-label="Test course map">
    {onAddPoint && <button onClick={() => onAddPoint({ lat: 40 + points.length / 100, lon: -105 })}>Tap map to draw</button>}
    {onPickPoint && <button onClick={() => onPickPoint(1)}>Pick second point</button>}
    {onInsertCheckpointPoint && <button onClick={() => onInsertCheckpointPoint(1, { lat: 40.005, lon: -105 })}>Choose mid-segment</button>}
  </div>,
}));

const points = [40, 40.01, 40.02].map(lat => ({ lat, lon: -105 }));
const course = buildCourse({ id: "mesa", name: "Mesa loop", date: "2026-11-29", points, checkpoints: [
  { id: "water", pointIndex: 1, kind: "water", name: "Creek", instruction: "Refill both flasks", targetSeconds: 60 },
  { id: "finish", pointIndex: 2, kind: "finish", name: "Finish", targetSeconds: 120 },
] });
const props = { owner: "athlete-a", program: { Friday: { type: "Run" }, __rehearsal: course }, entries: {}, todayKey: "2026-11-27" };
const click = name => fireEvent.click(screen.getByRole("button", { name }));
const edit = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

it("reindexes checkpoints after map insertion and deliberate removal, moves the finish as the route grows, and saves only on request", async () => {
  const onSaveProgram = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  render(<RaceRehearsal {...props} onSaveProgram={onSaveProgram} />);
  click("Edit course"); click("Choose mid-segment");
  edit("Checkpoint name", "Aid before creek");
  edit("Station type", "aid"); edit("Target elapsed time", "0:30");
  edit("Station instructions", "Water top-up");
  click("Tap map to draw");
  edit("Route point", "2"); click("Remove route point");
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(/Creek/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  click("Remove route point");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove point" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(onSaveProgram).not.toHaveBeenCalled();
  click("Save course");
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByLabelText("Course name").value).toBe("Mesa loop");
  click("Save course");
  await screen.findByRole("button", { name: "Edit course" });
  const saved = onSaveProgram.mock.lastCall[0];
  expect(saved.Friday).toEqual(props.program.Friday);
  expect(saved.__rehearsal.points).toHaveLength(4);
  expect(saved.__rehearsal.checkpoints.map(c => [c.name, c.kind, c.pointIndex])).toEqual([["Aid before creek", "aid", 1], ["Finish", "finish", 3]]);
  expect(saved.__rehearsal.checkpoints[0]).toMatchObject({ targetSeconds: 30, instruction: "Water top-up" });
});

it("imports a GPX draft, restores it after navigation, and clears only after confirmation", async () => {
  const options = { ...props, program: {}, onSaveProgram: vi.fn() };
  const initial = render(<RaceRehearsal {...options} />);
  click("Build course");
  const file = { size: 204, text: async () => '<gpx><rte><name>Canyon trail</name><rtept lat="40" lon="-105"/><rtept lat="40.01" lon="-105"/></rte></gpx>' };
  fireEvent.change(screen.getByLabelText("GPX file"), { target: { files: [file] } });
  await screen.findByDisplayValue("Canyon trail");
  initial.unmount();
  render(<RaceRehearsal {...options} />); click("Build course");
  expect(screen.getByDisplayValue("Canyon trail")).toBeTruthy();
  click("Clear route");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Clear route" }));
  expect(await screen.findByText("0.00 km")).toBeTruthy();
  click("Undo change");
  expect(screen.getByRole("button", { name: /Finish/ })).toBeTruthy();
  expect(options.onSaveProgram).not.toHaveBeenCalled();
});

it("resumes a phone run only for its athlete, records station departure and target deltas, retries saving under one ID", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const start = new Date("2026-11-27T21:00:00Z").getTime();
  vi.setSystemTime(start);
  const onSaveAttempt = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  const view = render(<RaceRehearsal {...props} onSaveAttempt={onSaveAttempt} />);
  click("Start phone rehearsal");
  expect(screen.queryByRole("button", { name: "Edit course" })).toBeNull();
  vi.setSystemTime(start + 65000); click("Mark arrival");
  expect(screen.getByRole("heading", { name: "At Creek" })).toBeTruthy();
  view.rerender(<RaceRehearsal {...props} owner="athlete-b" onSaveAttempt={onSaveAttempt} />);
  expect(screen.queryByRole("button", { name: "Depart station" })).toBeNull();
  view.rerender(<RaceRehearsal {...props} onSaveAttempt={onSaveAttempt} />);
  vi.setSystemTime(start + 80000); click("Depart station");
  vi.setSystemTime(start + 145000); click("Mark finish");
  expect(screen.getByText("Station stop 0:15")).toBeTruthy();
  expect(screen.getByText(/0:25 behind at checkpoint/)).toBeTruthy();
  expect(screen.getByText(/Split 1:20 \/ target 1:00/)).toBeTruthy();
  expect(onSaveAttempt).not.toHaveBeenCalled();
  click("Save rehearsal"); await screen.findByRole("alert");
  click("Save rehearsal");
  await screen.findByRole("region", { name: "Rehearsal history" });
  const [date, attempt] = onSaveAttempt.mock.lastCall;
  expect(date).toBe(props.todayKey);
  expect(attempt.id).toBe(onSaveAttempt.mock.calls[0][1].id);
  expect(attempt.marks[0]).toMatchObject({ checkpointId: "water", elapsedSeconds: 65, departedSeconds: 80, status: "taken" });
  expect(attempt.distanceMeters).toBe(course.distanceMeters);
});

it("shows completed Watch results even after a course has been replaced", () => {
  const attempt = { id: "w", courseId: "older", name: "Watch ridge", distanceMeters: 4000, startedAt: "2026-11-23T09:00:00Z",
    endedAt: "2026-11-23T09:25:00Z", marks: [{ checkpointId: "w", kind: "aid", name: "Station", status: "skipped", meters: 1000, elapsedSeconds: 500 },
      { checkpointId: "end", kind: "finish", name: "Finish line", status: "taken", meters: 4000, targetSeconds: 1520, elapsedSeconds: 1500 }] };
  render(<RaceRehearsal {...props} entries={{ "2026-11-23": { workout: { raceRehearsals: { w: attempt } } } }} />);
  fireEvent.click(screen.getByText(/Watch ridge ·/));
  expect(screen.getByText("Skipped")).toBeTruthy();
  expect(screen.getByText(/0:20 ahead at checkpoint/)).toBeTruthy();
});

it("replaces an unreadable course even when the stored local sketch is also malformed", async () => {
  const broken = { id: "missing-route", points: [null], checkpoints: null };
  localStorage.setItem("0vt.courseDraft.v1.athlete-a", JSON.stringify({ base: JSON.stringify(broken), draft: { id: "bad", points: {} } }));
  localStorage.setItem("0vt.rehearsal.current.v1.athlete-a", JSON.stringify({ dateKey: props.todayKey, course: broken, attempt: { id: "broken" } }));
  const save = vi.fn().mockResolvedValue(true);
  render(<RaceRehearsal {...props} program={{ ...props.program, __rehearsal: broken }} onSaveProgram={save} />);
  expect(screen.getByRole("heading", { name: "Replace unreadable course" })).toBeTruthy();
  click("Build course"); edit("Course name", "Replacement"); click("Tap map to draw"); click("Tap map to draw"); click("Save course");
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][0].__rehearsal).toMatchObject({ name: "Replacement", checkpoints: [expect.objectContaining({ kind: "finish" })] });
});

it("uses the local date of the actual start when Train stayed open overnight", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 27, 23, 59, 59));
  render(<RaceRehearsal {...props} onSaveAttempt={vi.fn()} />);
  vi.setSystemTime(new Date(2026, 10, 28, 0, 0, 1));
  click("Start phone rehearsal");
  expect(JSON.parse(localStorage.getItem("0vt.rehearsal.current.v1.athlete-a")).dateKey).toBe("2026-11-28");
});
