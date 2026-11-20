/* eslint-disable @next/next/no-html-link-for-pages -- "/" is the app's own page: it opens with a full load, as a fresh visit would */
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { LogoFull } from "@/client/ui/logo";
import { phoneHref, type CompanyProfile } from "@/shared/company";

// What the two public pages share (/confidentialite, /soutien): the app's
// black band with the logo, one readable column in large type, a way back to
// the app. Written by the server and complete without JavaScript, so that
// anyone can read them, Apple's reviewer included, with no account. They
// print on white, the band kept.

const PRINT = `
@page { margin: 0.6in 0.7in; }
@media print {
  html, body { background: #fff !important; }
  /* Chrome breaks pages poorly inside a flex column: on paper it is a plain one. */
  [data-legal] { display: block !important; min-height: 0 !important; }
  [data-legal-band] { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  [data-legal] a { color: inherit; text-decoration: none; }
  [data-legal] section { break-inside: auto; }
  [data-legal] h2, [data-legal] h3 { break-after: avoid; }
  [data-legal] li, [data-legal] p { orphans: 2; widows: 2; }
  [data-legal] address, [data-legal] h1 + div p { break-inside: avoid; }
}`;

export function LegalPage({
  title,
  lead,
  children,
  other,
  company,
}: {
  title: string;
  /** The company's name, as the office keeps it. */
  company: string;
  lead: ReactNode;
  children: ReactNode;
  /** The other public page, linked at the foot. */
  other: { href: string; label: string };
}) {
  return (
    <div data-legal className="bg-surface text-text flex min-h-dvh flex-col">
      <style>{PRINT}</style>
      <header
        data-legal-band
        className="bg-ink pt-[env(safe-area-inset-top)] text-white print:pt-0"
      >
        <div className="mx-auto flex max-w-[42rem] items-center justify-between gap-4 px-4 py-3.5 sm:px-6 sm:py-4">
          <a href="/" className="shrink-0 rounded-lg">
            <LogoFull className="w-[5.5rem] sm:w-28" />
          </a>
          <a
            href="/"
            className="no-print inline-flex min-h-11 items-center gap-2 rounded-xl bg-white/10 px-4 text-[15px] font-semibold transition-colors hover:bg-white/20"
          >
            <ArrowLeft className="size-4.5" aria-hidden />
            Retour à l&apos;application
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[42rem] flex-1 px-4 pt-8 pb-14 sm:px-6 sm:pt-14 print:max-w-none print:px-0 print:pt-6">
        <p className="font-display text-ead-dark text-sm font-bold tracking-wider uppercase">
          EAD Chantier
        </p>
        <h1 className="font-display mt-1.5 text-[32px] leading-[1.1] font-bold tracking-tight text-balance sm:text-[44px]">
          {title}
        </h1>
        <div className="text-dim mt-4 text-[17px] leading-relaxed text-pretty sm:text-lg">
          {lead}
        </div>
        <div className="mt-2">{children}</div>
      </main>

      <footer className="border-line border-t">
        <div className="text-dim mx-auto flex max-w-[42rem] flex-col gap-1 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 print:hidden">
          <a
            href={other.href}
            className="text-ead-dark inline-flex min-h-11 items-center font-semibold underline-offset-4 hover:underline"
          >
            {other.label}
          </a>
          <p>{company} · EAD Chantier</p>
        </div>
      </footer>
    </div>
  );
}

/** One part of a page, with its title. */
export function Part({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-10 scroll-mt-6 sm:mt-12">
      <h2 className="font-display text-[23px] leading-tight font-bold text-balance sm:text-[27px]">
        {title}
      </h2>
      <div className="mt-3 space-y-4 text-[17px] leading-relaxed text-pretty sm:text-lg">
        {children}
      </div>
    </section>
  );
}

/** A list of short points, each with a bold lead-in when it has one. */
export function Points({ children }: { children: ReactNode }) {
  return <ul className="space-y-3">{children}</ul>;
}

export function Point({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <li className="relative pl-6">
      <span
        aria-hidden
        className="bg-ead absolute top-[0.7em] left-1 size-2 -translate-y-1/2 rounded-full"
      />
      {title ? <strong className="font-semibold">{title}. </strong> : null}
      {children}
    </li>
  );
}

/** A framed block: what to keep in mind, or how to reach someone. */
export function Aside({ children }: { children: ReactNode }) {
  return (
    <div className="bg-canvas rounded-2xl px-4 py-4 sm:px-5 print:border print:border-neutral-300">
      {children}
    </div>
  );
}

export const linkClass =
  "text-ead-dark font-semibold underline decoration-ead-dark/40 underline-offset-4 hover:decoration-ead-dark wrap-anywhere";

/** The company's details as they are filled in; the missing ones are left out. */
export function CompanyCard({ profile }: { profile: CompanyProfile }) {
  return (
    <Aside>
      <address className="not-italic">
        <p className="font-display text-lg font-bold">{profile.name}</p>
        {profile.address ? <p className="mt-1 whitespace-pre-line">{profile.address}</p> : null}
        {profile.phone || profile.email ? (
          <p className="mt-2 space-y-1">
            {profile.phone ? (
              <span className="block">
                Téléphone&nbsp;:{" "}
                <a href={phoneHref(profile.phone)} className={linkClass}>
                  {profile.phone}
                </a>
              </span>
            ) : null}
            {profile.email ? (
              <span className="block">
                Courriel&nbsp;:{" "}
                <a href={`mailto:${profile.email}`} className={linkClass}>
                  {profile.email}
                </a>
              </span>
            ) : null}
          </p>
        ) : null}
        {!profile.address && !profile.phone && !profile.email ? (
          <p className="text-dim mt-1">
            Ses coordonnées ne sont pas encore inscrites ici. Adressez-vous au bureau de votre
            entreprise.
          </p>
        ) : null}
      </address>
    </Aside>
  );
}

/** "le 20 novembre 2026", from "2026-11-20". */
export function longDate(day: string): string {
  const text = new Intl.DateTimeFormat("fr-CA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
  return text.replace(/^1 /, "1er ");
}
