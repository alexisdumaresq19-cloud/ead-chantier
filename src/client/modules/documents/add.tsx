import {
  CircleAlert,
  CircleCheck,
  FilePlus2,
  Plus,
  RotateCw,
  Send,
  Upload,
  WifiOff,
  X,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { Redirect } from "wouter";

import {
  ACCEPTED_FILES_LABEL,
  DOCUMENT_ACCEPT,
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  DOCUMENT_TITLE_MAX,
  FILE_PROBLEM_LABELS,
  fileTypeOf,
  fitFilename,
  tidyTitle,
  type DocumentCategory,
} from "@/shared/documents";

import { cn } from "../../lib/cn";
import { count, formatSize } from "../../lib/format";
import { useOnline } from "../../lib/online";
import { useCurrentProject, useCurrentUser } from "../../lib/session";
import { Page } from "../../shell/page";
import {
  Button,
  ButtonLink,
  Card,
  confirmAction,
  Field,
  IconButton,
  Input,
  ProgressBar,
  Select,
  toast,
} from "../../ui";
import { uploads, useDocuments, useUploads } from "./data";
import { FileIcon } from "./file-icon";
import { addDrafts, canChangeDocuments, sameTitle, type Draft } from "./logic";
import { summarize, type UploadItem, type UploadsState } from "./upload-queue";

// What was chosen and typed, by project. It outlives the screen: a stray tap
// on a tab or a swipe back must not cost files picked one by one on a phone.
const chosen = new Map<string, { drafts: Draft[]; category: DocumentCategory | "" }>();

/**
 * Adding documents, in two moments: choosing the files, their titles and
 * their category; then watching them go, one at a time.
 */
export function AddDocumentsScreen() {
  const project = useCurrentProject();
  const canChange = canChangeDocuments(project, useCurrentUser().role);
  const sending = useUploads(project.id);
  const [drafts, setDrafts] = useState<Draft[]>(() => chosen.get(project.id)?.drafts ?? []);
  const [category, setCategory] = useState<DocumentCategory | "">(
    () => chosen.get(project.id)?.category ?? "",
  );
  useEffect(() => {
    chosen.set(project.id, { drafts, category });
  }, [project.id, drafts, category]);
  const composing = sending.items.length === 0;
  const dragging = useFileDrop((files) => {
    const { active, failed } = summarize(sending.items);
    if (active > 0 || failed > 0) {
      toast.info("Attendez la fin de l'envoi pour ajouter d'autres fichiers.");
      return;
    }
    // Dropped on the result of an earlier sending: they start the next one.
    uploads.clearDone(project.id);
    setDrafts((current) => addDrafts(current, files));
  });

  const listHref = `/projets/${project.id}/documents`;
  if (!canChange) return <Redirect to={listHref} replace />;

  return (
    <Page title="Ajouter des documents" back={{ href: listHref, label: "Documents" }} narrow>
      {composing ? (
        <Composer
          projectId={project.id}
          drafts={drafts}
          setDrafts={setDrafts}
          category={category}
          setCategory={setCategory}
          dragging={dragging}
        />
      ) : (
        <Sending projectId={project.id} sending={sending} listHref={listHref} />
      )}
    </Page>
  );
}

/**
 * Files dropped anywhere on the screen, on a computer. Listening on the whole
 * window also keeps a drop that misses its target from replacing the app
 * with the file. True while files are being dragged over the window.
 */
function useFileDrop(onFiles: (files: File[]) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const deliver = useEffectEvent(onFiles);
  useEffect(() => {
    // Entering a child element fires "enter" before the parent's "leave".
    let depth = 0;
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files");
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth++;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (carriesFiles(event)) event.preventDefault();
    };
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      deliver(Array.from(event.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);
  return dragging;
}

// --- Choosing ---------------------------------------------------------------

function Composer({
  projectId,
  drafts,
  setDrafts,
  category,
  setCategory,
  dragging,
}: {
  projectId: string;
  drafts: Draft[];
  setDrafts: (change: (drafts: Draft[]) => Draft[]) => void;
  category: DocumentCategory | "";
  setCategory: (category: DocumentCategory | "") => void;
  dragging: boolean;
}) {
  const online = useOnline();
  const existing = useDocuments(projectId).data;
  const picker = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  /** How many times "Envoyer" was pressed with something missing, which is then pointed out. */
  const [refusals, setRefusals] = useState(0);
  const checked = refusals > 0;

  // The button is at the bottom of what may be a long list: bring what is
  // missing in front of the person.
  useEffect(() => {
    if (refusals === 0) return;
    const missing = form.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    missing?.scrollIntoView({ block: "center", behavior: "smooth" });
    missing?.focus({ preventScroll: true });
  }, [refusals]);

  const accepted = drafts.filter((draft) => !draft.problem);
  const refused = drafts.length - accepted.length;

  const send = () => {
    if (!category || accepted.some((draft) => !tidyTitle(draft.title))) {
      setRefusals((times) => times + 1);
      return;
    }
    uploads.add(
      projectId,
      category,
      accepted.map(({ file, title }) => ({
        // Announced under the type its extension stands for: devices disagree
        // on the type of a DWG or a ZIP, and storage serves back what it was told.
        file: file.slice(0, file.size, fileTypeOf(file.name).contentType),
        filename: fitFilename(file.name),
        title: tidyTitle(title),
      })),
    );
    setDrafts(() => []);
    setCategory("");
    // The progress of the files takes the place of the list, from its top.
    window.scrollTo(0, 0);
  };

  const hasTwin = (draft: Draft) =>
    Boolean(existing?.some((document) => sameTitle(document.title, draft.title))) ||
    accepted.some((other) => other !== draft && sameTitle(other.title, draft.title));

  const pick = (
    <input
      ref={picker}
      type="file"
      multiple
      accept={DOCUMENT_ACCEPT}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        setDrafts((current) => addDrafts(current, files));
        // So the same file can be chosen again after being removed.
        event.target.value = "";
      }}
    />
  );

  if (drafts.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors",
          dragging ? "border-ead bg-ead-tint" : "border-line bg-surface/60",
        )}
      >
        {pick}
        <span
          className={cn(
            "text-ead-dark flex size-14 items-center justify-center rounded-2xl",
            dragging ? "bg-surface" : "bg-ead-tint",
          )}
        >
          <Upload className="size-7" aria-hidden />
        </span>
        <h2 className="font-display mt-4 text-lg font-bold">
          {dragging ? "Déposez les fichiers ici" : "Choisissez les fichiers à ajouter"}
        </h2>
        <p className="text-dim mt-1.5 max-w-sm text-[15px] text-pretty">
          Un seul ou plusieurs à la fois.
          <span className="hidden lg:inline"> Vous pouvez aussi les glisser sur cette page.</span>
        </p>
        <Button size="lg" className="mt-5" onClick={() => picker.current?.click()}>
          <FilePlus2 aria-hidden /> Choisir des fichiers
        </Button>
        <p className="text-dim mt-5 max-w-sm text-sm text-pretty">{ACCEPTED_FILES_LABEL}</p>
      </div>
    );
  }

  return (
    <form
      ref={form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      {pick}
      <Field
        label="Catégorie"
        hint="La même pour tous les fichiers de cet envoi."
        error={checked && !category ? "Choisissez une catégorie." : null}
      >
        <Select
          value={category}
          onChange={(event) => setCategory(event.target.value as DocumentCategory)}
          aria-invalid={(checked && !category) || undefined}
        >
          <option value="" disabled>
            Choisir…
          </option>
          {DOCUMENT_CATEGORIES.map((key) => (
            <option key={key} value={key}>
              {DOCUMENT_CATEGORY_LABELS[key]}
            </option>
          ))}
        </Select>
      </Field>

      <h2 className="font-display text-dim mt-6 mb-3 text-sm font-bold tracking-wider uppercase">
        {count(drafts.length, "fichier")}
      </h2>
      <ul
        className={cn(
          "space-y-2.5 rounded-2xl",
          dragging && "ring-ead ring-offset-canvas ring-3 ring-offset-4",
        )}
      >
        {drafts.map((draft) => {
          const untitled = checked && !draft.problem && !tidyTitle(draft.title);
          const remove = () =>
            setDrafts((current) => current.filter((other) => other.key !== draft.key));
          return (
            <li key={draft.key}>
              <Card className="flex items-start gap-3 py-3 pr-1.5 pl-3">
                <FileIcon
                  filename={draft.file.name}
                  className={cn("mt-0.5", draft.problem && "opacity-50")}
                />
                {draft.problem ? (
                  <div className="min-w-0 flex-1 py-0.5">
                    <p className="font-semibold wrap-anywhere">{draft.file.name}</p>
                    <p className="text-bad mt-0.5 flex items-center gap-1.5 text-sm font-medium">
                      <CircleAlert className="size-4 shrink-0" aria-hidden />
                      {FILE_PROBLEM_LABELS[draft.problem]}
                    </p>
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <Input
                      value={draft.title}
                      onChange={(event) => {
                        const title = event.target.value;
                        setDrafts((current) =>
                          current.map((other) =>
                            other.key === draft.key ? { ...other, title } : other,
                          ),
                        );
                      }}
                      maxLength={DOCUMENT_TITLE_MAX}
                      aria-label={`Titre de ${draft.file.name}`}
                      aria-invalid={untitled || undefined}
                      placeholder="Titre du document"
                      autoComplete="off"
                      enterKeyHint="done"
                    />
                    <p className="text-dim mt-1.5 flex text-sm">
                      <span className="truncate">{draft.file.name}</span>
                      <span className="shrink-0">&nbsp;· {formatSize(draft.file.size)}</span>
                    </p>
                    {untitled ? (
                      <p className="text-bad mt-0.5 text-sm font-medium">Donnez un titre.</p>
                    ) : hasTwin(draft) ? (
                      <p className="text-warn mt-0.5 text-sm font-medium">
                        Un autre document porte ce titre.
                      </p>
                    ) : null}
                  </div>
                )}
                <IconButton label={`Retirer ${draft.file.name}`} onClick={remove}>
                  <X aria-hidden />
                </IconButton>
              </Card>
            </li>
          );
        })}
      </ul>

      {refused > 0 ? (
        <Notice tone="bad" icon={<CircleAlert aria-hidden />} className="mt-3">
          {count(refused, "fichier ne sera pas envoyé", "fichiers ne seront pas envoyés")}.{" "}
          {ACCEPTED_FILES_LABEL}
        </Notice>
      ) : null}

      <Button variant="secondary" block className="mt-3" onClick={() => picker.current?.click()}>
        <Plus aria-hidden /> Ajouter d&apos;autres fichiers
      </Button>

      {online ? null : (
        <Notice tone="warn" icon={<WifiOff aria-hidden />} className="mt-4">
          Pas de réseau. L&apos;envoi commencera dès que la connexion reviendra.
        </Notice>
      )}

      {/* Stays in reach of the thumb, above the tabs, however long the list is. */}
      <div className="bg-canvas/95 sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] -mx-4 mt-4 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        <Button type="submit" size="lg" block disabled={accepted.length === 0}>
          <Send aria-hidden />
          {accepted.length > 0
            ? `Envoyer ${count(accepted.length, "document")}`
            : "Aucun fichier à envoyer"}
        </Button>
      </div>
    </form>
  );
}

