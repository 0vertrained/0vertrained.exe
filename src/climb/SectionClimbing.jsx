import { distanceText, gainText } from "./ClimbScene";
import { describeTerrainSections } from "./sectionTerrain";

const percent = value => Math.round(value * 100) + "%";

export function SectionTerrain({course, run, unit, onRepeat}) {
  const sections = describeTerrainSections(course,run);
  if (!sections.length) return null;
  // Compare only terrain for which we observed both profile and belt. Leave
  // sections with too little overlapping evidence out of the recommendation.
  const flatter = sections.filter(s => s.comparableCoverage >= .8 && s.deficit >= 2 &&
    s.deficit >= .15 * s.comparableTarget).sort((a,b)=>b.deficit-a.deficit)[0];
  const canRepeat = section => !!onRepeat && !!course.points?.length && section.end - section.start >= 10;
  return <section className="cl-stack" aria-label="Climbing by section">
    <h3 className="t-h">Climbing by section</h3>
    {run.legacyDeckTotals?.observed > 0 && <p className="t-s c2">{distanceText(run.legacyDeckTotals.observed,unit)} of earlier deck readings survive only in the whole-run total.</p>}
    {flatter && <div className="cl-insight"><strong>Flattest compared with the course · {flatter.name}</strong>
      <p className="t-s">The belt reproduced {gainText(flatter.deficit,unit)} less climbing across the part with both measurements.</p>
      {canRepeat(flatter) && <button type="button" className="btn btn-s btn-sm" onClick={()=>onRepeat(flatter.start,flatter.end)}>Practice this climb</button>}
    </div>}
    <ul className="cl-splits" aria-label="Section climbing estimates">{sections.map(section => <li key={section.id}>
      <strong>{section.name}{section.partial ? " · partial" : ""}</strong>
      <p className="t-s c2">{distanceText(section.start,unit)}–{distanceText(section.end,unit)}</p>
      <p className="t-s">{section.profileMeters > 0 ? "Course ascent " + gainText(section.targetAscent,unit) +
        (section.profileCoverage < .995 ? " across " + percent(section.profileCoverage) + " with elevation" : "") : "Course elevation unavailable"}{" · "}
        {section.beltMeters > 0 ? "Belt ascent estimate " + gainText(section.beltAscent,unit) : "Belt ascent unmeasured"}</p>
      <p className="t-s c2">{percent(section.coverage)} of distance had belt distance and deck incline
        {section.coverage < .995 && " · " + distanceText(section.reachedMeters-section.beltMeters,unit) + " unmeasured"}
        {section.comparableTarget > 0 && " · " + percent(section.comparableBelt/section.comparableTarget) + " of course ascent reproduced on the measured portion"}
        {section.cueMeters > 0 && " · " + percent(section.cueMatchedMeters/section.cueMeters) + " of comparable distance within one percentage point of course grade"}
        {section.cappedMeters >= 1 && " · " + distanceText(section.cappedMeters,unit) + " above your incline cap"}
        {section.cappedMeters >= 1 && section.capProfileMeters >= section.profileMeters - .02 &&
          " · " + gainText(section.capTargetAscent,unit) + " course ascent within the cap"}
        {section.downhillCueMeters >= 1 && " · " + distanceText(section.downhillCueMeters,unit) + " of downhill cues"}</p>
      {section.partial && (!flatter || flatter.id !== section.id) && canRepeat(section) &&
        <button type="button" className="btn btn-s btn-sm" onClick={()=>onRepeat(section.start,section.end)}>Repeat attempted section</button>}
    </li>)}</ul>
  </section>;
}
