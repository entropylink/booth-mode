// Shared UI primitives. Sized for the table: every interactive target is at
// least --tap (56px), because this is operated standing and possibly gloved
// (plan.md §7).

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { formatMXN, parseMXN } from "../lib/money";
import type { Cents, Tier } from "../core-data/types";

/**
 * Short form of a tier label for a cramped badge: "Flagship – go deep" reads as
 * "Flagship". The full label stays in the title attribute.
 */
export function tierShort(tier: Tier): string {
  return (tier.label.split(/\s+[–—-]\s+/)[0] ?? tier.label).trim();
}

export function TierBadge({ tier }: { tier: Tier }): ReactNode {
  return (
    <span className="tier-badge" style={{ color: tier.color }} title={tier.label}>
      {tierShort(tier)}
    </span>
  );
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 9999,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  label?: string;
}): ReactNode {
  const clamp = (n: number): number => Math.min(max, Math.max(min, n));
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(clamp(value - 1))} aria-label={`− ${label ?? ""}`}>
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        aria-label={label}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/[^0-9]/g, ""));
          onChange(clamp(Number.isFinite(n) ? n : min));
        }}
      />
      <button type="button" onClick={() => onChange(clamp(value + 1))} aria-label={`+ ${label ?? ""}`}>
        +
      </button>
    </div>
  );
}

/** Money input that keeps raw text while typing and reports centavos or null. */
export function MoneyInput({
  valueCents,
  onChange,
  label,
  placeholder,
  autoFocus,
}: {
  valueCents: Cents | null;
  onChange: (cents: Cents | null) => void;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
}): ReactNode {
  const [text, setText] = useState(() =>
    valueCents === null ? "" : (valueCents / 100).toFixed(2),
  );

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      autoFocus={autoFocus}
      placeholder={placeholder ?? "0.00"}
      aria-label={label}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseMXN(e.target.value));
      }}
    />
  );
}

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}): ReactNode {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="sheet-backdrop"
      data-noswipe
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/**
 * Hold-to-confirm. Voiding a sale is destructive and the table is chaotic —
 * a deliberate 800ms hold is the confirmation (plan.md §6 F2).
 */
export function HoldButton({
  onConfirm,
  label,
  holdMs = 800,
  className = "",
}: {
  onConfirm: () => void;
  label: string;
  holdMs?: number;
  className?: string;
}): ReactNode {
  const [progress, setProgress] = useState(0);
  const raf = useRef<number | null>(null);
  const start = useRef<number>(0);

  const stop = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    setProgress(0);
  }, []);

  const begin = useCallback(() => {
    start.current = performance.now();
    const tick = (): void => {
      const pct = Math.min(1, (performance.now() - start.current) / holdMs);
      setProgress(pct);
      if (pct >= 1) {
        stop();
        onConfirm();
      } else {
        raf.current = requestAnimationFrame(tick);
      }
    };
    raf.current = requestAnimationFrame(tick);
  }, [holdMs, onConfirm, stop]);

  useEffect(() => stop, [stop]);

  return (
    <button
      type="button"
      className={`btn hold-btn ${className}`}
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
    >
      <span className="fill" style={{ transform: `scaleX(${progress})` }} />
      <span className="hold-label">{label}</span>
    </button>
  );
}

export function Toast({ message }: { message: string | null }): ReactNode {
  if (!message) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}

export function useToast(ms = 1600): [string | null, (m: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (m: string) => {
      setMessage(m);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setMessage(null), ms);
    },
    [ms],
  );

  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);
  return [message, show];
}

export function EmptyState({ title, hint }: { title: string; hint?: string }): ReactNode {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {hint ? <span className="faint">{hint}</span> : null}
    </div>
  );
}

export function Money({ cents, className = "" }: { cents: Cents; className?: string }): ReactNode {
  return <span className={`money ${className}`}>{formatMXN(cents)}</span>;
}

export function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        // Storage full or blocked — the in-memory value still works today.
      }
    },
    [key],
  );

  return [value, set];
}

export function useT(): ReturnType<typeof useTranslation>["t"] {
  return useTranslation().t;
}
