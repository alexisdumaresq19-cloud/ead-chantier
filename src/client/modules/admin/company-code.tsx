import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Check,
  Copy,
  KeyRound,
  CirclePause,
  Printer,
  QrCode as QrIcon,
  RefreshCw,
  Share2,
} from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { formatCompanyCode, signupLink, type CompanyCode } from "@/shared/signup";

import { api, errorMessage } from "../../lib/api";
import { cn } from "../../lib/cn";
import { count, formatDay } from "../../lib/format";
import { queryClient } from "../../lib/query";
import { isNativeApp } from "../../native";
import { Badge, Button, Card, confirmAction, LogoFull, Sheet, Skeleton, toast } from "../../ui";
import { canShareHere, LinkField, shareHere } from "./invite-link";
import { pauseText } from "./people";
import { QrCode } from "./qr";
import { ShownError } from "./shown-error";

// The company code, on the office's team screen: one code for the whole
// company, that lets a newcomer make their own account (a worker on no
// project, until the office adds them to their sites). Closed until the
// office opens it.

const KEY = ["company-code"] as const;

const useCompanyCode = () =>
  useQuery({
    queryKey: KEY,
    queryFn: () => api<CompanyCode>("/api/company/code"),
    // The code is a key to the company: it is not kept on the device.
    meta: { persist: false },
  });

/** "Changé par Camille Roy le 20 novembre 2026." */
const changedText = (code: CompanyCode) =>
  code.changedAt
    ? [
        code.code ? "Code créé" : "Fermé",
        code.changedBy ? `par ${code.changedBy}` : null,
        `le ${formatDay(code.changedAt)}.`,
      ]
        .filter(Boolean)
        .join(" ")
    : null;

const SHARE_TEXT = (code: string) =>
  `Pour créer votre compte EAD Chantier, ouvrez ce lien. Code d'entreprise\u00a0: ${formatCompanyCode(code)}`;

