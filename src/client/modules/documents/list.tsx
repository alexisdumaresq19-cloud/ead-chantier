import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Download,
  EllipsisVertical,
  ExternalLink,
  FileText,
  Plus,
  WifiOff,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import {
  DOCUMENT_CATEGORY_LABELS,
  fileTypeOf,
  opensInBrowser,
  type DocumentCategory,
  type ProjectDocument,
} from "@/shared/documents";

import { api, ApiFailure, errorMessage } from "../../lib/api";
import { cn } from "../../lib/cn";
import { count, formatSize } from "../../lib/format";
import { useOnline } from "../../lib/online";
import { useCurrentProject, useCurrentUser } from "../../lib/session";
import { Page } from "../../shell/page";
import {
  Badge,
  Button,
  ButtonLink,
  confirmAction,
  EmptyState,
  IconButton,
  ProgressBar,
  QueryState,
  SearchInput,
  Skeleton,
  Spinner,
  toast,
} from "../../ui";
import { DocumentActions } from "./actions";
import { documentsKey, refreshProject, uploads, useDocuments, useUploads } from "./data";
import { FileIcon } from "./file-icon";
import { canChangeDocuments, formatAdded, groupDocuments } from "./logic";
import { NO_NETWORK, ReadyDocumentSheet, useDocumentOpener } from "./open";
import { summarize, type UploadsState } from "./upload-queue";

