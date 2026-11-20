import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Link2, QrCode } from "lucide-react";
import type { ReactNode } from "react";
import { Link, Redirect } from "wouter";

import { SIGNUP_PATH, type SignupStatus } from "@/shared/signup";

import { api } from "../../lib/api";
import { useMe } from "../../lib/session";
import { PublicLayout } from "../../shell/public-layout";
import { Splash } from "../../shell/splash";
import { buttonClass, ButtonLink, LogoFull } from "../../ui";
import { LegalLinks } from "../legal/links";
import { Heading } from "./parts";

// The first screen of the app, and the ways in for someone who already has
// an account.

const useSetupNeeded = () =>
  useQuery({
    queryKey: ["setup"],
    queryFn: () => api<{ needed: boolean }>("/api/setup"),
    meta: { persist: false },
  }).data?.needed === true;

/** Whether newcomers may make their own account: asked each time, kept for offline. */
const useSignupOpen = () =>
  useQuery({
    queryKey: ["signup"],
    queryFn: () => api<SignupStatus>("/api/signup"),
    refetchOnMount: "always",
  });

/** The office's very first account, for an installation that has none. */
function SetupLink({ onDark }: { onDark?: boolean }) {
  if (!useSetupNeeded()) return null;
  return (
    <ButtonLink
      href="/demarrer"
      variant={onDark ? "ghost" : "secondary"}
      block
      className={onDark ? "text-white/80 hover:bg-white/10 active:bg-white/10" : undefined}
    >
      Première utilisation&nbsp;: configurer l&apos;application
    </ButtonLink>
  );
}

export function WelcomeScreen() {
  const me = useMe();
  const signup = useSignupOpen();
  if (me.data) return <Redirect to="/" replace />;
  // The first answer is awaited on the logo, as the app opens. Without a
  // network (the request then waits, paused, for one to come back), the ways
  // in that need no code are shown.
  if (signup.isPending && signup.fetchStatus === "fetching") return <Splash />;
  if (!signup.data?.open) return <WaysIn />;

  return (
    <div className="bg-ink relative flex min-h-dvh flex-col overflow-hidden px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] text-white">
      {/* EAD's blue, as light on a dark site at dawn, behind the logo. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[70dvh] bg-[radial-gradient(60%_55%_at_50%_30%,color-mix(in_oklab,var(--color-ead)_28%,transparent),transparent)]"
      />
      <main className="animate-rise relative mx-auto flex w-full max-w-sm flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <LogoFull className="w-52 sm:w-60" />
          <h1 className="font-display mt-10 text-[32px] leading-tight font-bold tracking-tight">
            Bienvenue
          </h1>
          <p className="mt-3 max-w-[19rem] text-[17px] leading-snug text-balance text-white/70">
            Les plans, les documents, les photos et les rapports de vos chantiers, au même endroit.
          </p>
        </div>
        <div className="space-y-3">
          <ButtonLink href={SIGNUP_PATH} size="lg" block className="h-14 text-[17px]">
            Créer mon compte
          </ButtonLink>
          <Link
            href="/bienvenue/compte"
            className={buttonClass({
              variant: "secondary",
              size: "lg",
              block: true,
              className:
                "h-14 border-white/25 bg-transparent text-[17px] text-white hover:bg-white/10 active:bg-white/10",
            })}
          >
            J&apos;ai déjà un compte
          </Link>
          <SetupLink onDark />
        </div>
        <LegalLinks onDark className="mt-6" />
        <p className="mt-1 text-center text-xs font-medium tracking-wide text-white/45">
          EAD Chantier
        </p>
      </main>
    </div>
  );
}

/** The ways in for someone who has an account: from the first screen's "J'ai déjà un compte". */
export function WaysInScreen() {
  const me = useMe();
  const signup = useSignupOpen();
  if (me.data) return <Redirect to="/" replace />;
  return <WaysIn back={signup.data?.open === true} />;
}

/**
 * How someone gets in without a password. With `back`, it is the second step
 * of the first screen; without, it is the first screen itself (account
 * creation closed).
 */
function WaysIn({ back }: { back?: boolean }) {
  return (
    <PublicLayout>
      {back ? (
        <Link
          href="/bienvenue"
          className="text-ead-dark hover:bg-ead-tint -mt-2 mb-2 -ml-2 inline-flex h-11 items-center gap-0.5 rounded-lg pr-2.5 text-sm font-semibold"
        >
          <ChevronLeft className="size-5" aria-hidden /> Retour
        </Link>
      ) : null}
      <Heading title={back ? "J'ai déjà un compte" : "Bienvenue"}>
        {back
          ? "Entrez sur cet appareil d'une de ces deux façons."
          : "Les plans, les documents, les photos et les rapports de vos chantiers, au même endroit."}
      </Heading>
      <ul className="mt-6 space-y-4">
        <Way icon={<QrCode aria-hidden />} title="Au chantier">
          Scannez le code QR de votre contremaître avec l&apos;appareil photo de votre téléphone.
        </Way>
        <Way icon={<Link2 aria-hidden />} title="Par lien personnel">
          Ouvrez le lien que le bureau vous a envoyé par texto ou par courriel.
        </Way>
      </ul>
      <p className="border-line text-dim mt-6 border-t pt-4 text-sm">
        Nouveau téléphone ou lien expiré? Demandez un nouveau lien au bureau.
      </p>
      <div className="mt-5 empty:hidden">
        <SetupLink />
      </div>
    </PublicLayout>
  );
}

function Way({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="bg-ead-tint text-ead-dark flex size-11 shrink-0 items-center justify-center rounded-xl [&_svg]:size-6">
        {icon}
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-dim mt-0.5 text-sm text-pretty">{children}</p>
      </div>
    </li>
  );
}