export function CompanyCodeCard({ className }: { className?: string }) {
  const company = useCompanyCode();
  const [showing, setShowing] = useState(false);
  const [copied, setCopied] = useState(false);
  const change = useMutation({
    mutationFn: (action: "new" | "close") =>
      api<CompanyCode>("/api/company/code", { method: action === "new" ? "POST" : "DELETE" }),
    onSuccess: (data, action) => {
      queryClient.setQueryData(KEY, data);
      setCopied(false);
      toast.success(
        action === "close"
          ? "Création de comptes fermée"
          : company.data?.code
            ? "Nouveau code créé. L'ancien ne fonctionne plus."
            : "Création de comptes ouverte",
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const replace = async () => {
    const ok = await confirmAction({
      title: "Changer le code?",
      text: "L'ancien code cessera de fonctionner tout de suite, sur une affiche comme dans un texto. Les comptes déjà créés restent.",
      confirmLabel: "Changer le code",
    });
    if (ok) change.mutate("new");
  };
  const close = async () => {
    const ok = await confirmAction({
      title: "Fermer la création de comptes?",
      text: "Le code cessera de fonctionner. Les comptes déjà créés restent. Si vous rouvrez, un nouveau code sera créé.",
      confirmLabel: "Fermer",
    });
    if (ok) change.mutate("close");
  };
  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Code copié");
    } catch {
      toast("Copiez le code à la main\u00a0: la copie n'est pas permise ici.");
    }
  };

  const data = company.data;
  const pending = change.isPending ? change.variables : null;
  return (
    <Card className={cn("mb-8 p-4 sm:p-5", className)} role="region" aria-labelledby="company-code">
      <div className="flex items-center gap-3">
        <span className="bg-ead-tint text-ead-dark flex size-11 shrink-0 items-center justify-center rounded-xl">
          <KeyRound className="size-5.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="company-code" className="font-display text-lg leading-tight font-bold">
            Code d&apos;entreprise
          </h2>
          {data ? (
            <p className="text-dim text-sm">
              {!data.code
                ? "Création de comptes fermée"
                : data.pause
                  ? "Création de comptes en pause"
                  : "Création de comptes ouverte"}
            </p>
          ) : null}
        </div>
        {data?.code ? (
          data.pause ? (
            <Badge tone="warn">En pause</Badge>
          ) : (
            <Badge tone="good">Ouvert</Badge>
          )
        ) : null}
      </div>
      <p className="text-dim mt-3 max-w-prose text-[15px] text-pretty">
        Avec ce code, une personne de l&apos;équipe crée elle-même son compte, comme travailleur.
        Elle ne voit aucun chantier tant que vous ne l&apos;y avez pas ajoutée.
      </p>

      {company.isPending ? (
        <Skeleton className="mt-4 h-24" />
      ) : company.isError ? (
        <div className="mt-4">
          <ShownError error={company.error} />
        </div>
      ) : data?.code ? (
        <>
          <div className="bg-canvas mt-4 flex flex-col items-center gap-3 rounded-2xl px-4 py-5 sm:flex-row sm:justify-between sm:px-6">
            <p
              className="font-display text-[44px] leading-none font-bold tracking-[0.06em] tabular-nums"
              aria-label={`Code d'entreprise ${data.code.split("").join(" ")}`}
            >
              {formatCompanyCode(data.code)}
            </p>
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
              <Button variant="secondary" onClick={() => copy(data.code!)}>
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? "Copié" : "Copier"}
              </Button>
              <Button variant="secondary" onClick={() => setShowing(true)}>
                <QrIcon aria-hidden /> Code QR
              </Button>
            </div>
          </div>
          {data.pause ? (
            <Paused pause={data.pause} onReplace={replace} replacing={pending === "new"} />
          ) : null}
          <p className="text-dim mt-2 text-sm">
            {[
              changedText(data),
              data.accountsToday > 0
                ? `${count(data.accountsToday, "compte créé", "comptes créés")} depuis 24\u00a0heures.`
                : null,
            ]
              .filter(Boolean)
              .join(" ")}
          </p>
          <div className="mt-2 -ml-4 flex flex-wrap gap-x-1">
            {data.pause ? null : (
              <Button variant="ghost" onClick={replace} loading={pending === "new"}>
                <RefreshCw aria-hidden /> Changer le code
              </Button>
            )}
            <Button
              variant="ghost"
              className="text-dim"
              onClick={close}
              loading={pending === "close"}
            >
              Fermer la création de comptes
            </Button>
          </div>
          <CodeSheet code={data.code} open={showing} onClose={() => setShowing(false)} />
          {/* While the code is on screen, printing gives its poster. */}
          {showing ? <CodePoster code={data.code} /> : null}
        </>
      ) : (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            variant="secondary"
            onClick={() => change.mutate("new")}
            loading={pending === "new"}
          >
            <KeyRound aria-hidden /> Ouvrir la création de comptes
          </Button>
          {data && changedText(data) ? (
            <p className="text-dim text-sm sm:ml-2">{changedText(data)}</p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/**
 * Account creation paused for everyone (too many wrong codes, or the day's
 * accounts all made): said plainly, with the one way to reopen at once.
 */
function Paused({
  pause,
  onReplace,
  replacing,
}: {
  pause: NonNullable<CompanyCode["pause"]>;
  onReplace: () => void;
  replacing: boolean;
}) {
  const { title, text } = pauseText(pause);
  return (
    <div className="bg-warn-tint text-warn mt-3 rounded-xl px-3.5 py-3" role="status">
      <p className="flex items-start gap-2.5 text-[15px] text-pretty">
        <CirclePause className="mt-0.5 size-5 shrink-0" aria-hidden />
        <span>
          <strong className="font-semibold">{title}.</strong> {text}
        </span>
      </p>
      <Button className="mt-3 w-full sm:w-auto" onClick={onReplace} loading={replacing}>
        <RefreshCw aria-hidden /> Changer le code
      </Button>
    </div>
  );
}

/** The code as a QR code and a link that fill it in, to send or to print for the trailer. */
function CodeSheet({ code, open, onClose }: { code: string; open: boolean; onClose: () => void }) {
  const url = signupLink(window.location.origin, code);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Créer son compte"
      description={`Code d'entreprise ${formatCompanyCode(code)}`}
    >
      <div className="border-line mx-auto w-full max-w-[min(100%,50dvh)] overflow-hidden rounded-2xl border bg-white">
        <QrCode value={url} label="Code QR pour créer son compte" />
      </div>
      <p className="mt-3 text-center text-[15px] font-semibold text-pretty">
        À scanner avec l&apos;appareil photo du téléphone
      </p>
      <p className="text-dim mt-1 text-center text-sm text-pretty">
        Le lien ouvre la création de compte avec le code déjà rempli.
      </p>
      <div className="mt-4 space-y-2">
        <LinkField url={url} label="Lien pour créer son compte" />
        <div className="flex flex-wrap gap-2 *:flex-1">
          {canShareHere() ? (
            <Button
              variant="secondary"
              onClick={() => shareHere({ title: "EAD Chantier", text: SHARE_TEXT(code), url })}
            >
              <Share2 aria-hidden /> Partager
            </Button>
          ) : null}
          {isNativeApp() ? null : (
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer aria-hidden /> Imprimer l&apos;affiche
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

// Letter paper without margins: the poster sets its own. The poster is put
// straight in the page's body, so that printing leaves out everything else
// (the window, the team list) and fits one sheet.
const PRINT_RULES = `
@page { size: letter portrait; margin: 0; }
@media print {
  html, body { background: #fff !important; }
  body > :not([data-poster]) { display: none !important; }
}`;

/** The poster for the trailer: hidden on screen, alone on the sheet when printed. */
function CodePoster({ code }: { code: string }) {
  const url = signupLink(window.location.origin, code);
  return createPortal(
    <div
      data-poster
      className="hidden bg-white text-black print:fixed print:inset-0 print:z-50 print:flex print:flex-col"
    >
      <style>{PRINT_RULES}</style>
      <div className="bg-ink flex items-center justify-between gap-8 px-[0.7in] py-[0.3in] text-white [-webkit-print-color-adjust:exact] [print-color-adjust:exact]">
        <LogoFull className="w-[1.7in]" />
        <p className="font-display text-right text-[21pt] leading-tight font-bold">
          Créez votre compte
          <br />
          EAD Chantier
        </p>
      </div>
      <div className="flex flex-1 flex-col items-center px-[0.7in] pt-[0.4in] pb-[0.45in] text-center">
        <p className="font-display text-ead-dark text-[13pt] font-bold tracking-wider uppercase">
          Code d&apos;entreprise
        </p>
        <p className="font-display mt-1 text-[54pt] leading-none font-extrabold tracking-[0.06em]">
          {formatCompanyCode(code)}
        </p>
        <div className="flex min-h-0 flex-1 items-center justify-center py-[0.3in]">
          <QrCode
            value={url}
            level="M"
            label="Code QR pour créer son compte"
            className="h-full max-h-[4.2in] w-auto max-w-full"
          />
        </div>
        <ol className="space-y-1.5 text-left text-[15pt] leading-snug">
          <li>
            <strong>1.</strong> Visez ce code avec l&apos;appareil photo de votre téléphone.
          </li>
          <li>
            <strong>2.</strong> Inscrivez votre nom et votre cellulaire.
          </li>
          <li>
            <strong>3.</strong> Le bureau vous ajoute ensuite à vos chantiers.
          </li>
        </ol>
        <p className="font-display mt-[0.3in] text-[10.5pt] font-bold">
          Les Entreprises Allen Dumaresq · EAD Chantier
        </p>
      </div>
    </div>,
    document.body,
  );
}