/** A project's documents, by category. Tapping one opens it. */
export function DocumentsScreen() {
  const project = useCurrentProject();
  const canChange = canChangeDocuments(project, useCurrentUser().role);
  const documents = useDocuments(project.id);
  const online = useOnline();
  const sending = useUploads(project.id);
  const opener = useDocumentOpener(project.id);
  const archive = useArchive(project.id);
  const [search, setSearch] = useState("");
  const [folded, setFolded] = useState<ReadonlySet<DocumentCategory>>(new Set());
  const [menuId, setMenuId] = useState<string | null>(null);

  const addHref = `/projets/${project.id}/documents/ajouter`;
  const searching = search.trim() !== "";
  const groups = useMemo(
    () => groupDocuments(documents.data ?? [], search),
    [documents.data, search],
  );
  // Read from the list, so the menu always shows the document as it is now.
  const menuDocument = documents.data?.find((document) => document.id === menuId) ?? null;

  // Files that made it are in the list below: nothing more to say about them.
  const sent = summarize(sending.items);
  useEffect(() => {
    if (sent.done > 0 && sent.active === 0 && sent.failed === 0) uploads.clearDone(project.id);
  }, [sent.done, sent.active, sent.failed, project.id]);

  const toggle = (category: DocumentCategory) =>
    setFolded((current) => {
      const next = new Set(current);
      if (!next.delete(category)) next.add(category);
      return next;
    });

  const askToArchive = async (document: ProjectDocument) => {
    setMenuId(null);
    const sure = await confirmAction({
      title: "Archiver ce document?",
      text: `« ${document.title} » ne sera plus visible dans le projet.`,
      confirmLabel: "Archiver",
      danger: true,
    });
    if (sure) archive.mutate(document);
  };

  return (
    <Page
      title="Documents"
      subtitle={documents.data?.length ? count(documents.data.length, "document") : undefined}
      actions={
        canChange ? (
          <ButtonLink href={addHref}>
            <Plus aria-hidden />
            <span className="sm:hidden">Ajouter</span>
            <span className="hidden sm:inline">Ajouter des documents</span>
          </ButtonLink>
        ) : null
      }
    >
      {canChange ? <SendingNotice sending={sending} href={addHref} /> : null}
      {project.status === "archive" ? (
        <p className="bg-ead-tint text-ead-dark mb-4 flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm font-medium">
          <Archive className="mt-px size-4.5 shrink-0" aria-hidden />
          {canChange
            ? "Projet archivé : seul le bureau peut encore changer ses documents."
            : "Projet archivé : ses documents se consultent, mais ne changent plus."}
        </p>
      ) : null}
      <QueryState query={documents} loading={<ListSkeleton />}>
        {(all) =>
          all.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Aucun document pour l'instant"
              text={
                canChange
                  ? "Ajoutez le contrat, le devis, les permis ou le programme de prévention. Toute l'équipe du projet pourra les consulter."
                  : project.status === "archive"
                    ? "Aucun document n'a été ajouté à ce projet avant son archivage."
                    : "Le bureau ou votre contremaître n'a pas encore ajouté de documents à ce projet."
              }
              action={
                canChange ? (
                  <ButtonLink href={addHref} size="lg">
                    <Plus aria-hidden /> Ajouter des documents
                  </ButtonLink>
                ) : undefined
              }
            />
          ) : (
            <>
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Rechercher un document"
                className="max-w-md"
              />
              {online ? null : (
                <p
                  role="status"
                  className="bg-warn-tint text-warn mt-3 flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm font-medium"
                >
                  <WifiOff className="mt-px size-4.5 shrink-0" aria-hidden />
                  {NO_NETWORK}
                </p>
              )}
              {groups.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-dim wrap-anywhere">
                    Aucun document ne correspond à «&nbsp;{search.trim()}&nbsp;».
                  </p>
                  <Button variant="ghost" className="mt-2" onClick={() => setSearch("")}>
                    Effacer la recherche
                  </Button>
                </div>
              ) : (
                groups.map(({ category, documents: inCategory }) => {
                  const open = searching || !folded.has(category);
                  const listId = `documents-${category}`;
                  return (
                    <section key={category} className="mt-5">
                      <h2>
                        <button
                          type="button"
                          onClick={() => toggle(category)}
                          // A search shows every result: nothing stays folded.
                          disabled={searching}
                          aria-expanded={open}
                          aria-controls={listId}
                          className="flex min-h-11 w-full cursor-pointer items-center gap-2 text-left disabled:cursor-default"
                        >
                          <span className="font-display text-dim min-w-0 truncate text-sm font-bold tracking-wider uppercase">
                            {DOCUMENT_CATEGORY_LABELS[category]}
                          </span>
                          <Badge>{inCategory.length}</Badge>
                          {searching ? null : (
                            <ChevronDown
                              className={cn(
                                "text-dim ml-auto size-5 shrink-0 transition-transform",
                                !open && "-rotate-90",
                              )}
                              aria-hidden
                            />
                          )}
                        </button>
                      </h2>
                      {open ? (
                        <ul
                          id={listId}
                          className="divide-line border-line bg-surface divide-y overflow-hidden rounded-2xl border shadow-xs"
                        >
                          {inCategory.map((document) => (
                            <DocumentRow
                              key={document.id}
                              document={document}
                              opening={opener.opening.has(document.id)}
                              onOpen={() => opener.open(document)}
                              onMenu={canChange ? () => setMenuId(document.id) : undefined}
                            />
                          ))}
                        </ul>
                      ) : null}
                    </section>
                  );
                })
              )}
            </>
          )
        }
      </QueryState>

      <DocumentActions
        projectId={project.id}
        document={menuDocument}
        onArchive={askToArchive}
        onClose={() => setMenuId(null)}
      />
      <ReadyDocumentSheet ready={opener.ready} onClose={opener.dismissReady} />
    </Page>
  );
}

function DocumentRow({
  document,
  opening,
  onOpen,
  onMenu,
}: {
  document: ProjectDocument;
  opening: boolean;
  onOpen: () => void;
  /** Present for those who manage the project. */
  onMenu?: () => void;
}) {
  const size = formatSize(document.size);
  const added = formatAdded(document.addedAt);
  const Hint = opensInBrowser(document.filename) ? ExternalLink : Download;
  return (
    <li className="hover:bg-canvas active:bg-canvas flex items-center transition-colors">
      <button
        type="button"
        onClick={onOpen}
        aria-busy={opening || undefined}
        className="flex min-h-16 min-w-0 flex-1 cursor-pointer items-center gap-3 py-2.5 pr-2 pl-3 text-left sm:pl-4"
      >
        {opening ? (
          <span className="flex size-11 shrink-0 items-center justify-center">
            <Spinner label="Ouverture du document" />
          </span>
        ) : (
          <FileIcon filename={document.filename} />
        )}
        <span className="min-w-0 flex-1">
          {/* Never cut short: two long titles may differ only by their last words. */}
          <span className="block leading-snug font-semibold wrap-anywhere">{document.title}</span>
          {/*
            What does not fit goes to a second line, whole. Each part brings its
            dot on its left; the one that starts a line hides it in the margin.
          */}
          <span className="text-dim mt-0.5 block overflow-hidden text-sm">
            <span className="-ml-3 flex flex-wrap">
              <span className={part}>{fileTypeOf(document.filename).label}</span>
              <span className={cn(part, "md:hidden")}>{size}</span>
              <span className={cn(part, "md:hidden")}>{added}</span>
              {document.addedBy ? (
                <span className={cn(part, "truncate")}>{document.addedBy}</span>
              ) : null}
            </span>
          </span>
        </span>
        {/* Wide screens have room for columns. */}
        <span className="text-dim hidden w-20 shrink-0 text-right text-sm md:block">{size}</span>
        <span className="text-dim hidden w-28 shrink-0 text-right text-sm md:block">{added}</span>
        {onMenu ? null : <Hint className="text-dim mx-2 size-5 shrink-0" aria-hidden />}
      </button>
      {onMenu ? (
        <IconButton label={`Gérer « ${document.title} »`} onClick={onMenu} className="mr-1">
          <EllipsisVertical aria-hidden />
        </IconButton>
      ) : null}
    </li>
  );
}

