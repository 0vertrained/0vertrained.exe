// One toast at a time, above the tab bar: a record during a session or going
// offline. A second toast replaces the first; records clear after 4 s.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Toast } from "../design/Toast";
import type { NoticeProps } from "../design/Notice";

export interface ToastMessage {
  tag: NonNullable<NoticeProps["tag"]>;
  text: string;
  /** ms before it clears; 0 keeps it until replaced or dismissed. */
  ttl?: number;
  action?: NoticeProps["action"];
}

interface ToastApi {
  show: (message: ToastMessage) => void;
  dismiss: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ToastMessage | null>(null);
  const timer = useRef(0);
  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current);
    setCurrent(null);
  }, []);
  const show = useCallback((message: ToastMessage) => {
    window.clearTimeout(timer.current);
    setCurrent(message);
    const ttl = message.ttl ?? 4000;
    if (ttl > 0) timer.current = window.setTimeout(() => setCurrent(null), ttl);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      {current ? (
        <Toast tag={current.tag} action={current.action ?? { label: "Dismiss", onClick: dismiss }}>
          {current.text}
        </Toast>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast needs a ToastProvider");
  return api;
}
