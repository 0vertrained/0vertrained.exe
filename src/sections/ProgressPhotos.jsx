// src/sections/ProgressPhotos.jsx
// Progress → Body, in the iPhone app: progress photos by pose, newest
// first, kept on this iPhone only (src/photos/progressPhotos.js). Each opens
// full size, and two of a pose compare side by side, the first and the
// latest to start with.

import { useEffect, useRef, useState } from "react";
import { Icon, Seg, Sheet } from "../ui/ledger";
import { POSES, hasProgressPhotos, listPhotos, photoSource, removePhoto, savePhoto } from "../photos/progressPhotos";
import { shortDate } from "./charts";

const DAY_MS = 24 * 60 * 60 * 1000;

function useSource(id, size) {
  const [source, setSource] = useState(null);
  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    photoSource(id, size).then((value) => { if (alive) setSource(value); }).catch(() => {});
    return () => { alive = false; };
  }, [id, size]);
  return id ? source : null;
}

function Photo({ id, size = "thumb", alt, style }) {
  const source = useSource(id, size);
  return source
    ? <img src={source} alt={alt} style={{ display: "block", width: "100%", borderRadius: 8, objectFit: "cover", background: "var(--sunk)", ...style }} />
    : <div role="img" aria-label={alt} style={{ width: "100%", borderRadius: 8, background: "var(--sunk)", aspectRatio: "3 / 4", ...style }} />;
}

function weeksApart(before, after) {
  const days = Math.round((new Date(`${after}T12:00:00`) - new Date(`${before}T12:00:00`)) / DAY_MS);
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"} apart`;
  return `${Math.round(days / 7)} weeks apart`;
}

function Compare({ photos, onClose }) {
  const [beforeId, setBeforeId] = useState(photos[0]?.id);
  const [afterId, setAfterId] = useState(photos[photos.length - 1]?.id);
  const before = photos.find((photo) => photo.id === beforeId) || photos[0];
  const after = photos.find((photo) => photo.id === afterId) || photos[photos.length - 1];
  const option = (photo) => <option key={photo.id} value={photo.id}>{shortDate(photo.date)}</option>;
  return (
    <Sheet open title="Side by side" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          <label className="field"><span className="lbl">Before</span><select className="input" value={before.id} onChange={(event) => setBeforeId(event.target.value)}>{photos.map(option)}</select></label>
          <label className="field"><span className="lbl">After</span><select className="input" value={after.id} onChange={(event) => setAfterId(event.target.value)}>{photos.map(option)}</select></label>
          <Photo id={before.id} size="full" alt={`Before, ${shortDate(before.date)}`} />
          <Photo id={after.id} size="full" alt={`After, ${shortDate(after.date)}`} />
        </div>
        <p className="t-s c2">{before.date === after.date ? "The same day." : weeksApart(before.date < after.date ? before.date : after.date, before.date < after.date ? after.date : before.date)}</p>
      </div>
    </Sheet>
  );
}

function Viewer({ photo, onClose, onRemoved }) {
  const [asking, setAsking] = useState(false);
  const label = `${POSES.find((pose) => pose.value === photo.pose)?.label || "Photo"}, ${shortDate(photo.date)}`;
  return (
    <Sheet open title={label} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Photo id={photo.id} size="full" alt={label} />
        {asking ? (
          <div className="banner" role="alert" style={{ flexDirection: "column", gap: 8 }}>
            <p>Delete this photo? It’s only on this iPhone, so it can’t be brought back.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn btn-s btn-sm" onClick={async () => { await removePhoto(photo.id).catch(() => {}); onRemoved(); }}>Delete</button>
              <button type="button" className="btn btn-g btn-sm" onClick={() => setAsking(false)}>Keep it</button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-g btn-sm" onClick={() => setAsking(true)} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>Delete photo</button>
        )}
      </div>
    </Sheet>
  );
}

export function ProgressPhotos({ todayKey, showToast }) {
  const available = hasProgressPhotos();
  const [photos, setPhotos] = useState([]);
  const [pose, setPose] = useState("front");
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [comparing, setComparing] = useState(false);
  const input = useRef(null);

  // Bumped to read the list again after a change.
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((count) => count + 1);
  useEffect(() => {
    if (!available) return undefined;
    let alive = true;
    listPhotos().then((list) => { if (alive) setPhotos(list); }).catch(() => {});
    return () => { alive = false; };
  }, [available, version]);

  if (!available) return null;
  const ofPose = photos.filter((photo) => photo.pose === pose);
  const newestFirst = [...ofPose].reverse();

  const add = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      await savePhoto(file, { date: todayKey, pose });
      reload();
      showToast?.("Photo kept on this iPhone");
    } catch {
      showToast?.("That photo couldn’t be kept. Try another.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <section aria-labelledby="photos-title" data-testid="progress-photos" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 id="photos-title" className="t-h">Progress photos</h2>
      <p className="t-s c2">Kept on this iPhone only. They’re never uploaded or shared.</p>
      <Seg label="Pose" options={POSES} value={pose} onChange={setPose} />
      <input ref={input} type="file" accept="image/*" hidden onChange={(event) => add(event.target.files?.[0])} aria-hidden="true" tabIndex={-1} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-s btn-sm" aria-disabled={busy || undefined} onClick={() => !busy && input.current?.click()}>
          <Icon name="plus" size="s" />{busy ? "Keeping it…" : `Add a ${POSES.find((item) => item.value === pose)?.label.toLowerCase()} photo`}
        </button>
        {ofPose.length >= 2 && <button type="button" className="btn btn-s btn-sm" onClick={() => setComparing(true)}>Side by side</button>}
      </div>
      {newestFirst.length === 0 ? (
        <p className="t-s c2">No {pose} photos yet. Same light, same spot, every few weeks makes them easy to compare.</p>
      ) : (
        <ul style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, listStyle: "none", padding: 0, margin: 0 }}>
          {newestFirst.map((photo) => (
            <li key={photo.id}>
              <button type="button" onClick={() => setViewing(photo)} aria-label={`Open the ${photo.pose} photo from ${shortDate(photo.date)}`} style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%", textAlign: "left" }}>
                <Photo id={photo.id} alt="" style={{ aspectRatio: "3 / 4" }} />
                <span className="t-c c2">{shortDate(photo.date)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {viewing && <Viewer photo={viewing} onClose={() => setViewing(null)} onRemoved={() => { setViewing(null); reload(); showToast?.("Photo deleted"); }} />}
      {comparing && ofPose.length >= 2 && <Compare photos={ofPose} onClose={() => setComparing(false)} />}
    </section>
  );
}

export default ProgressPhotos;
