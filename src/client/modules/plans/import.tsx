import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert,
  CircleCheck,
  CloudOff,
  FileX,
  History,
  Lock,
  Plus,
  RotateCw,
  Search,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "wouter";

import {
  sheetNumberKey,
  type ImportPage,
  type PlanFolder,
  type PlanImportDetail,
  type Sheet as PlanSheet,
} from "@/shared/plans";

import { api, ApiFailure, errorMessage } from "../../lib/api";
import { cn } from "../../lib/cn";
import { count } from "../../lib/format";
import { navigate } from "../../lib/location";
import { useCurrentProject } from "../../lib/session";
import { Page } from "../../shell/page";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  confirmAction,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Input,
  ProgressBar,
  Select,
  Skeleton,
  Spinner,
  toast,
} from "../../ui";
import {
  planKeys,
  planPaths,
  refreshProject,
  useCanChangePlans,
  usePlanImport,
  usePlans,
} from "./data";
import { FolderDialog } from "./folders";
import {
  draftOf,
  draftProblems,
  keptPages,
  revisionName,
  sheetsByNumber,
  type PageDraft,
} from "./logic";
import { PagePreview } from "./page-preview";
import { PlanThumb, Switch } from "./parts";

// Bringing a PDF in: its pages are converted one by one, the office checks
// the number and the title read on each, then publishes. Until then the site
// sees nothing of it.

export function ImportScreen() {
  const project = useCurrentProject();
  const { importId } = useParams<{ importId: string }>();
  const list = planPaths.list(project.id);
  const back = { href: list, label: "Plans" };
  const canChange = useCanChangePlans();
  const current = usePlanImport(project.id, importId, canChange);

  if (!canChange) {
    return (
      <Page title="Ajout de plans" back={back}>
        <EmptyState
          icon={Lock}
          {...(project.canManage
            ? {
                title: "Ce projet est archivé",
                text: "Ses plans ne changent plus. Seul le bureau peut encore en ajouter.",
              }
            : {
                title: "Réservé au bureau et aux contremaîtres",
                text: "Les plans publiés se trouvent dans la liste des plans.",
              })}
          action={<ButtonLink href={list}>Voir les plans</ButtonLink>}
        />
      </Page>
    );
  }

  const data = current.data;
  // Cancelled, maybe by someone else while this screen was open; or reached
  // through another project's address, and then not this project's.
  const gone =
    (current.error instanceof ApiFailure && current.error.status === 404) ||
    (data !== undefined && data.projectId !== project.id);
  if (gone) {
    return (
      <Page title="Ajout de plans" back={back}>
        <Gone list={list} />
      </Page>
    );
  }
  if (data === undefined) {
    return (
      <Page title="Ajout de plans" back={back}>
        {current.isError ? (
          <ErrorState error={current.error} onRetry={() => current.refetch()} />
        ) : (
          <div role="status" aria-label="Chargement">
            <Skeleton className="h-24" />
            <Skeleton className="mt-3 h-40" />
            <Skeleton className="mt-3 h-40" />
          </div>
        )}
      </Page>
    );
  }
  if (data.status === "published") {
    return (
      <Page title="Plans publiés" subtitle={data.filename} back={back}>
        <EmptyState
          icon={CircleCheck}
          title="Ces plans sont publiés"
          text="Les feuilles de ce PDF sont dans la liste des plans, visibles au chantier."
          action={<ButtonLink href={list}>Voir les plans</ButtonLink>}
        />
      </Page>
    );
  }
  return <ImportWork key={data.id} projectId={project.id} current={data} />;
}

function Gone({ list }: { list: string }) {
  return (
    <EmptyState
      icon={FileX}
      title="Cet import n'existe plus"
      text="Il a été annulé, ou son adresse est incomplète. Rien n'a été publié."
      action={<ButtonLink href={list}>Retour aux plans</ButtonLink>}
    />
  );
}

// --- Saving while the office types ------------------------------------------

type PagePatch = { draftNumber?: string; draftTitle?: string; draftSkip?: boolean };
type Settings = { folderId: string | null; revisionLabel: string | null; issuedOn: string | null };
/** "idle" until something is typed: nothing to say about saving before that. */
type SaveState = "idle" | "waiting" | "saving" | "saved" | "failed";

