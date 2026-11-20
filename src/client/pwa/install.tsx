import { EllipsisVertical, MonitorSmartphone, Share, SquarePlus } from "lucide-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import { isNativeApp } from "../native";
import { Button, Card, toast } from "../ui";
import { acceptInstallOffer, useInstallOffer } from "./install-offer";

// Each family of browsers has its own way to the home screen: Chrome and
// Edge let the app ask, Safari on iPhone and iPad only knows its Share menu,
// the others have a line in their own menu.

const STANDALONE = "(display-mode: standalone)";

/** Whether the app runs from its icon, in its own window. */
function useStandalone(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const media = window.matchMedia(STANDALONE);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    () =>
      window.matchMedia(STANDALONE).matches ||
      // Safari on iPhone, before it knew the standard way to say it.
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    () => false,
  );
}

/** iPhone and iPad; an iPad calls itself a Mac, but a Mac has no touch screen. */
const isApple = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** On the account screen: how to put the app on the home screen. */
export function InstallApp() {
  const { offer, installed } = useInstallOffer();
  const standalone = useStandalone();
  const [asking, setAsking] = useState(false);

  // The App Store's app is installed by definition.
  if (standalone || installed || isNativeApp()) return null;
  // A browser that can offer but has not is either waiting to, or has the
  // app installed already: nothing to explain.
  if (!offer && !isApple() && "onbeforeinstallprompt" in window) return null;

  async function install() {
    setAsking(true);
    try {
      if (await acceptInstallOffer()) toast.success("EAD Chantier est installé sur cet appareil.");
    } catch {
      toast.error("L'installation n'a pas pu se faire. Réessayez.");
    } finally {
      setAsking(false);
    }
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-x-6">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="bg-ead-tint text-ead-dark flex size-11 shrink-0 items-center justify-center rounded-xl">
            <MonitorSmartphone className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg leading-tight font-bold">
              Installer l&apos;application
            </h2>
            <p className="text-dim mt-1 max-w-prose text-[15px] text-pretty">
              Une fois installée, EAD Chantier s&apos;ouvre depuis l&apos;écran d&apos;accueil, en
              plein écran, même sans réseau.
            </p>
          </div>
        </div>
        {offer ? (
          <Button size="lg" loading={asking} onClick={install} className="w-full sm:w-auto">
            Installer
          </Button>
        ) : null}
      </div>

      {offer ? null : isApple() ? (
        <ol className="mt-4 space-y-2.5">
          <Step number={1}>
            Touchez <Share className={INLINE_ICON} aria-hidden /> <strong>Partager</strong>, dans la
            barre du navigateur.
          </Step>
          <Step number={2}>
            Choisissez <SquarePlus className={INLINE_ICON} aria-hidden />{" "}
            <strong>Sur l&apos;écran d&apos;accueil</strong>.
          </Step>
        </ol>
      ) : (
        <p className="mt-4 text-[15px]">
          Ouvrez le menu <EllipsisVertical className={INLINE_ICON} aria-hidden /> du navigateur,
          puis choisissez <strong>Installer</strong> ou{" "}
          <strong>Ajouter à l&apos;écran d&apos;accueil</strong>.
        </p>
      )}
    </Card>
  );
}

/** An icon in the middle of a sentence, as the browser draws it. */
const INLINE_ICON = "text-ead-dark mx-0.5 inline size-5 align-[-4px]";

function Step({ number, children }: { number: number; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 text-[15px]">
      <span
        aria-hidden
        className="bg-ead-dark font-display flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
      >
        {number}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}
