"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeftIcon, EyeIcon, EyeOffIcon } from "@/components/icons";

/**
 * Dark portal page frame — back link + page title. Width is fluid: a fixed
 * narrow column reads as a broken phone site on a monitor, so the frame grows
 * at sm/md/lg and wide pages lay their cards out in columns.
 */
export function PortalPage({
  title,
  backHref = "/dashboard",
  backLabel = "Back to dashboard",
  children,
}: {
  title: string;
  backHref?: string;
  backLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 px-4 pb-10 pt-6 sm:max-w-xl sm:px-6 md:max-w-3xl md:gap-5 lg:max-w-6xl lg:px-8 xl:max-w-7xl">
      <header className="flex items-center gap-3">
        <Link
          href={backHref}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-soft transition hover:bg-white/10"
          aria-label={backLabel}
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-bold tracking-tight text-soft sm:text-xl">{title}</h1>
      </header>
      {children}
    </main>
  );
}

/** Card surface used across the portal and admin console. */
export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-3xl border border-white/10 bg-navy p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && (
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">{title}</p>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Inline status / error line. */
export function Note({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "ok" | "warn";
  children: React.ReactNode;
}) {
  const tones = {
    info: "border-white/10 bg-white/5 text-mist",
    error: "border-red-400/30 bg-red-400/10 text-soft",
    ok: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    warn: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  } as const;
  return <p className={`rounded-2xl border px-4 py-3 text-sm ${tones[tone]}`}>{children}</p>;
}

/** Primary action button (blue) and quiet/danger variants. */
export function ActionButton({
  children,
  onClick,
  disabled,
  tone = "primary",
  type = "button",
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "primary" | "quiet" | "danger";
  type?: "button" | "submit";
  className?: string;
}) {
  const tones = {
    primary: "bg-brand text-night hover:brightness-110",
    quiet: "border border-white/15 bg-white/5 text-soft hover:bg-white/10",
    danger: "border border-red-400/40 bg-red-400/10 text-red-300 hover:bg-red-400/20",
  } as const;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl px-4 text-sm font-bold transition active:scale-[0.99] disabled:opacity-50 ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

/** Checkbox row for a boolean setting. */
export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-night-2 px-4 py-3">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[color:var(--color-brand)]"
      />
      <span>
        <span className="block text-sm font-bold text-soft">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-mist">{hint}</span>}
      </span>
    </label>
  );
}

/** Labelled input row. Password fields get a show/hide eye toggle. */
export function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
  required,
  inputMode,
  maxLength,
  autoFocus,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  inputMode?: "text" | "numeric" | "tel" | "email";
  maxLength?: number;
  autoFocus?: boolean;
  hint?: string;
}) {
  const [visible, setVisible] = useState(false);
  const isPassword = type === "password";
  const Icon = visible ? EyeOffIcon : EyeIcon;
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
        {label}
      </span>
      <span className="relative block">
        <input
          type={isPassword && visible ? "text" : type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          inputMode={inputMode}
          maxLength={maxLength}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-brand/50"
          style={isPassword ? { paddingRight: 44 } : undefined}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center text-mist transition hover:text-soft"
          >
            <Icon className="h-[19px] w-[19px]" />
          </button>
        )}
      </span>
      {hint && <span className="mt-1.5 block text-xs text-mist">{hint}</span>}
    </label>
  );
}

/** Labelled select row. Mirrors Field's look; options are {value,label} pairs. */
export function SelectField({
  label,
  value,
  onChange,
  options,
  hint,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
        {label}
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-brand/50 disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-night-2 text-soft">
            {o.label}
          </option>
        ))}
      </select>
      {hint && <span className="mt-1.5 block text-xs text-mist">{hint}</span>}
    </label>
  );
}

/** Headline metric tile. */
export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-navy-2 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-mist">{label}</p>
      <p className="mt-1 text-xl font-bold text-soft">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-mist">{hint}</p>}
    </div>
  );
}

/** Small status pill. Pass `className` to override the tone colours entirely. */
export function Badge({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "danger" | "info";
  className?: string;
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "border-white/10 bg-white/5 text-mist",
    ok: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    warn: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    danger: "border-red-400/30 bg-red-400/10 text-red-300",
    info: "border-brand/30 bg-brand/10 text-brand-2",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
        className || tones[tone]
      }`}
    >
      {children}
    </span>
  );
}

/** Scrollable data table. Compose rows with <Tr>/<Td>. */
export function Table({ columns, children }: { columns: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-[0.12em] text-mist">
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-soft">{children}</tbody>
      </table>
    </div>
  );
}

export function Tr({ children }: { children: React.ReactNode }) {
  return <tr className="border-t border-white/5">{children}</tr>;
}

export function Td({
  children,
  colSpan,
  className = "",
}: {
  children: React.ReactNode;
  colSpan?: number;
  className?: string;
}) {
  return (
    <td colSpan={colSpan} className={`px-3 py-3 align-top ${className}`}>
      {children}
    </td>
  );
}

/** Empty-state line for tables and lists. */
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-6 text-center text-sm text-mist">{children}</p>;
}