/**
 * Sends corrections a moment after the last key, all pages in one request.
 * What is typed lives on the screen, never in the answer of a save: nothing
 * typed is lost, and the cursor never moves.
 */
function useSaver(projectId: string, importId: string) {
  const client = useQueryClient();
  const [state, setState] = useState<SaveState>("idle");
  const work = useRef({
    settings: {} as Partial<Settings>,
    pages: new Map<string, PagePatch>(),
    timer: 0,
    last: Promise.resolve(),
  });

  const saver = useMemo(() => {
    const send = async () => {
      const { settings, pages } = work.current;
      if (!Object.keys(settings).length && !pages.size) return;
      work.current.settings = {};
      work.current.pages = new Map();
      setState("saving");
      const key = planKeys.import(projectId, importId);
      try {
        // An answer to a question asked before this save would show old values.
        await client.cancelQueries({ queryKey: key });
        const saved = await api<PlanImportDetail>(`/api/plan-imports/${importId}`, {
          method: "PATCH",
          body: { ...settings, pages: [...pages].map(([id, patch]) => ({ id, ...patch })) },
        });
        // Not once the screen is left: the import is fetched afresh next time.
        if (client.getQueryState(key)) client.setQueryData(key, saved);
        const more = work.current.pages.size || Object.keys(work.current.settings).length;
        setState(more ? "waiting" : "saved");
      } catch (error) {
        // Back in line, under whatever was typed since.
        work.current.settings = { ...settings, ...work.current.settings };
        for (const [id, patch] of pages)
          work.current.pages.set(id, { ...patch, ...work.current.pages.get(id) });
        setState("failed");
        // Refused by the server: most likely the import was published or
        // cancelled from another device. Asking for it again shows where it is.
        if (!(error instanceof ApiFailure && error.offline))
          void client.invalidateQueries({ queryKey: key });
        throw error;
      }
    };
    /** Saves now whatever is waiting, after any save already under way. */
    const flush = () => {
      window.clearTimeout(work.current.timer);
      work.current.last = work.current.last.catch(() => {}).then(send);
      return work.current.last;
    };
    const soon = () => {
      setState((now) => (now === "saving" ? now : "waiting"));
      window.clearTimeout(work.current.timer);
      work.current.timer = window.setTimeout(() => void flush().catch(() => {}), 700);
    };
    return {
      flush,
      page(id: string, patch: PagePatch) {
        work.current.pages.set(id, { ...work.current.pages.get(id), ...patch });
        soon();
      },
      settings(patch: Partial<Settings>) {
        work.current.settings = { ...work.current.settings, ...patch };
        soon();
      },
      /** Holds back the save that is waiting, while the import is being cancelled. */
      hold() {
        window.clearTimeout(work.current.timer);
      },
      /** Forgets what is waiting: the import was cancelled. */
      drop() {
        window.clearTimeout(work.current.timer);
        work.current.settings = {};
        work.current.pages = new Map();
      },
    };
  }, [client, projectId, importId]);

  useEffect(() => {
    const save = () => void saver.flush().catch(() => {});
    const whenHidden = () => {
      if (document.visibilityState === "hidden") save();
    };
    // A save that failed for lack of network goes again when it returns; a
    // phone put in a pocket, or a change of screen, saves at once.
    window.addEventListener("online", save);
    document.addEventListener("visibilitychange", whenHidden);
    return () => {
      window.removeEventListener("online", save);
      document.removeEventListener("visibilitychange", whenHidden);
      save();
    };
  }, [saver]);

  return { ...saver, state };
}

// --- The import, converting or being checked --------------------------------

