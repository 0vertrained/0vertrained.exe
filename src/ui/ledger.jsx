// src/ui/ledger.jsx
// The Ledger kit: the small set of parts every rebuilt screen is made from.
// Each part renders plain markup carrying the classes in src/ledger.css, so a
// screen reads as its structure and the stylesheet stays the one place that
// knows what things look like.
import { useEffect, useId, useRef, useState } from "react";

// Icons sit on a 24 grid with a 1.75 stroke, round joins and no fills. They are
// decoration: the control that holds one always carries the words.
const ICONS = {
  today: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
  train: <path d="M3 9.5v5M6.5 6.5v11M17.5 6.5v11M21 9.5v5M6.5 12h11" />,
  fuel: <path d="M4 11h16a8 8 0 0 1-16 0zM9 4c1 1.2 1 2.2 0 3.4M14 4c1 1.2 1 2.2 0 3.4" />,
  progress: <path d="M4 5v14h16M8 15l4-4 3 3 5-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  offline: <><circle cx="12" cy="12" r="8" /><path d="M6.5 6.5l11 11" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></>,
  back: <path d="M15 6l-6 6 6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  next: <path d="M9 6l6 6-6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  up: <path d="M6 15l6-6 6 6" />,
  run: <path d="M4 18h4l3-12 3 16 3-10h3" />,
  done: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></>,
  open: <circle cx="12" cy="12" r="9" />,
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />,
  warn: <path d="M12 4l9 16H3zM12 10v4M12 17h.01" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  pause: <path d="M9 6v12M15 6v12" />,
  play: <path d="M8 5l11 7-11 7z" />,
};

export function Icon({ name, size, className = "" }) {
  const cls = ["i", size === "s" ? "i-s" : size === "xs" ? "i-xs" : "", className].filter(Boolean).join(" ");
  return <svg className={cls} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{ICONS[name] || null}</svg>;
}

// The brand mark: the θ glyph, drawn so it holds at 16 px.
export function Mark({ className = "mark" }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><ellipse cx="12" cy="12" rx="6.5" ry="9.5" /><path d="M5.5 12h13" /></svg>;
}

// The wordmark is the name, so it is never machine-translated.
export function Wordmark({ style }) {
  return <span className="wm" role="img" aria-label="0VERTRAINED" translate="no" style={style}><Mark />VERTRAINED</span>;
}

// Sync status says Saving, Saved or Offline, with the number of queued
// changes. The visible words are short; the screen-reader sentence is whole.
export function SyncStatus({ status, className = "t-c c2", style }) {
  if (!status) return null;
  const icon = status.key === "offline" ? "offline" : status.key === "synced" ? "check" : null;
  return (
    <p className={className} role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 4, flex: "none", ...style }}>
      {icon && <Icon name={icon} size="xs" />}
      <span aria-hidden="true">{status.label}</span>
      <span className="sr">{status.sr}</span>
    </p>
  );
}

// The top bar holds the screen's one h1, sync status and Profile. A screen one
// level down shows a labelled Back; a full-screen flow shows a labelled Close.
export function TopBar({ title, sub = "", back, onBack, close, onClose, status, onProfile, children }) {
  const isRoot = !back && !close;
  return (
    <header className="top">
      {isRoot && <Mark />}
      {back && <button type="button" className="back" onClick={onBack}><Icon name="back" size="s" />{back}</button>}
      {close && <button type="button" className="back" style={{ gap: 4 }} onClick={onClose}><Icon name="close" size="s" />{close}</button>}
      <h1 className="t-bs grow clip">{title}{sub && <span className="c2" style={{ fontWeight: 400 }}>{sub}</span>}</h1>
      {children}
      <SyncStatus status={status} />
      {onProfile && !close
        ? <button type="button" className="ibtn" aria-label="Profile and settings" onClick={onProfile}><Icon name="user" /></button>
        : <span style={{ width: 12, flex: "none" }} />}
    </header>
  );
}

// Four destinations with Log in the centre. The current tab is marked by a bar
// and a heavier label, never by colour alone.
export const TAB_ICONS = { Today: "today", Train: "train", Fuel: "fuel", Progress: "progress" };

export function TabBar({ tabs, current, onChange, onLog }) {
  const mid = Math.ceil(tabs.length / 2);
  const tab = (t) => (
    <button key={t} type="button" className="tab" id={`tab-${t}`} aria-current={current === t ? "page" : undefined} onClick={() => onChange(t)}>
      <Icon name={TAB_ICONS[t]} />{t}
    </button>
  );
  return (
    <nav className="tabbar" aria-label="Primary">
      {tabs.slice(0, mid).map(tab)}
      <button type="button" className="tab tab-log" aria-haspopup="dialog" onClick={onLog}><Icon name="plus" />Log</button>
      {tabs.slice(mid).map(tab)}
    </nav>
  );
}

