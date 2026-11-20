import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Check,
  CircleAlert,
  Copy,
  FolderKanban,
  Presentation,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import {
  ACCESS_CODE_HOW,
  appleReviewText,
  DEMO_REMAKES_PER_DAY,
  DEMO_SESSION_DAYS,
  formatAccessCode,
  type DemoAccess,
  type DemoAccessChange,
  type DemoAccessState,
} from "@/shared/access";
import type { ProjectSummary } from "@/shared/api";

import { api, errorMessage } from "../../lib/api";
import { cn } from "../../lib/cn";
import { count, formatDay, formatTime } from "../../lib/format";
import { queryClient } from "../../lib/query";
import { useProjects } from "../../lib/session";
import { Badge, Button, Card, confirmAction, Sheet, Skeleton, toast } from "../../ui";
import { refreshPeople } from "./data";
import { lastSeenText } from "./people";
import { ProjectPicker } from "./project-picker";
import { ShownError } from "./shown-error";

// The demonstration access (users.demo, src/server/access-code/demo.ts): a
// cell number from the range kept for fiction and a code, that the office
// hands to someone who must see the app without being on the team, such as
// Apple's reviewer. The visitor sees the chosen projects as a foreman does,
// and never touches the team.

const KEY = ["demo-access"] as const;

const useDemoAccess = () =>
  useQuery({
    queryKey: KEY,
    queryFn: () => api<DemoAccessState>("/api/company/demo"),
    // A key to those projects: it is not kept on the device.
    meta: { persist: false },
  });

/** "Modifié par Camille Roy le 20 novembre 2026.", as the other cards of Équipe say it. */
const changedText = (access: DemoAccess) =>
  [
    "Modifié",
    access.changedBy ? `par ${access.changedBy}` : null,
    `le ${formatDay(access.changedAt)}.`,
  ]
    .filter(Boolean)
    .join(" ");

type Action = { kind: "create"; projectIds: string[] } | ({ kind: "change" } & DemoAccessChange);