function ImportWork({ projectId, current }: { projectId: string; current: PlanImportDetail }) {
  const client = useQueryClient();
  const plans = usePlans(projectId);
  const saver = useSaver(projectId, current.id);
  const list = planPaths.list(projectId);
  const importKey = planKeys.import(projectId, current.id);

  // What the office typed, by page; a page not touched shows what was read on it.
  const [drafts, setDrafts] = useState<Record<string, PageDraft>>({});
  const [settings, setSettings] = useState<Partial<Settings>>({});
  const [preview, setPreview] = useState<ImportPage | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);

  const { page: savePage, settings: saveSettings } = saver;
  const editPage = useCallback(
    (page: ImportPage, change: Partial<PageDraft>) => {
      setDrafts((all) => ({
        ...all,
        [page.id]: { ...(all[page.id] ?? draftOf(page)), ...change },
      }));
      savePage(page.id, {
        ...(change.number === undefined ? {} : { draftNumber: change.number }),
        ...(change.title === undefined ? {} : { draftTitle: change.title }),
        ...(change.skip === undefined ? {} : { draftSkip: change.skip }),
      });
    },
    [savePage],
  );
  const editSettings = (change: Partial<Settings>) => {
    setSettings((all) => ({ ...all, ...change }));
    saveSettings(change);
  };

  const { pages } = current;
  const folders = plans.data?.folders ?? [];
  const existing = useMemo(() => sheetsByNumber(plans.data?.sheets ?? []), [plans.data]);
  const problems = useMemo(() => draftProblems(pages, drafts), [pages, drafts]);
  const kept = keptPages(pages, drafts);
  const replaced = kept.filter((page) =>
    existing.has(sheetNumberKey((drafts[page.id] ?? draftOf(page)).number)),
  ).length;
  const ready = pages.filter((page) => page.status === "ready").length;
  const failed = pages.filter((page) => page.status === "failed").length;
  const converting = current.status === "reading" || current.status === "processing";
  /** Not one page came out of the PDF. */
  const failedWhole = current.status === "failed";

  const retry = useMutation({
    mutationFn: () =>
      api<PlanImportDetail>(`/api/plan-imports/${current.id}/retry`, { method: "POST" }),
    onSuccess: (data) => client.setQueryData(importKey, data),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const leave = () => {
    navigate(list, { replace: true });
    void refreshProject(client, projectId);
  };

  const cancel = useMutation({
    mutationFn: () => {
      saver.hold();
      return api(`/api/plan-imports/${current.id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      saver.drop();
      toast.success("Import annulé. Rien n'a été publié.");
      leave();
    },
    onError: (error) => {
      // Still there, and still to be checked: what was typed is saved after all.
      void saver.flush().catch(() => {});
      toast.error(errorMessage(error));
    },
  });
  const askCancel = async () => {
    const confirmed = await confirmAction({
      title: "Annuler cet import?",
      text: `Les pages converties de « ${current.filename} » seront supprimées. Les plans déjà publiés ne changent pas.`,
      confirmLabel: "Annuler l'import",
      cancelLabel: "Continuer l'import",
      danger: true,
    });
    if (confirmed) cancel.mutate();
  };

  const publish = useMutation({
    mutationFn: async () => {
      await saver.flush();
      return api<{ sheetIds: string[] }>(`/api/plan-imports/${current.id}/publish`, {
        method: "POST",
      });
    },
    onSuccess: ({ sheetIds }) => {
      toast.success(
        `${count(sheetIds.length, "feuille publiée", "feuilles publiées")}. Le chantier les voit.`,
      );
      leave();
    },
  });
  const askPublish = async () => {
    const confirmed = await confirmAction({
      title: `Publier ${count(kept.length, "feuille")}?`,
      text:
        replaced > 0
          ? `Le chantier les verra tout de suite. ${
              replaced === 1
                ? "1 feuille existante passe à sa nouvelle révision."
                : `${replaced} feuilles existantes passent à leur nouvelle révision.`
            }`
          : "Le chantier les verra tout de suite.",
      confirmLabel: "Publier",
    });
    if (confirmed) publish.mutate();
  };

  const folderId = settings.folderId !== undefined ? settings.folderId : current.folderId;

  return (
    <Page
      title={converting || failedWhole ? "Conversion des plans" : "Vérifier avant de publier"}
      subtitle={<span className="break-words">{current.filename}</span>}
      back={{ href: list, label: "Plans" }}
      actions={
        failedWhole ? null : (
          <Button
            variant="secondary"
            onClick={askCancel}
            loading={cancel.isPending}
            disabled={publish.isPending}
          >
            Annuler l&apos;import
          </Button>
        )
      }
    >
      {failedWhole ? (
        <EmptyState
          icon={CircleAlert}
          title="La conversion a échoué"
          text={`${current.error ?? "Ce PDF n'a pas pu être converti."} Rien n'a été publié.`}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {current.canRetry ? (
                <Button
                  variant="secondary"
                  onClick={() => retry.mutate()}
                  loading={retry.isPending}
                >
                  <RotateCw aria-hidden /> Réessayer
                </Button>
              ) : null}
              <Button variant="danger" onClick={askCancel} loading={cancel.isPending}>
                Annuler l&apos;import
              </Button>
            </div>
          }
        />
      ) : (
        <>
          {converting ? (
            <Card className="mb-4 p-4">
              <div className="flex items-center gap-3">
                <Spinner className="size-6" label="Conversion en cours" />
                <p className="font-semibold">
                  {current.pageCount
                    ? `${ready + failed} sur ${count(current.pageCount, "page convertie", "pages converties")}`
                    : "Lecture du PDF…"}
                </p>
              </div>
              <ProgressBar
                value={current.pageCount ? (ready + failed) / current.pageCount : undefined}
                label="Conversion des pages"
                className="mt-3"
              />
              <p className="text-dim mt-3 text-sm">
                Chaque page devient une feuille. Vous pouvez déjà vérifier celles qui sont prêtes.
              </p>
            </Card>
          ) : null}

          {failed > 0 && !converting ? (
            <div className="bg-bad-tint mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl p-4">
              <p className="text-bad min-w-0 flex-1 basis-56 text-[15px] font-medium">
                {count(
                  failed,
                  "page n'a pas pu être convertie",
                  "pages n'ont pas pu être converties",
                )}
                . Si vous publiez maintenant,{" "}
                {failed > 1 ? "elles seront laissées" : "elle sera laissée"} de côté.
              </p>
              {current.canRetry ? (
                <Button
                  variant="secondary"
                  onClick={() => retry.mutate()}
                  loading={retry.isPending}
                >
                  <RotateCw aria-hidden /> Réessayer
                </Button>
              ) : null}
            </div>
          ) : null}

          {pages.length > 0 ? (
            <>
              <Card className="mb-4 p-4">
                <h2 className="font-display text-dim text-sm font-bold tracking-wider uppercase">
                  Pour toutes les feuilles de ce PDF
                </h2>
                <div className="mt-3 grid gap-4 sm:grid-cols-3">
                  <Field label="Dossier" hint="Pour les nouvelles feuilles.">
                    <Select
                      value={folderId ?? ""}
                      onChange={(event) => {
                        if (event.target.value === NEW_FOLDER) setCreatingFolder(true);
                        else editSettings({ folderId: event.target.value || null });
                      }}
                    >
                      <option value="">Sans dossier</option>
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                      <option value={NEW_FOLDER}>Nouveau dossier…</option>
                    </Select>
                  </Field>
                  <Field label="Révision" optional>
                    <Input
                      value={settings.revisionLabel ?? current.revisionLabel ?? ""}
                      onChange={(event) => editSettings({ revisionLabel: event.target.value })}
                      placeholder={"Ex.\u00a0: 1, B"}
                      maxLength={60}
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Date d'émission" optional>
                    <Input
                      type="date"
                      value={
                        (settings.issuedOn !== undefined ? settings.issuedOn : current.issuedOn) ??
                        ""
                      }
                      onChange={(event) => editSettings({ issuedOn: event.target.value || null })}
                    />
                  </Field>
                </div>
              </Card>

              <ul className="grid gap-3 lg:grid-cols-2">
                {pages.map((page) => {
                  const number = (drafts[page.id] ?? draftOf(page)).number;
                  return (
                    <PageCard
                      key={page.id}
                      page={page}
                      typed={drafts[page.id]}
                      problem={problems.get(page.id)}
                      replaces={number.trim() ? existing.get(sheetNumberKey(number)) : undefined}
                      onEdit={editPage}
                      onPreview={setPreview}
                    />
                  );
                })}
              </ul>

              <PublishBar
                converting={converting}
                kept={kept.length}
                replaced={replaced}
                left={ready - kept.length + failed}
                problems={problems.size}
                saving={saver.state}
                error={publish.isError ? errorMessage(publish.error) : null}
                publishing={publish.isPending}
                cancelling={cancel.isPending}
                onPublish={askPublish}
              />
            </>
          ) : null}
        </>
      )}

      {preview ? <PagePreview page={preview} onClose={() => setPreview(null)} /> : null}
      {creatingFolder ? (
        <FolderDialog
          projectId={projectId}
          onClose={() => setCreatingFolder(false)}
          onCreated={(folder: PlanFolder) => editSettings({ folderId: folder.id })}
        />
      ) : null}
    </Page>
  );
}

