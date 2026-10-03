// Panel "Data": export (a JSON download), import (a hidden file input, then
// the preview sheet) and the danger button behind a danger Dialog. The
// import never touches the store until the sheet's Import.
import { useContext, useRef, useState, type ChangeEvent } from "react";
import { AuthContext } from "../../auth/authContext";
import { useHashRoute } from "../../app/useHashRoute";
import { useToast } from "../../app/ToastProvider";
import { Button } from "../../design/Button";
import { Dialog } from "../../design/Dialog";
import { Panel } from "../../design/Panel";
import { clearDemo } from "../../data/guestFlags";
import { buildExport, exportFileName, mergeImport, newDayKeys, parseImport, type ImportMode, type ImportParse } from "../../data/legacyImport";
import { useAppData } from "../../data/useAppData";
import type { DateKey } from "../../domain/dates";
import { ImportSheet } from "./ImportSheet";
import styles from "./ProfileScreen.module.css";

export interface DataPanelProps {
  todayKey: DateKey;
}

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsText(file);
  });
}

function downloadJson(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

const describe = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function DataPanel({ todayKey }: DataPanelProps) {
  const { state, exportSnapshot, importSnapshot, reset } = useAppData();
  const guest = useContext(AuthContext)?.status !== "signed-in";
  const { sheet, openSheet, closeSheet, navigate } = useHashRoute();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ImportParse | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const exportBackup = () => {
    downloadJson(exportFileName(todayKey), buildExport(exportSnapshot(), new Date().toISOString()));
    toast.show({ tag: "QUEST", text: "Backup saved." });
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    readText(file).then(
      (text) => {
        setPending(parseImport(text));
        openSheet("import");
      },
      (err: unknown) => toast.show({ tag: "ERROR", text: describe(err) }),
    );
  };

  const doImport = async (mode: ImportMode) => {
    if (!pending) return;
    const current = { days: state.days, program: state.program, settings: state.settings };
    const added = mode === "replace" ? pending.counts.days : newDayKeys(current, pending).length;
    setBusy(true);
    try {
      await importSnapshot(mergeImport(current, pending, { mode }));
      toast.show({ tag: "QUEST", text: `Imported ${added} ${added === 1 ? "day" : "days"}.` });
      setPending(null);
      closeSheet();
    } catch (err) {
      toast.show({ tag: "ERROR", text: describe(err) });
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    setConfirmReset(false);
    await reset();
    clearDemo();
    navigate("/", { replace: true });
  };

  return (
    <Panel title="Data">
      <div className={styles.actions}>
        <Button full onClick={exportBackup}>Export backup</Button>
        <Button full onClick={() => fileInput.current?.click()}>Import backup</Button>
        {guest ? <Button full variant="danger" onClick={() => setConfirmReset(true)}>Reset guest data</Button> : null}
      </div>
      <input ref={fileInput} type="file" accept="application/json,.json" hidden tabIndex={-1} aria-label="Backup file" onChange={onFile} />
      <Dialog
        id="reset"
        open={confirmReset}
        danger
        title="Reset guest data?"
        body="Your log, records and titles are removed from this device. There is no undo."
        confirmLabel="Reset"
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => void doReset()}
      />
      {sheet === "import" && pending ? (
        <ImportSheet parsed={pending} added={newDayKeys({ days: state.days }, pending).length} busy={busy} onImport={(mode) => void doImport(mode)} onClose={closeSheet} />
      ) : null}
    </Panel>
  );
}
