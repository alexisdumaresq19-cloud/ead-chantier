import {
  Archive,
  Check,
  ChevronRight,
  Eye,
  Folder,
  FolderInput,
  FolderPlus,
  History,
  Pencil,
  type LucideIcon,
} from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import type { PlanFolder, Sheet as PlanSheet, SheetRevision } from "@/shared/plans";

import { errorMessage } from "../../lib/api";
import { cn } from "../../lib/cn";
import { count, formatDay, formatTime } from "../../lib/format";
import {
  Badge,
  Button,
  ButtonLink,
  confirmAction,
  Field,
  FormError,
  Input,
  QueryState,
  Sheet,
  Spinner,
  toast,
} from "../../ui";
import {
  planPaths,
  useArchiveSheet,
  useCreateFolder,
  useSetCurrentRevision,
  useSheet,
  useUpdateSheet,
} from "./data";
import { revisionName } from "./logic";
import { PlanThumb } from "./parts";

// What those who manage a project do with one sheet: rename it, move it to a
// folder, look at its revisions and choose the one the site sees, archive it.
// One window; its content changes with the step, so it never closes and
// reopens under the finger.

type Step = "menu" | "rename" | "move" | "revisions";

/** Mounted for one sheet at a time; closing it unmounts it. */
export function SheetMenu({
  projectId,
  sheet,
  folders,
  onClose,
}: {
  projectId: string;
  sheet: PlanSheet;
  folders: PlanFolder[];
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("menu");
  const renameFormId = useId();
  const update = useUpdateSheet(projectId);
  const archive = useArchiveSheet(projectId);
  const folder = folders.find((candidate) => candidate.id === sheet.folderId);

  const archiveSheet = async () => {
    const confirmed = await confirmAction({
      title: `Archiver la feuille ${sheet.number}?`,
      text: "Elle ne sera plus visible au chantier. Pour la remettre plus tard, importez de nouveau son PDF.",
      confirmLabel: "Archiver",
      danger: true,
    });
    if (!confirmed) return;
    // Awaited here rather than in a callback of this window: once the list no
    // longer holds the sheet, the window is gone and its callbacks with it.
    await archive.mutateAsync(sheet.id).then(
      () => {
        toast.success(`Feuille ${sheet.number} archivée`);
        onClose();
      },
      () => {},
    );
  };

  const back = (
    <Button variant="secondary" onClick={() => setStep("menu")} disabled={update.isPending}>
      Retour
    </Button>
  );

  if (step === "rename") {
    return (
      <Sheet
        open
        onClose={onClose}
        title={`Renommer ${sheet.number}`}
        footer={
          <>
            {back}
            <Button type="submit" form={renameFormId} loading={update.isPending}>
              Enregistrer
            </Button>
          </>
        }
      >
        <Rename formId={renameFormId} sheet={sheet} update={update} onClose={onClose} />
      </Sheet>
    );
  }
  if (step === "move") {
    return (
      <Sheet open onClose={onClose} title={`Déplacer ${sheet.number}`} footer={back}>
        <Move
          projectId={projectId}
          sheet={sheet}
          folders={folders}
          update={update}
          onClose={onClose}
        />
      </Sheet>
    );
  }
  if (step === "revisions") {
    return (
      <Sheet
        open
        onClose={onClose}
        title={`Révisions de ${sheet.number}`}
        description="La plus récente en premier. Le chantier voit celle que vous choisissez."
        footer={back}
      >
        <Revisions projectId={projectId} sheet={sheet} />
      </Sheet>
    );
  }
  return (
    <Sheet open onClose={onClose} title={sheet.number} description={sheet.title || undefined}>
      <ul className={choices}>
        <Action icon={Pencil} label="Renommer" onClick={() => setStep("rename")} />
        <Action
          icon={FolderInput}
          label="Déplacer dans un dossier"
          detail={folder?.name ?? "Sans dossier"}
          onClick={() => setStep("move")}
        />
        <Action
          icon={History}
          label="Révisions"
          detail={count(sheet.revisionCount, "révision")}
          onClick={() => setStep("revisions")}
        />
        <Action
          icon={Archive}
          label="Archiver la feuille"
          danger
          busy={archive.isPending}
          onClick={archiveSheet}
        />
      </ul>
      {archive.isError ? (
        <div className="mt-3">
          <FormError>{errorMessage(archive.error)}</FormError>
        </div>
      ) : null}
    </Sheet>
  );
}

/** Grouped rows in one frame, as in the documents' management window. */
const choices = "divide-line border-line divide-y overflow-hidden rounded-2xl border";
const choice =
  "flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-2 text-left font-semibold transition-colors hover:bg-canvas active:bg-canvas disabled:pointer-events-none disabled:opacity-60";

function Action({
  icon: Icon,
  label,
  detail,
  danger,
  busy,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  detail?: string;
  danger?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={cn(choice, danger && "text-bad")}
      >
        <Icon className={cn("size-5 shrink-0", !danger && "text-ead-dark")} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block">{label}</span>
          {detail ? (
            <span className="text-dim block truncate text-sm font-normal">{detail}</span>
          ) : null}
        </span>
        {busy ? (
          <Spinner className="size-5" />
        ) : danger ? null : (
          <ChevronRight className="text-dim size-5 shrink-0" aria-hidden />
        )}
      </button>
    </li>
  );
}

type Update = ReturnType<typeof useUpdateSheet>;

function Rename({
  formId,
  sheet,
  update,
  onClose,
}: {
  formId: string;
  sheet: PlanSheet;
  update: Update;
  onClose: () => void;
}) {
  const [number, setNumber] = useState(sheet.number);
  const [title, setTitle] = useState(sheet.title);
  const [missing, setMissing] = useState(false);
  const numberId = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const wanted = { number: number.trim(), title: title.trim() };
    if (!wanted.number) {
      setMissing(true);
      document.getElementById(numberId)?.focus();
      return;
    }
    if (wanted.number === sheet.number && wanted.title === sheet.title) return onClose();
    update.mutate(
      { sheetId: sheet.id, ...wanted },
      {
        onSuccess: () => {
          toast.success(`Feuille ${wanted.number} renommée`);
          onClose();
        },
      },
    );
  };

  return (
    // Checked here rather than by the browser, whose bubble may speak English.
    <form id={formId} onSubmit={submit} noValidate className="space-y-4">
      <Field
        label="Numéro"
        hint={"Comme dans le cartouche du plan\u00a0: C-201, S-102…"}
        error={missing ? "Inscrivez le numéro de la feuille." : null}
      >
        <Input
          id={numberId}
          value={number}
          onChange={(event) => {
            setNumber(event.target.value);
            if (event.target.value.trim()) setMissing(false);
          }}
          maxLength={40}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          aria-invalid={missing || undefined}
          className="font-display font-bold"
        />
      </Field>
      <Field label="Titre">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          autoComplete="off"
        />
      </Field>
      <FormError>{update.isError ? errorMessage(update.error) : null}</FormError>
    </form>
  );
}