/** A choice of the folder list that is no folder: it opens the "new folder" window. */
const NEW_FOLDER = "+";

// --- One page ---------------------------------------------------------------

// Each card is drawn again only when its own page changes: typing in one
// leaves the others of a long PDF alone.
const PageCard = memo(function PageCard({
  page,
  typed,
  problem,
  replaces,
  onEdit,
  onPreview,
}: {
  page: ImportPage;
  /** What the office typed on this page, if anything yet. */
  typed: PageDraft | undefined;
  problem: string | undefined;
  /** The sheet of the project that carries this page's number, if any. */
  replaces: PlanSheet | undefined;
  onEdit: (page: ImportPage, change: Partial<PageDraft>) => void;
  onPreview: (page: ImportPage) => void;
}) {
  const label = `Page ${page.pageIndex + 1}`;
  const heading = (
    <p className="font-display text-dim text-xs font-bold tracking-wider uppercase">{label}</p>
  );

  if (page.status !== "ready") {
    const failed = page.status === "failed";
    return (
      <li
        className={cn(
          "bg-surface flex items-center gap-3 rounded-2xl border p-3 shadow-xs",
          failed ? "border-bad/40" : "border-line",
        )}
      >
        <span
          className={cn(
            "flex h-[4.5rem] w-24 shrink-0 items-center justify-center rounded-lg sm:h-24 sm:w-32",
            failed ? "bg-bad-tint text-bad" : "bg-line/60 animate-pulse",
          )}
        >
          {failed ? <CircleAlert className="size-6" aria-hidden /> : null}
        </span>
        <div className="min-w-0">
          {heading}
          <p className={cn("mt-1 text-sm", failed ? "text-bad font-medium" : "text-dim")}>
            {failed
              ? (page.error ?? "Cette page n'a pas pu être convertie.")
              : page.status === "processing"
                ? "Conversion en cours…"
                : "En attente de conversion"}
          </p>
        </div>
      </li>
    );
  }

  const draft = typed ?? draftOf(page);
  const skipped = draft.skip;
  return (
    <li
      className={cn(
        // Going from field to field with the keyboard, the one that takes the
        // focus is scrolled clear of the bar that holds the publish button.
        "bg-surface animate-fade rounded-2xl border p-3 shadow-xs [&_button]:scroll-mb-40 [&_input]:scroll-mb-40",
        problem && !skipped ? "border-bad/50" : "border-line",
      )}
    >
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => onPreview(page)}
          aria-label={`Agrandir la page ${page.pageIndex + 1}`}
          className={cn(
            "group relative shrink-0 cursor-zoom-in self-start rounded-lg",
            skipped && "opacity-50",
          )}
        >
          <PlanThumb
            url={page.thumbUrl}
            tiles={page.tiles}
            className="h-[4.5rem] w-24 sm:h-24 sm:w-32"
          />
          <span className="bg-ink/70 absolute right-1 bottom-1 flex size-6 items-center justify-center rounded-md text-white">
            <Search className="size-3.5" aria-hidden />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            {heading}
            <Switch checked={!skipped} onChange={(on) => onEdit(page, { skip: !on })}>
              Publier
            </Switch>
          </div>
          <label className="mt-1 block">
            <span className="sr-only">Numéro de la feuille, {label}</span>
            <Input
              value={draft.number}
              onChange={(event) => onEdit(page, { number: event.target.value })}
              placeholder="Numéro"
              maxLength={40}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={skipped}
              aria-invalid={Boolean(problem) && !skipped}
              className="font-display h-11 font-bold"
            />
          </label>
        </div>
      </div>
      <label className="mt-2 block">
        <span className="sr-only">Titre de la feuille, {label}</span>
        <Input
          value={draft.title}
          onChange={(event) => onEdit(page, { title: event.target.value })}
          placeholder="Titre"
          maxLength={200}
          autoComplete="off"
          disabled={skipped}
          className="h-11"
        />
      </label>
      <div className="mt-2 flex min-h-6 items-center">
        {skipped ? (
          <p className="text-dim text-sm">Laissée de côté&nbsp;: cette page ne sera pas publiée.</p>
        ) : problem ? (
          <p className="text-bad flex items-center gap-1.5 text-sm font-medium">
            <CircleAlert className="size-4 shrink-0" aria-hidden /> {problem}
          </p>
        ) : replaces ? (
          <Badge tone="warn" className="max-w-full">
            <History aria-hidden />
            <span className="truncate">
              Nouvelle révision de {replaces.number}
              {revisionName(replaces.current?.label)
                ? ` (remplace ${revisionName(replaces.current?.label)})`
                : null}
            </span>
          </Badge>
        ) : (
          <Badge tone="good">
            <Plus aria-hidden /> Nouvelle feuille
          </Badge>
        )}
      </div>
    </li>
  );
});

