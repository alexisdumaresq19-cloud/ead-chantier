import { LogoFull } from "../ui/logo";

/** The first thing on screen, while the app wakes up. */
export function Splash() {
  return (
    <div className="bg-ink fixed inset-0 grid place-items-center">
      <LogoFull className="animate-fade w-48" />
    </div>
  );
}