export function DemoAccessCard({ className }: { className?: string }) {
  const demo = useDemoAccess();
  const projects = useProjects();
  const [picking, setPicking] = useState(false);
  const save = useMutation({
    mutationFn: (action: Action) =>
      action.kind === "create"
        ? api<DemoAccessState>("/api/company/demo", {
            method: "POST",
            body: { projectIds: action.projectIds },
          })
        : api<DemoAccessState>("/api/company/demo", {
            method: "PATCH",
            body: { projectIds: action.projectIds, newCode: action.newCode },
          }),
    onSuccess: (data, action) => {
      queryClient.setQueryData(KEY, data);
      setPicking(false);
      toast.success(
        action.kind === "create"
          ? "Accès de démonstration créé"
          : action.newCode
            ? "Nouveau code créé. Les visiteurs sont déconnectés."
            : "Projets enregistrés",
      );
      return refreshPeople();
    },
    onError: (error, action) => {
      // The window shows its own error; a new code is asked from the card.
      if (action.kind === "change" && action.newCode) toast.error(errorMessage(error));
    },
  });
  const remove = useMutation({
    mutationFn: () => api<DemoAccessState>("/api/company/demo", { method: "DELETE" }),
    onSuccess: (data) => {
      queryClient.setQueryData(KEY, data);
      toast.success("Accès de démonstration retiré");
      return refreshPeople();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const newCode = async () => {
    const ok = await confirmAction({
      title: "Changer le code de démonstration?",
      text: "L'ancien code cessera de fonctionner tout de suite, et les appareils connectés en démonstration seront déconnectés.",
      confirmLabel: "Changer le code",
    });
    if (ok) save.mutate({ kind: "change", newCode: true });
  };
  const removeAccess = async () => {
    const ok = await confirmAction({
      title: "Retirer l'accès de démonstration?",
      text: "Le numéro et le code cesseront de fonctionner, et le compte de démonstration sera déconnecté partout, puis supprimé. Vous pourrez en créer un autre.",
      confirmLabel: "Retirer l'accès",
      danger: true,
    });
    if (ok) remove.mutate();
  };

  const access = demo.data?.access ?? null;
  const all = projects.data ?? [];
  const pendingCode =
    save.isPending && save.variables.kind === "change" && save.variables.newCode === true;
  return (
    <Card className={cn("p-4 sm:p-5", className)} role="region" aria-labelledby="demo-access">
      <div className="flex items-center gap-3">
        <span className="bg-ead-tint text-ead-dark flex size-11 shrink-0 items-center justify-center rounded-xl">
          <Presentation className="size-5.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="demo-access" className="font-display text-lg leading-tight font-bold">
            Accès de démonstration
          </h2>
          {demo.data ? (
            <p className="text-dim text-sm">
              {access ? lastSeenText(access.lastSeenAt) : "Aucun accès pour l'instant"}
            </p>
          ) : null}
        </div>
        {access ? (
          access.pausedUntil ? (
            <Badge tone="warn">En pause</Badge>
          ) : (
            <Badge tone="good">Actif</Badge>
          )
        ) : null}
      </div>
      <p className="text-dim mt-3 max-w-prose text-[15px] text-pretty">
        Pour montrer l&apos;application à une personne hors de l&apos;équipe, par exemple
        l&apos;équipe d&apos;Apple qui vérifie l&apos;application. Le visiteur voit les projets
        choisis comme un contremaître. Il peut y ajouter des photos, des documents et des rapports.
        Il ne change rien à l&apos;équipe, ni aux plans, ni à ce que d&apos;autres ont ajouté.
      </p>

      {demo.isPending ? (
        <Skeleton className="mt-4 h-24" />
      ) : demo.isError ? (
        <div className="mt-4">
          <ShownError error={demo.error} />
        </div>
      ) : access ? (
        <>
          {access.pausedUntil ? (
            <div className="bg-warn-tint text-warn mt-4 rounded-xl px-3.5 py-3" role="status">
              <p className="flex items-start gap-2.5 text-[15px] text-pretty">
                <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
                <span>
                  <strong className="font-semibold">
                    Personne n&apos;entre avant le {formatDay(access.pausedUntil)} à{" "}
                    {formatTime(access.pausedUntil)}.
                  </strong>{" "}
                  Le compte de démonstration a été supprimé et refait {DEMO_REMAKES_PER_DAY}
                  &nbsp;fois aujourd&apos;hui. Changez le code pour le rouvrir tout de suite, et
                  donnez le nouveau code au visiteur.
                </span>
              </p>
            </div>
          ) : null}
          <div className="bg-canvas mt-4 grid gap-4 rounded-2xl p-4 sm:grid-cols-2 sm:p-5">
            <Value label="Cellulaire" value={access.phone} toCopy={access.phone} />
            <Value
              label="Code"
              value={formatAccessCode(access.code)}
              toCopy={access.code}
              spoken={`Code ${access.code.split("").join(" ")}`}
            />
          </div>
          <p className="text-dim mt-3 text-sm text-pretty">
            {ACCESS_CODE_HOW} Chaque connexion dure {DEMO_SESSION_DAYS}&nbsp;jour. Ce numéro
            n&apos;appartient à personne&nbsp;: il est réservé aux exemples.
          </p>
          <div className="border-line mt-3 rounded-2xl border p-3.5">
            <p className="text-sm text-pretty">
              <span className="font-semibold">Pour Apple</span>, dans App Store Connect, aux
              informations de connexion pour la vérification&nbsp;: le cellulaire va comme nom
              d&apos;utilisateur, le code comme mot de passe, et le chemin dans les notes.
            </p>
            <CopyButton text={appleReviewText(access)} done="Copié pour Apple" className="mt-2.5">
              Copier pour Apple
            </CopyButton>
          </div>
          <div className="mt-4">
            <p className="text-sm font-semibold">Projets montrés</p>
            <ul className="mt-1 space-y-0.5 text-[15px]">
              {access.projectIds.map((id) => (
                <li key={id} className="flex items-center gap-2">
                  <FolderKanban className="text-dim size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 wrap-anywhere">
                    {all.find((project) => project.id === id)?.name ?? "Projet"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-dim mt-3 text-sm">{changedText(access)}</p>
          <div className="mt-2 -ml-4 flex flex-wrap gap-x-1">
            <Button variant="ghost" onClick={() => setPicking(true)}>
              <FolderKanban aria-hidden /> Changer les projets
            </Button>
            <Button variant="ghost" onClick={newCode} loading={pendingCode}>
              <RefreshCw aria-hidden /> Changer le code
            </Button>
            <Button
              variant="ghost"
              className="text-bad"
              onClick={removeAccess}
              loading={remove.isPending}
            >
              <Trash2 aria-hidden /> Retirer l&apos;accès
            </Button>
          </div>
        </>
      ) : (
        <div className="mt-4">
          <Button variant="secondary" onClick={() => setPicking(true)}>
            <Presentation aria-hidden /> Créer l&apos;accès de démonstration
          </Button>
        </div>
      )}

      <ProjectsSheet
        // A fresh choice each time the window opens.
        key={picking ? "open" : "closed"}
        open={picking}
        onClose={() => {
          setPicking(false);
          save.reset();
        }}
        projects={all}
        initial={access?.projectIds ?? []}
        creating={!access}
        saving={save.isPending && !pendingCode}
        error={pendingCode ? null : save.error}
        onSave={(projectIds) =>
          save.mutate(access ? { kind: "change", projectIds } : { kind: "create", projectIds })
        }
      />
    </Card>
  );
}

/** One of the two things the visitor types, large, with a button that copies it. */
function Value({
  label,
  value,
  toCopy,
  spoken,
}: {
  label: string;
  value: string;
  toCopy: string;
  spoken?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toCopy);
      setCopied(true);
      toast.success(`${label} copié`);
    } catch {
      toast("Copiez-le à la main\u00a0: la copie n'est pas permise ici.");
    }
  };
  return (
    <div className="min-w-0">
      <p className="font-display text-dim text-xs font-bold tracking-wider uppercase">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p
          className="font-display text-[clamp(24px,7.5vw,28px)] leading-none font-bold tracking-[0.04em] whitespace-nowrap tabular-nums"
          aria-label={spoken}
        >
          {value}
        </p>
        <Button
          variant="secondary"
          onClick={copy}
          className="shrink-0 max-sm:w-11 max-sm:px-0"
          aria-label={`Copier le ${label.toLowerCase()}`}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {/* On a small phone the icon alone leaves the number its whole width. */}
          <span className="max-sm:sr-only">{copied ? "Copié" : "Copier"}</span>
        </Button>
      </div>
    </div>
  );
}

/** Copies a text made for pasting elsewhere, and says so. */
function CopyButton({
  text,
  done,
  className,
  children,
}: {
  text: string;
  done: string;
  className?: string;
  children: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(done);
    } catch {
      toast("Copiez-le à la main\u00a0: la copie n'est pas permise ici.");
    }
  };
  return (
    <Button variant="secondary" onClick={copy} className={className}>
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? "Copié" : children}
    </Button>
  );
}

/** The projects the visitor sees, to tick: for a new access, or to change them. */
function ProjectsSheet({
  open,
  onClose,
  projects,
  initial,
  creating,
  saving,
  error,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  projects: ProjectSummary[];
  initial: string[];
  creating: boolean;
  saving: boolean;
  error: unknown;
  onSave: (projectIds: string[]) => void;
}) {
  const [chosen, setChosen] = useState(initial);
  const [checked, setChecked] = useState(false);
  const missing = checked && chosen.length === 0;
  const withoutPlans = projects.filter(
    (project) => chosen.includes(project.id) && project.sheetCount === 0,
  );
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={creating ? "Créer l'accès de démonstration" : "Projets montrés"}
      description={
        "Le visiteur verra les plans, les documents, les photos et les rapports de ces projets, avec les noms et les heures de l'équipe, et pourra y ajouter les siens. Choisissez des projets d'exemple."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={saving}
            onClick={() => {
              setChecked(true);
              if (chosen.length) onSave(chosen);
            }}
          >
            {creating ? "Créer l'accès" : "Enregistrer"}
          </Button>
        </>
      }
    >
      <ProjectPicker
        projects={projects}
        value={chosen}
        onChange={setChosen}
        // What the visitor will find there: a project with no plans shows nothing to open.
        detail={(project) => count(project.sheetCount, "feuille")}
      />
      {withoutPlans.length ? (
        <p className="text-warn mt-2 text-sm font-medium text-pretty" role="status">
          {withoutPlans.length === 1
            ? `${withoutPlans[0].name} n'a pas de plans\u00a0: le visiteur n'y verra aucune feuille à ouvrir.`
            : "Des projets cochés n'ont pas de plans\u00a0: le visiteur n'y verra aucune feuille à ouvrir."}
        </p>
      ) : null}
      {missing ? (
        <p className="text-bad mt-2 text-sm font-medium">Cochez au moins un projet à montrer.</p>
      ) : null}
      <div className="mt-3">
        <ShownError error={error} />
      </div>
    </Sheet>
  );
}
