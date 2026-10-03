// Panel "Settings": every control writes straight to the settings document
// (there is no Save). Units and the session switches are immediate; the
// bodyweight field commits on blur or Enter; the pause switch starts or
// ends a pause on settings.game.pauses and shows the allowance it draws on.
import type { KeyboardEvent } from "react";
import { Notice } from "../../design/Notice";
import { Panel } from "../../design/Panel";
import { SegmentedControl } from "../../design/SegmentedControl";
import { Stepper } from "../../design/Stepper";
import { Switch } from "../../design/Switch";
import { TextInput } from "../../design/TextInput";
import { useAppData } from "../../data/useAppData";
import type { DateKey } from "../../domain/dates";
import type { UnitSystem } from "../../domain/units";
import { bodyweightKgFrom } from "../onboarding/plan";
import styles from "./ProfileScreen.module.css";
import {
  PAUSE_DAYS, PAUSE_REASON_TEXT, PAUSE_REASONS, UNIT_OPTIONS,
  bodyweightDisplay, bodyweightLabel, coveringPause, pausesEnded, pausesStarted, pausesWithReason, type PauseReason,
} from "./profileView";

export interface SettingsPanelProps {
  todayKey: DateKey;
  /** Protected days left in the rolling 90-day allowance (illness and pauses share it). */
  allowance: number;
}

const REST_STEP = 15;
const REST_MIN = 30;
const REST_MAX = 300;

export function SettingsPanel({ todayKey, allowance }: SettingsPanelProps) {
  const { state, patchSettings } = useAppData();
  const { settings } = state;
  const { units, session } = settings;
  const pause = coveringPause(settings.game.pauses, todayKey);

  /** The typed number in the athlete's units → kg to 0.1; blank clears it. */
  const commitBodyweight = (text: string) => {
    const blank = text.trim() === "";
    const kg = blank ? undefined : bodyweightKgFrom(text, units);
    if (!blank && kg === undefined) return;
    if (kg === settings.bodyweightKg) return;
    patchSettings({ bodyweightKg: kg, game: { bodyweightKg: kg } });
  };
  const onBodyweightKey = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    commitBodyweight(e.currentTarget.value);
  };

  return (
    <Panel title="Settings">
      <div className={styles.stack}>
        <SegmentedControl inline label="Units" options={[...UNIT_OPTIONS]} value={units} onChange={(v) => patchSettings({ units: v as UnitSystem })} />
        <TextInput
          key={`${units}:${settings.bodyweightKg ?? ""}`}
          id="profile-bodyweight"
          label={bodyweightLabel(units)}
          inputMode="decimal"
          placeholder={units === "imperial" ? "e.g. 176" : "e.g. 80"}
          defaultValue={bodyweightDisplay(settings.bodyweightKg, units)}
          hint="Used for the STR stat."
          onBlur={(e) => commitBodyweight(e.target.value)}
          onKeyDown={onBodyweightKey}
        />
        <Switch label="Rest-timer sound" checked={session.sound} onChange={(on) => patchSettings({ session: { sound: on } })} />
        <Switch label="Haptics" checked={session.haptics} onChange={(on) => patchSettings({ session: { haptics: on } })} />
        <Switch label="Exercise cues" sublabel="A form note under each exercise in the runner." checked={session.cues} onChange={(on) => patchSettings({ session: { cues: on } })} />
        <Stepper label="Default rest" unit="sec" value={session.restSeconds} step={REST_STEP} min={REST_MIN} max={REST_MAX} onChange={(v) => patchSettings({ session: { restSeconds: v } })} />
        <Switch
          label="Pause training"
          sublabel={`${allowance} of ${PAUSE_DAYS} protected days left this quarter`}
          checked={pause !== undefined}
          onChange={(on) => patchSettings({ game: { pauses: on ? pausesStarted(settings.game.pauses, todayKey, "sick") : pausesEnded(settings.game.pauses, todayKey) } })}
        />
        {pause ? (
          <>
            <SegmentedControl inline label="Reason" options={[...PAUSE_REASONS]} value={pause.reason} onChange={(v) => patchSettings({ game: { pauses: pausesWithReason(settings.game.pauses, todayKey, v as PauseReason) } })} />
            <Notice tag="PAUSED">Training paused for {PAUSE_REASON_TEXT[pause.reason]}. {allowance} pause days left this quarter.</Notice>
          </>
        ) : null}
      </div>
    </Panel>
  );
}