// --- Publishing -------------------------------------------------------------

function PublishBar({
  converting,
  kept,
  replaced,
  left,
  problems,
  saving,
  error,
  publishing,
  cancelling,
  onPublish,
}: {
  converting: boolean;
  kept: number;
  replaced: number;
  /** Pages that will not be published: left out, or not converted. */
  left: number;
  problems: number;
  saving: SaveState;
  error: string | null;
  publishing: boolean;
  /** The import is being cancelled: a second tap must not ask to publish it. */
  cancelling: boolean;
  onPublish: () => void;
}) {
  const summary = [
    replaced < kept ? count(kept - replaced, "nouvelle feuille", "nouvelles feuilles") : null,
    replaced > 0 ? count(replaced, "nouvelle révision", "nouvelles révisions") : null,
    left > 0 ? count(left, "page laissée de côté", "pages laissées de côté") : null,
  ].filter(Boolean);

  return (
    <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 mt-5 lg:bottom-4">
      <Card className="p-2.5 shadow-lg sm:flex sm:items-center sm:gap-4 sm:p-4">
        <div className="min-w-0 flex-1 px-1.5 pt-0.5 pb-2 sm:p-0">
          {error ? (
            <FormError>{error}</FormError>
          ) : converting ? (
            <p className="text-dim text-sm">
              Vous pourrez publier quand toutes les pages seront converties.
            </p>
          ) : problems > 0 ? (
            <p className="text-bad text-sm font-medium">
              {count(problems, "page", "pages")} à corriger avant de publier.
            </p>
          ) : kept === 0 ? (
            <p className="text-dim text-sm">
              Aucune page à publier. Activez « Publier » sur au moins une page.
            </p>
          ) : (
            <p className="text-sm font-medium text-pretty">{summary.join(" · ")}</p>
          )}
          <SaveNote state={saving} />
        </div>
        <Button
          size="lg"
          block
          className="sm:w-auto"
          onClick={onPublish}
          loading={publishing}
          disabled={converting || cancelling || kept === 0 || problems > 0}
        >
          {kept > 0 ? `Publier ${count(kept, "feuille")}` : "Publier"}
        </Button>
      </Card>
    </div>
  );
}

function SaveNote({ state }: { state: SaveState }) {
  if (state === "failed") {
    return (
      <p className="text-warn mt-1 flex items-center gap-1.5 text-xs font-semibold">
        <CloudOff className="size-3.5" aria-hidden /> Corrections non enregistrées. Elles le seront
        au retour du réseau.
      </p>
    );
  }
  if (state === "idle") return null;
  return (
    <p className="text-dim mt-1 text-xs" aria-live="polite">
      {state === "saved" ? "Corrections enregistrées" : "Enregistrement…"}
    </p>
  );
}
