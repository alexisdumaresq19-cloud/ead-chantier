import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "wouter";

import { cn } from "../lib/cn";

// Buttons are tall on purpose: they are pressed with cold or gloved fingers.

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-ead-dark text-white shadow-sm hover:bg-ead-darker active:bg-ead-darker",
  secondary: "border border-line bg-surface text-text hover:bg-canvas active:bg-canvas",
  ghost: "text-ead-dark hover:bg-ead-tint active:bg-ead-tint",
  danger: "bg-bad text-white shadow-sm hover:bg-bad/90 active:bg-bad/90",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 gap-1.5 rounded-lg px-3 text-sm",
  md: "h-11 gap-2 rounded-xl px-4 text-[15px]",
  lg: "h-13 gap-2.5 rounded-xl px-6 text-base",
};

type Look = { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; className?: string };

/** The classes of a button, for anything that must look like one (a link, a label). */
export function buttonClass({ variant = "primary", size = "md", block, className }: Look = {}) {
  return cn(
    "inline-flex shrink-0 cursor-pointer items-center justify-center font-semibold whitespace-nowrap transition-colors select-none",
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[1.2em] [&_svg]:shrink-0",
    variants[variant],
    sizes[size],
    block && "w-full",
    className,
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & Look & { loading?: boolean };

export function Button({
  variant,
  size,
  block,
  loading,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, block, className })}
      {...props}
    >
      {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

/** A link to another screen of the app, drawn as a button. */
export function ButtonLink({
  href,
  replace,
  children,
  ...look
}: Look & { href: string; replace?: boolean; children: ReactNode }) {
  return (
    <Link href={href} replace={replace} className={buttonClass(look)}>
      {children}
    </Link>
  );
}

/** A button that is only an icon. The label is read aloud and shown on hover. */
export function IconButton({
  label,
  className,
  children,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "text-dim inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl transition-colors",
        "hover:bg-canvas hover:text-text active:bg-canvas disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-5.5",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