function Move({
  projectId,
  sheet,
  folders,
  update,
  onClose,
}: {
  projectId: string;
  sheet: PlanSheet;
  folders: PlanFolder[];
  update: Update;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [missing, setMissing] = useState(false);
  const nameId = useId();
  const problemId = useId();
  const create = useCreateFolder(projectId);
  const busy = update.isPending || create.isPending;
  const target = update.isPending ? (update.variables.folderId ?? null) : undefined;

  const moveTo = (folder: PlanFolder | null) => {
    if ((folder?.id ?? null) === sheet.folderId) return onClose();
    update.mutate(
      { sheetId: sheet.id, folderId: folder?.id ?? null },
      {
        onSuccess: () => {
          toast.success(
            folder
              ? `${sheet.number} déplacée dans « ${folder.name} »`
              : `${sheet.number} retirée de son dossier`,
          );
          onClose();
        },
      },
    );
  };

  const createAndMove = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) return create.mutate(name.trim(), { onSuccess: moveTo });
    setMissing(true);
    document.getElementById(nameId)?.focus();
  };

  return (
    <>
      <ul className={choices}>
        {[...folders, null].map((folder) => {
          const here = (folder?.id ?? null) === sheet.folderId;
          return (
            <li key={folder?.id ?? "none"}>
              <button
                type="button"
                onClick={() => moveTo(folder)}
                disabled={busy}
                aria-current={here || undefined}
                className={cn(choice, here && "text-ead-dark")}
              >
                <Folder
                  className={cn("size-5 shrink-0", folder ? "text-ead-dark" : "text-dim")}
                  aria-hidden
                />
                <span className={cn("min-w-0 flex-1 truncate", !folder && "text-dim")}>
                  {folder?.name ?? "Sans dossier"}
                </span>
                {target === (folder?.id ?? null) ? (
                  <Spinner className="size-5" />
                ) : here ? (
                  <Check className="text-ead-dark size-5 shrink-0" aria-label="Dossier actuel" />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <form onSubmit={createAndMove} noValidate className="mt-5">
        <label htmlFor={nameId} className="mb-1.5 block text-sm font-semibold">
          Nouveau dossier
        </label>
        <div className="flex gap-2">
          <Input
            id={nameId}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (event.target.value.trim()) setMissing(false);
            }}
            placeholder={"Ex.\u00a0: Structure"}
            maxLength={60}
            autoComplete="off"
            disabled={busy}
            aria-invalid={missing || undefined}
            aria-describedby={missing ? problemId : undefined}
          />
          <Button
            type="submit"
            variant="secondary"
            className="h-12"
            loading={create.isPending}
            disabled={busy}
          >
            <FolderPlus aria-hidden /> Créer
          </Button>
        </div>
        {missing ? (
          <p id={problemId} className="text-bad mt-1.5 text-sm font-medium">
            Inscrivez le nom du dossier.
          </p>
        ) : null}
      </form>
      <div className="mt-3">
        <FormError>
          {create.isError
            ? errorMessage(create.error)
            : update.isError
              ? errorMessage(update.error)
              : null}
        </FormError>
      </div>
    </>
  );
}

function Revisions({ projectId, sheet }: { projectId: string; sheet: PlanSheet }) {
  const detail = useSheet(projectId, sheet.id);
  const choose = useSetCurrentRevision(projectId);

  const show = async (revision: SheetRevision) => {
    const name = revisionTitle(revision);
    const confirmed = await confirmAction({
      title: `Montrer « ${name} » au chantier?`,
      text: `Tout le monde verra cette révision de la feuille ${sheet.number}, ajoutée le ${addedOn(revision)}. Les autres révisions restent ici.`,
      confirmLabel: "Montrer au chantier",
    });
    if (!confirmed) return;
    choose.mutate(
      { sheetId: sheet.id, revisionId: revision.id },
      { onSuccess: () => toast.success(`Le chantier voit maintenant « ${name} »`) },
    );
  };

  return (
    <>
      <QueryState query={detail}>
        {(data) => (
          <ul className="space-y-3">
            {data.revisions.map((revision) => {
              const current = revision.id === data.current?.id;
              return (
                <li
                  key={revision.id}
                  className={cn(
                    "rounded-xl border p-3",
                    current ? "border-ead/50 bg-ead-tint/50" : "border-line",
                  )}
                >
                  <div className="flex gap-3">
                    <PlanThumb
                      url={revision.thumbUrl}
                      tiles={revision.tiles}
                      className="h-14 w-19"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="font-display font-bold">{revisionTitle(revision)}</p>
                        {current ? (
                          <Badge tone="blue">
                            <Eye aria-hidden /> Vue au chantier
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-dim mt-0.5 text-sm">{revisionDates(revision)}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <ButtonLink
                      href={planPaths.sheet(projectId, sheet.id, current ? undefined : revision.id)}
                      variant="secondary"
                      className="flex-1"
                    >
                      Ouvrir
                    </ButtonLink>
                    {current ? null : (
                      <Button
                        className="flex-1"
                        onClick={() => show(revision)}
                        loading={choose.isPending && choose.variables.revisionId === revision.id}
                        disabled={choose.isPending}
                      >
                        Montrer au chantier
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
      <div className="mt-3">
        <FormError>{choose.isError ? errorMessage(choose.error) : null}</FormError>
      </div>
    </>
  );
}

/** A revision's name; one the office left unnamed is told by the day it was added. */
const revisionTitle = (revision: SheetRevision) =>
  revisionName(revision.label) ?? `Révision du ${formatDay(revision.addedAt)}`;

/**
 * To the minute: two revisions added the same day, left unnamed, are told
 * apart by it. The time stays in one piece at the end of a line.
 */
const addedOn = (revision: SheetRevision) =>
  `${formatDay(revision.addedAt)} à\u00a0${formatTime(revision.addedAt).replace(/\s/g, "\u00a0")}`;

const revisionDates = (revision: SheetRevision) =>
  [
    revision.issuedOn ? `Émise le ${formatDay(revision.issuedOn)}` : null,
    `Ajoutée le ${addedOn(revision)}`,
  ]
    .filter(Boolean)
    .join(" · ");
