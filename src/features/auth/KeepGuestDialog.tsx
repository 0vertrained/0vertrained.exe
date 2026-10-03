// Shown once after a guest creates an account: keep what was logged on
// this device by uploading it, or start the account empty. Keep is the
// primary; Start fresh is the cancel and so also what Escape does, which
// is safe because the app leaves the guest data on the device either way.
import { Dialog } from "../../design/Dialog";

export const KEEP_GUEST_BODY = "Your guest days, program and settings are uploaded to your new account. Nothing is uploaded from the demo character.";

export interface KeepGuestDialogProps {
  /** Renders nothing when false; open by default. */
  open?: boolean;
  onKeep: () => void;
  onDiscard: () => void;
}

export function KeepGuestDialog({ open = true, onKeep, onDiscard }: KeepGuestDialogProps) {
  return <Dialog id="keep-guest" open={open} title="Keep guest progress?" body={KEEP_GUEST_BODY} confirmLabel="Keep" cancelLabel="Start fresh" onConfirm={onKeep} onCancel={onDiscard} />;
}
