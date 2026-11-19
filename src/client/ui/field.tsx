import { CircleAlert, Search, X } from "lucide-react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import { cn } from "../lib/cn";

const control =
  "w-full rounded-xl border border-line bg-surface px-3.5 text-text shadow-xs transition-colors outline-none placeholder:text-dim/60 focus:border-ead focus:ring-3 focus:ring-ead/25 disabled:bg-canvas disabled:text-dim aria-invalid:border-bad";

/** A label over its control, with an optional hint and error under it. */
export function Field({
  label,
  hint,
  error,
  optional,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-semibold">
        {label}
        {optional ? <span className="text-dim font-normal">Facultatif</span> : null}
      </span>
      {children}
      {error ? (
        <span className="text-bad mt-1.5 block text-sm font-medium">{error}</span>
      ) : hint ? (
        <span className="text-dim mt-1.5 block text-sm">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, "h-12", className)} {...props} />;
}

export function Textarea({
  className,
  rows = 4,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea rows={rows} className={cn(control, "py-3 leading-relaxed", className)} {...props} />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, "h-12 appearance-auto pr-2", className)} {...props}>
      {children}
    </select>
  );
}

/** A search box with a clear button. */
export function SearchInput({
  value,
  onChange,
  placeholder = "Rechercher",
  className,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search
        className="text-dim pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2"
        aria-hidden
      />
      <input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(control, "h-12 pr-11 pl-11 [&::-webkit-search-cancel-button]:hidden")}
      />
      {value ? (
        <button
          type="button"
          aria-label="Effacer la recherche"
          onClick={() => onChange("")}
          className="text-dim hover:bg-canvas hover:text-text absolute top-1/2 right-1.5 inline-flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg"
        >
          <X className="size-5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/** A form's error, shown where the person is looking (toasts hide behind sheets). */
export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="bg-bad-tint text-bad flex items-start gap-2 rounded-xl px-3.5 py-3 text-sm font-medium"
    >
      <CircleAlert className="mt-px size-4.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
