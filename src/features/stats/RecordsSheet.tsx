// Every record row, one per movement, newest first. Close is the way out.
import { Sheet } from "../../design/Sheet";
import type { RecordRow } from "./statsView";
import { RecordList } from "./StatsRows";

export interface RecordsSheetProps {
  rows: RecordRow[];
  onClose: () => void;
}

export function RecordsSheet({ rows, onClose }: RecordsSheetProps) {
  return (
    <Sheet id="records" title="Records" onClose={onClose}>
      <RecordList rows={rows} label="All records" />
    </Sheet>
  );
}