const part = "relative max-w-full pl-3 before:absolute before:left-1 before:content-['·']";

/** Takes the document off the list at once; puts it back if the server says no. */
function useArchive(projectId: string) {
  const queryClient = useQueryClient();
  const key = documentsKey(projectId);
  return useMutation({
    mutationFn: (document: ProjectDocument) =>
      api(`/api/documents/${document.id}`, { method: "DELETE" }),
    async onMutate(document) {
      // A refresh on its way would bring the document back for a moment.
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<ProjectDocument[]>(key, (documents) =>
        documents?.filter((current) => current.id !== document.id),
      );
    },
    onSuccess: () => toast.success("Document archivé"),
    onError(error, document) {
      // Still on the project (no network, a refusal): back in the list, where
      // archiving can be tried again. Already gone for the server: it stays out.
      if (!(error instanceof ApiFailure && error.status === 404))
        queryClient.setQueryData<ProjectDocument[]>(key, (documents) =>
          documents?.some((current) => current.id === document.id)
            ? documents
            : documents && [...documents, document],
        );
      toast.error(errorMessage(error));
    },
    onSettled: () => refreshProject(projectId),
  });
}

/** For a manager whose files are still being sent, or did not get through. */
function SendingNotice({ sending, href }: { sending: UploadsState; href: string }) {
  const { active, failed, count: total, done, progress } = summarize(sending.items);
  if (active === 0 && failed === 0) return null;
  const waitingForNetwork = sending.stalled && sending.items.some((item) => item.offline);
  const problem = active === 0 || waitingForNetwork;
  return (
    <Link
      href={href}
      className={cn(
        "mb-4 flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors",
        problem
          ? "border-warn/30 bg-warn-tint text-warn"
          : "border-line bg-surface hover:border-ead/60 shadow-xs",
      )}
    >
      {waitingForNetwork ? (
        <WifiOff className="size-5 shrink-0" aria-hidden />
      ) : problem ? (
        <CircleAlert className="size-5 shrink-0" aria-hidden />
      ) : (
        <Spinner className="size-5" label="Envoi en cours" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">
          {waitingForNetwork
            ? "Envoi interrompu, faute de réseau"
            : problem
              ? count(
                  failed,
                  "document n'a pas pu être envoyé",
                  "documents n'ont pas pu être envoyés",
                )
              : `Envoi en cours : ${done} sur ${total}`}
        </span>
        {problem ? (
          <span className="block text-sm">Touchez pour voir et réessayer.</span>
        ) : (
          <ProgressBar value={progress} className="mt-2" label="Progression de l'envoi" />
        )}
      </span>
      <ChevronRight className="size-5 shrink-0" aria-hidden />
    </Link>
  );
}

function ListSkeleton() {
  return (
    <div>
      <Skeleton className="h-12 max-w-md" />
      <Skeleton className="mt-8 h-4 w-40" />
      <Skeleton className="mt-3 h-16" />
      <Skeleton className="mt-1.5 h-16" />
      <Skeleton className="mt-1.5 h-16" />
    </div>
  );
}