// --- Sending ----------------------------------------------------------------

function Sending({
  projectId,
  sending,
  listHref,
}: {
  projectId: string;
  sending: UploadsState;
  listHref: string;
}) {
  const { items, stalled } = sending;
  const { count: total, done, failed, active, progress } = summarize(items);
  const waitingForNetwork = stalled && items.some((item) => item.offline);

  return (
    <>
      {active === 0 && failed === 0 ? (
        <Card className="flex flex-col items-center px-6 py-8 text-center">
          <span className="bg-good-tint text-good flex size-14 items-center justify-center rounded-2xl">
            <CircleCheck className="size-7" aria-hidden />
          </span>
          <h2 className="font-display mt-4 text-lg font-bold" aria-live="polite">
            {count(done, "document ajouté", "documents ajoutés")}
          </h2>
          <p className="text-dim mt-1.5 max-w-sm text-[15px] text-pretty">
            Toute l&apos;équipe du projet peut maintenant {done > 1 ? "les" : "le"} consulter.
          </p>
          <div className="mt-5 flex w-full max-w-sm flex-col gap-2">
            <ButtonLink href={listHref} size="lg" block>
              Voir les documents
            </ButtonLink>
            <Button variant="secondary" block onClick={() => uploads.clearDone(projectId)}>
              <Plus aria-hidden /> Ajouter d&apos;autres documents
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-lg font-bold" aria-live="polite">
              {waitingForNetwork
                ? "Envoi interrompu"
                : active > 0
                  ? "Envoi en cours"
                  : "Envoi incomplet"}
            </h2>
            <p className="text-dim text-sm font-medium whitespace-nowrap">
              {done} sur {total}
            </p>
          </div>
          {/* By weight: once nothing more is on its way, "2 sur 3" says it better. */}
          {active > 0 ? (
            <ProgressBar value={progress} className="mt-3" label="Progression de l'envoi" />
          ) : null}
          {waitingForNetwork ? (
            <Notice tone="warn" icon={<WifiOff aria-hidden />} className="mt-4">
              <p>Pas de réseau. L&apos;envoi reprendra dès que la connexion reviendra.</p>
              <Button variant="secondary" className="mt-2.5" onClick={uploads.resume}>
                <RotateCw aria-hidden /> Réessayer maintenant
              </Button>
            </Notice>
          ) : active > 0 ? (
            <p className="text-dim mt-3 text-sm text-pretty">
              Gardez l&apos;application ouverte jusqu&apos;à la fin. Vous pouvez consulter les plans
              pendant ce temps.
            </p>
          ) : (
            <p className="text-dim mt-3 text-sm text-pretty">
              {count(
                failed,
                "fichier n'a pas pu être envoyé",
                "fichiers n'ont pas pu être envoyés",
              )}
              . Réessayez, ou retirez-{failed > 1 ? "les" : "le"} de la liste.
            </p>
          )}
        </Card>
      )}

      <ul className="mt-4 space-y-2.5">
        {items.map((item) => (
          <li key={item.id}>
            <SendingRow item={item} />
          </li>
        ))}
      </ul>

      {active === 0 && failed > 0 && done > 0 ? (
        <ButtonLink href={listHref} variant="secondary" block className="mt-4">
          Voir les documents
        </ButtonLink>
      ) : null}
    </>
  );
}

