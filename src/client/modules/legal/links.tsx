import { cn } from "../../lib/cn";

// The two public pages the server writes for anyone to read, with no account:
// the privacy policy and the support page. Plain links: they leave the app's
// one page (src/app/confidentialite, src/app/soutien).

export const PRIVACY_PATH = "/confidentialite";
export const SUPPORT_PATH = "/soutien";

/** "Confidentialité · Soutien", small, at the foot of a screen. */
export function LegalLinks({ onDark, className }: { onDark?: boolean; className?: string }) {
  const link = cn(
    "rounded px-1 py-2 underline-offset-4 hover:underline",
    onDark ? "text-white/60 hover:text-white" : "text-dim hover:text-ink",
  );
  return (
    <p className={cn("text-center text-xs font-medium tracking-wide", className)}>
      <a href={PRIVACY_PATH} className={link}>
        Confidentialité
      </a>
      <span aria-hidden className={onDark ? "text-white/30" : "text-dim/50"}>
        {" · "}
      </span>
      <a href={SUPPORT_PATH} className={link}>
        Soutien
      </a>
    </p>
  );
}
