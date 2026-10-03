// Every title tile, unlocked first; tapping an unlocked one features it,
// as on the tab. Close is the way out.
import { Sheet } from "../../design/Sheet";
import type { TitleTile } from "./statsView";
import { TitleGrid } from "./StatsRows";

export interface TitlesSheetProps {
  tiles: TitleTile[];
  unlocked: number;
  total: number;
  onFeature: (title: string) => void;
  onClose: () => void;
}

export function TitlesSheet({ tiles, unlocked, total, onFeature, onClose }: TitlesSheetProps) {
  const title = (
    <>
      Titles <span className="ot-numeral">{unlocked}/{total}</span>
    </>
  );
  return (
    <Sheet id="titles" title={title} onClose={onClose}>
      <TitleGrid tiles={tiles} label="All titles" onFeature={onFeature} />
    </Sheet>
  );
}