function SendingRow({ item }: { item: UploadItem }) {
  const onItsWay = item.status === "sending" || item.status === "saving";

  const cancel = async () => {
    // Stopping a large file near its end by a slip of the finger costs minutes.
    const sure = await confirmAction({
      title: "Annuler l'envoi de ce fichier?",
      text: `« ${item.title} » ne sera pas ajouté au projet.`,
      confirmLabel: "Annuler l'envoi",
      cancelLabel: "Poursuivre l'envoi",
      danger: true,
    });
    if (!sure) return;
    // The question may have stayed open long enough for the file to arrive.
    const now = uploads.getState().items.find((current) => current.id === item.id);
    if (now?.status === "saving" || now?.status === "done") {
      toast.info("L'envoi venait de se terminer : le document est ajouté.");
    } else {
      uploads.remove(item.id);
      toast.info("Envoi annulé");
    }
  };

  return (
    <Card className="flex items-start gap-3 py-3 pr-1.5 pl-3">
      <FileIcon filename={item.filename} className="mt-0.5" />
      <div className="min-w-0 flex-1 py-0.5">
        <p className="leading-snug font-semibold wrap-anywhere">{item.title}</p>
        {item.status === "waiting" ? (
          <p className="text-dim mt-0.5 text-sm">En attente · {formatSize(item.size)}</p>
        ) : null}
        {onItsWay ? (
          <>
            <p className="text-dim mt-0.5 text-sm tabular-nums">
              {item.status === "saving" || item.progress >= 1
                ? "Enregistrement…"
                : `${Math.floor(item.progress * 100)} % · ${formatSize(Math.round(item.progress * item.size))} sur ${formatSize(item.size)}`}
            </p>
            <ProgressBar
              value={item.progress}
              className="mt-2 mb-1"
              label={`Envoi de ${item.title}`}
            />
          </>
        ) : null}
        {item.status === "done" ? (
          <p className="text-good mt-0.5 flex items-center gap-1.5 text-sm font-semibold">
            <CircleCheck className="size-4 shrink-0" aria-hidden /> Ajouté
          </p>
        ) : null}
        {item.status === "failed" ? (
          <>
            <p
              role="alert"
              className={cn(
                "mt-0.5 flex items-start gap-1.5 text-sm font-medium",
                item.offline ? "text-warn" : "text-bad",
              )}
            >
              {item.offline ? (
                <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
              ) : (
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              )}
              {item.offline ? "Connexion perdue pendant l'envoi." : item.error}
            </p>
            <Button
              variant="secondary"
              className="mt-2.5 mb-0.5"
              onClick={() => uploads.retry(item.id)}
            >
              <RotateCw aria-hidden /> Réessayer
            </Button>
          </>
        ) : null}
      </div>
      {item.status === "done" ? null : item.status === "saving" ? (
        // The file has arrived and its document is being made: stopping now
        // could no longer promise that it will not be added. The button's
        // place is kept, so the row does not move for that short moment.
        <span className="size-11 shrink-0" aria-hidden />
      ) : onItsWay ? (
        <IconButton label={`Annuler l'envoi de ${item.title}`} onClick={cancel}>
          <X aria-hidden />
        </IconButton>
      ) : (
        <IconButton label={`Retirer ${item.title}`} onClick={() => uploads.remove(item.id)}>
          <X aria-hidden />
        </IconButton>
      )}
    </Card>
  );
}

function Notice({
  tone,
  icon,
  className,
  children,
}: {
  tone: "warn" | "bad";
  icon: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm font-medium [&>svg]:mt-px [&>svg]:size-4.5 [&>svg]:shrink-0",
        tone === "warn" ? "bg-warn-tint text-warn" : "bg-bad-tint text-bad",
        className,
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
