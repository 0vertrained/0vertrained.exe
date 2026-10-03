// Chooses where the athlete's data lives: the browser (guest) or the account
// (Supabase) once signed in. Handles the two hand-overs around sign-up: the
// "Keep guest progress?" question and the upload of guest days the account
// does not have. Remounts the data provider per identity, so a sign-out can
// never show one person's days to the next.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../auth/useAuth";
import { AppDataProvider } from "../data/AppDataProvider";
import { clearDemo, clearGuestUploadPending, isDemo, isGuestUploadPending, markGuestUploadPending } from "../data/guestFlags";
import { createLocalSource } from "../data/localSource";
import type { DayMerge, SupabaseSource } from "../data/supabaseSource";
import type { DbClient } from "../data/supabaseTypes";
import { useAppData } from "../data/useAppData";
import { Skeleton } from "../design/Skeleton";
import { reportError, setErrorReportToken } from "./errorReporting";
import { ToastProvider } from "./ToastProvider";

type AccountModule = typeof import("./accountData");
let accountModule: Promise<AccountModule> | null = null;
/** The account-only code, fetched once, only when someone signs in. */
const loadAccountModule = (): Promise<AccountModule> => (accountModule ??= import("./accountData"));

/** Set by the landing page the moment a sign-up succeeds, read once here. */
export const JUST_SIGNED_UP_KEY = "ovt-v20-just-signed-up";

function readFlag(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function clearFlag(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // nicety
  }
}

export function BootSkeleton({ caption }: { caption?: string }) {
  return (
    <div className="ot-screen-body" aria-busy="true">
      {caption ? <p className="ot-small ot-ink-2 ot-m0">{caption}</p> : null}
      <Skeleton height={40} />
      <Skeleton lines={3} />
      <Skeleton height={48} />
    </div>
  );
}

/** Replaces a day with the merged copy when a save met a newer server version. */
function MergeAdopter({ merge }: { merge: DayMerge | null }) {
  const { updateDay } = useAppData();
  useEffect(() => {
    if (merge) updateDay(merge.dateKey, () => merge.merged);
  }, [merge, updateDay]);
  return null;
}

export function DataRoot({ children }: { children: (guest: boolean) => ReactNode }) {
  const auth = useAuth();
  const local = useMemo(() => createLocalSource(), []);
  const signedIn = auth.status === "signed-in" && auth.user !== null && auth.client !== null;
  const userId = signedIn && auth.user ? auth.user.id : null;
  const client = signedIn ? auth.client : null;
  const [merge, setMerge] = useState<DayMerge | null>(null);
  const [account, setAccount] = useState<{ mod: AccountModule; remote: SupabaseSource; userId: string } | null>(null);
  useEffect(() => {
    if (!client || !userId) return;
    let cancelled = false;
    loadAccountModule().then(
      (mod) => {
        if (!cancelled) setAccount({ mod, remote: mod.createSupabaseSource(client as unknown as DbClient, userId, { onMerge: setMerge }), userId });
      },
      (error: unknown) => reportError(error, "manual", "account module"),
    );
    return () => {
      cancelled = true;
    };
  }, [client, userId]);
  const remote = account && account.userId === userId && client ? account.remote : null;
  const mod = account?.mod ?? null;

  // Right after a sign-up in this browser, ask once whether guest progress
  // comes along. The answer is state; everything else is derived from it.
  const justSignedUp = useMemo(() => remote !== null && readFlag(JUST_SIGNED_UP_KEY), [remote]);
  const [answer, setAnswer] = useState<{ remote: object; decision: "ask" | "none" } | null>(null);
  const question: "pending" | "ask" | "none" = !remote || !justSignedUp ? "none" : answer && answer.remote === remote ? answer.decision : "pending";
  useEffect(() => {
    if (!remote || !justSignedUp || (answer && answer.remote === remote)) return;
    let cancelled = false;
    local.load().then(
      (snapshot) => {
        if (cancelled) return;
        clearFlag(JUST_SIGNED_UP_KEY);
        const hasGuestData = Object.keys(snapshot.days).length > 0 || snapshot.program !== null || snapshot.settings.onboarded;
        setAnswer({ remote, decision: hasGuestData && !isDemo() ? "ask" : "none" });
      },
      () => {
        if (!cancelled) setAnswer({ remote, decision: "none" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [remote, justSignedUp, answer, local]);

  // Upload the guest days the account lacks, once, before its data mounts.
  const [carried, setCarried] = useState<object | null>(null);
  const needsUpload = remote !== null && question === "none" && carried !== remote && isGuestUploadPending();
  const uploading = useRef<object | null>(null);
  useEffect(() => {
    if (!remote || !needsUpload || uploading.current === remote) return;
    uploading.current = remote;
    if (!mod) return;
    mod.uploadGuestData({ local, remote })
      .then(() => {
        clearGuestUploadPending();
        clearDemo();
      })
      .catch((error: unknown) => reportError(error, "manual", "guest carry-over"))
      .finally(() => setCarried(remote));
  }, [remote, needsUpload, local, mod]);

  // Error reports carry the session token for accounts.
  useEffect(() => {
    if (!client) {
      setErrorReportToken(null);
      return;
    }
    setErrorReportToken(() => client.auth.getSession().then((r) => r.data.session?.access_token ?? null));
    return () => setErrorReportToken(null);
  }, [client]);

  if (auth.status === "loading") return <BootSkeleton />;
  if (signedIn && !remote) return <BootSkeleton />;
  if (remote && question === "pending") return <BootSkeleton />;
  if (remote && question === "ask" && mod) {
    const KeepGuestDialog = mod.KeepGuestDialog;
    return (
      <KeepGuestDialog
        onKeep={() => {
          markGuestUploadPending();
          setAnswer({ remote, decision: "none" });
        }}
        onDiscard={() => setAnswer({ remote, decision: "none" })}
      />
    );
  }
  if (remote && needsUpload) return <BootSkeleton caption="Moving your guest progress to your account…" />;

  const source = remote ?? local;
  return (
    <AppDataProvider key={userId ?? "guest"} source={source}>
      <ToastProvider>
        <MergeAdopter merge={merge} />
        {children(!remote)}
      </ToastProvider>
    </AppDataProvider>
  );
}
