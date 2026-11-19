import { cn } from "../lib/cn";

// EAD's logo is drawn for a black background: use it on black only.

/** The emblem with "EAD" (bars, small spaces). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <img
      src="/brand/ead-mark.png"
      width={625}
      height={396}
      alt="EAD"
      decoding="async"
      className={cn("h-8 w-auto", className)}
    />
  );
}

/** The full logo, with "Les Entreprises Allen Dumaresq". */
export function LogoFull({ className }: { className?: string }) {
  return (
    <img
      src="/brand/ead-logo.png"
      width={752}
      height={560}
      alt="Les Entreprises Allen Dumaresq"
      decoding="async"
      className={cn("h-auto w-44", className)}
    />
  );
}
