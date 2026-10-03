// Panel "Account": for a guest, the way in (Sign in / Create account) and a
// line on what stays on the device; for an account, who is signed in, Sign
// out (with a warning when days are still queued) and Delete account behind
// a danger Dialog. Renders nothing when the build has no backend.
import { useContext, useState } from "react";
import { AuthContext } from "../../auth/authContext";
import { Button } from "../../design/Button";
import { Dialog } from "../../design/Dialog";
import { Panel } from "../../design/Panel";
import { useAppData } from "../../data/useAppData";
import { useHashRoute } from "../../app/useHashRoute";
import { useToast } from "../../app/ToastProvider";
import styles from "./ProfileScreen.module.css";

export function AccountPanel() {
  const auth = useContext(AuthContext);
  const { state } = useAppData();
  const { openSheet, navigate } = useHashRoute();
  const toast = useToast();
  const [confirm, setConfirm] = useState<"signout" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  if (!auth || auth.status === "unavailable") return null;

  const signOut = async () => {
    setConfirm(null);
    setBusy(true);
    await auth.signOut();
    setBusy(false);
    navigate("/", { replace: true });
  };

  const deleteAccount = async () => {
    setConfirm(null);
    setBusy(true);
    const result = await auth.deleteAccount();
    setBusy(false);
    if (!result.ok) {
      toast.show({ tag: "ERROR", text: result.error });
      return;
    }
    navigate("/", { replace: true });
  };

  if (auth.status !== "signed-in" || !auth.user) {
    return (
      <Panel title="Account">
        <p className="ot-body ot-ink-2 ot-m0">Guest mode: everything stays on this device. Sign in to keep it online and on every device.</p>
        <div className={styles.actions}>
          <Button full onClick={() => openSheet("auth")}>Sign in</Button>
        </div>
      </Panel>
    );
  }

  const queued = state.sync.queued;
  return (
    <Panel title="Account">
      <p className="ot-body ot-m0">Signed in as <span className="ot-body-strong">{auth.user.username}</span>.</p>
      <div className={styles.actions}>
        <Button full variant="ghost" disabled={busy} onClick={() => (queued > 0 ? setConfirm("signout") : void signOut())}>Sign out</Button>
        <Button full variant="danger" disabled={busy} onClick={() => setConfirm("delete")}>Delete account</Button>
      </div>
      <Dialog
        id="signout"
        open={confirm === "signout"}
        title="Sign out while offline?"
        body={`${queued} ${queued === 1 ? "day is" : "days are"} not synced yet. They stay on this device until you sign in again here.`}
        confirmLabel="Sign out"
        onCancel={() => setConfirm(null)}
        onConfirm={() => void signOut()}
      />
      <Dialog
        id="delete-account"
        open={confirm === "delete"}
        danger
        title="Delete account?"
        body="Your log, records and titles are removed from this device and the server. There is no undo."
        confirmLabel="Delete account"
        onCancel={() => setConfirm(null)}
        onConfirm={() => void deleteAccount()}
      />
    </Panel>
  );
}