// A bottom sheet: focus moves in, Esc and Close leave, and focus returns to
// whatever opened it. It is mounted only while open, so it rises once.
export function Sheet({ open, title, onClose, children, closeLabel = "Close" }) {
  const id = useId();
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const frame = requestAnimationFrame(() => ref.current?.querySelector("button, [href], input, select, textarea")?.focus());
    const onKeyDown = (event) => {
      if (event.key === "Escape") { onCloseRef.current?.(); return; }
      if (event.key !== "Tab" || !ref.current) return;
      const items = ref.current.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])");
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      requestAnimationFrame(() => opener?.isConnected && opener.focus?.());
    };
  }, [open]);
  if (!open) return null;
  return (
    <>
      <div className="scrim mo-scrim" onClick={onClose} aria-hidden="true" />
      <section ref={ref} className="sheet mo-rise" role="dialog" aria-modal="true" aria-labelledby={id}>
        <span className="grab" aria-hidden="true" />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 id={id} className="t-h grow">{title}</h2>
          <button type="button" className="ibtn" aria-label={closeLabel} onClick={onClose}><Icon name="close" /></button>
        </div>
        {children}
      </section>
    </>
  );
}

// A full-screen flow: the session runner, the interval runner, the Box Score.
// It covers the shell and its tab bar, keeps the keyboard inside, closes on
// Esc and hands focus back to whatever opened it. A sheet opened inside the
// flow handles its own keys while it is up.
export function Flow({ label, onClose, children, ...rest }) {
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const opener = document.activeElement;
    const frame = requestAnimationFrame(() => ref.current?.focus());
    const onKeyDown = (event) => {
      const root = ref.current;
      if (!root || root.querySelector(".sheet")) return;
      if (event.key === "Escape") { onCloseRef.current?.(); return; }
      if (event.key !== "Tab") return;
      const items = root.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])");
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Focus that has slipped out (its control was removed) comes back in.
      if (!root.contains(active)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && (active === first || active === root)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      requestAnimationFrame(() => opener?.isConnected && opener.focus?.());
    };
  }, []);
  return <div ref={ref} className="flow-screen" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} {...rest}>{children}</div>;
}

// A toast says what just happened. If the action can be undone, Undo is a real
// button and is live at once.
export function Toast({ children, action, onAction, role = "status" }) {
  return (
    <div className="toast mo-toast" role={role} aria-live="polite" style={action ? undefined : { paddingRight: 16 }}>
      <span className="grow">{children}</span>
      {action && <button type="button" className="btn btn-sm" onClick={onAction} style={{ color: "var(--bg)", textDecoration: "underline" }}>{action}</button>}
    </div>
  );
}

// A progress bar is an image with a sentence for a name; the numbers beside it
// are the visible label.
export function Bar({ value, max = 100, label, earned = false, timer = false, style }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span className={`bar${earned ? " bar-e" : ""}${timer ? " bar-t" : ""}`} role="img" aria-label={label} style={style}>
      <i style={{ width: `${pct}%` }} />
    </span>
  );
}

// The call's effort meter: five bars, `level` of them filled.
export function Meter({ level, label, style }) {
  return (
    <span className="meter" role="img" aria-label={label} style={style}>
      {[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= level ? undefined : "off"} />)}
    </span>
  );
}

// One choice of several, as separate 44 px targets. Arrow keys move the choice;
// the group is one Tab stop.
export function Seg({ label, options, value, onChange, labelledBy }) {
  const ref = useRef(null);
  const onKeyDown = (event) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const index = Math.max(0, options.findIndex((o) => o.value === value));
    const next = options[(index + keys[event.key] + options.length) % options.length];
    onChange(next.value);
    requestAnimationFrame(() => ref.current?.querySelector('[aria-checked="true"]')?.focus());
  };
  const hasValue = options.some((o) => o.value === value);
  return (
    <div ref={ref} className="seg" role="radiogroup" aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on} tabIndex={on || (!hasValue && i === 0) ? 0 : -1} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, labelledBy, label, disabled = false }) {
  return (
    <button type="button" className="sw" role="switch" aria-checked={checked} aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label} aria-disabled={disabled || undefined} onClick={() => !disabled && onChange(!checked)}>
      <i />
    </button>
  );
}

// A block that closes without unmounting, so what follows moves once.
export function Fold({ open, id, children }) {
  const ref = useRef(null);
  // A shut fold is out of reach at once, not only when its closing transition ends.
  useEffect(() => { if (ref.current) ref.current.inert = !open; }, [open]);
  return <div ref={ref} id={id} className={`fold${open ? "" : " is-shut"}`} aria-hidden={open ? undefined : true}><div>{children}</div></div>;
}

// A row that goes somewhere: label, an optional second line, a chevron.
export function LinkRow({ label, sub, value, onClick, icon, style }) {
  return (
    <button type="button" className="row" onClick={onClick} style={style}>
      {icon && <Icon name={icon} />}
      <span className="kv grow"><span className="t-bs">{label}</span>{sub && <span className="t-s c2">{sub}</span>}</span>
      {value && <span className="n-s c2">{value}</span>}
      <Icon name="next" size="s" className="c2" />
    </button>
  );
}

// A figure's method: one plain line under it, and the longer account behind a
// button. Terms of art belong in the longer part only.
export function Method({ testId, method, detail = null, label = "How this is measured" }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={testId} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {method && <p className="t-s c2">{method}</p>}
      {detail && (
        <button type="button" className="btn btn-g btn-sm" aria-expanded={open} onClick={() => setOpen((value) => !value)} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>
          {open ? `Hide ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label}
        </button>
      )}
      {detail && open && <div className="t-s" style={{ display: "flex", flexDirection: "column", gap: 6 }}>{detail}</div>}
    </div>
  );
}
