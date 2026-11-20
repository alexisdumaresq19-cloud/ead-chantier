import {
  ChevronRight,
  FolderPlus,
  Layers,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  type LucideIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { PlanFolder, Plans } from "@/shared/plans";

import { cn } from "../../lib/cn";
import { count } from "../../lib/format";
import { useCurrentProject } from "../../lib/session";
import { Page } from "../../shell/page";
import { Badge, Button, EmptyState, IconButton, QueryState, SearchInput, Skeleton } from "../../ui";
import { DropHint, InProgress, useAddFiles, useFileDrop } from "./adding";
import { useCanChangePlans, usePlans } from "./data";
import { FolderDialog } from "./folders";
import { groupByFolder, indexSheets, type FolderGroup } from "./logic";
import { LOOSE, useClosedFolders, usePlanView, type PlanView } from "./prefs";
import { SearchResults, useSearchText } from "./search";
import { SheetMenu } from "./sheet-menu";
import { SheetList, type ListProps } from "./sheets";

// The plans of a project: what everyone on the site opens the app for.
// Sheets by folder, a search that also reads the words drawn on the plans,
// and, for those who manage the project, adding PDFs and keeping order.

export function PlansScreen() {
  const project = useCurrentProject();
  const plans = usePlans(project.id);
  const canManage = useCanChangePlans();
  // The viewer's code is fetched while the list is read, so that the first
  // sheet tapped opens at once, even before the app has stored its screens.
  useEffect(() => {
    void import("./viewer").catch(() => {
      // No network: it loads when a sheet is opened, or comes from the device.
    });
  }, []);
  const fileInput = useRef<HTMLInputElement>(null);
  const [menuSheetId, setMenuSheetId] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState<{ folder: PlanFolder | null } | null>(null);

  const addFiles = useAddFiles(project.id);
  const dragging = useFileDrop(canManage, addFiles);
  const chooseFiles = useCallback(() => fileInput.current?.click(), []);
  const editFolder = useCallback((folder: PlanFolder | null) => setFolderDialog({ folder }), []);

  const menuSheet = plans.data?.sheets.find((sheet) => sheet.id === menuSheetId);
  const dialogFolder = folderDialog?.folder ?? null;
  // Folders without sheets are shown only to those who can fill them.
  const nothingYet =
    plans.data !== undefined &&
    plans.data.sheets.length === 0 &&
    (!canManage || plans.data.folders.length === 0);

  return (
    <Page
      title="Plans"
      subtitle={project.status === "archive" ? <Badge>Projet archivé</Badge> : undefined}
      actions={
        // With nothing yet, the same button stands in the middle of the screen.
        canManage && !nothingYet ? (
          <Button onClick={chooseFiles}>
            <Plus aria-hidden /> Ajouter des plans
          </Button>
        ) : null
      }
    >
      {canManage ? (
        <>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(event) => {
              void addFiles(Array.from(event.target.files ?? []));
              // So that choosing the same file again is still a change.
              event.target.value = "";
            }}
          />
          <InProgress projectId={project.id} />
        </>
      ) : null}

      <QueryState query={plans} loading={<ListSkeleton />}>
        {(data) =>
          nothingYet ? (
            <NoPlans
              canManage={canManage}
              archived={project.status === "archive"}
              onAdd={chooseFiles}
            />
          ) : (
            <PlanList
              projectId={project.id}
              plans={data}
              canManage={canManage}
              onMenu={setMenuSheetId}
              onFolder={editFolder}
            />
          )
        }
      </QueryState>

      {menuSheet && plans.data ? (
        <SheetMenu
          key={menuSheet.id}
          projectId={project.id}
          sheet={menuSheet}
          folders={plans.data.folders}
          onClose={() => setMenuSheetId(null)}
        />
      ) : null}
      {folderDialog ? (
        <FolderDialog
          key={dialogFolder?.id ?? "new"}
          projectId={project.id}
          folder={dialogFolder}
          sheetCount={
            plans.data?.sheets.filter((sheet) => sheet.folderId === dialogFolder?.id).length
          }
          onClose={() => setFolderDialog(null)}
        />
      ) : null}
      {dragging ? <DropHint /> : null}
    </Page>
  );
}

// --- Nothing yet ------------------------------------------------------------

function NoPlans({
  canManage,
  archived,
  onAdd,
}: {
  canManage: boolean;
  archived: boolean;
  onAdd: () => void;
}) {
  if (!canManage) {
    return archived ? (
      <EmptyState
        icon={Layers}
        title="Aucun plan dans ce projet"
        text="Ce projet est archivé sans plans. Le bureau peut encore en ajouter au besoin."
      />
    ) : (
      <EmptyState
        icon={Layers}
        title="Aucun plan pour l'instant"
        text="Le bureau ou votre contremaître n'a pas encore ajouté les plans de ce projet. Ils s'afficheront ici."
      />
    );
  }
  return (
    <EmptyState
      icon={Layers}
      title="Aucun plan pour l'instant"
      text="Ajoutez les PDF des plans. Chaque page devient une feuille que l'équipe ouvre au chantier, sur son téléphone."
      action={
        <>
          <Button size="lg" onClick={onAdd}>
            <Plus aria-hidden /> Ajouter des plans
          </Button>
          <p className="text-dim mt-3 hidden text-sm lg:block">
            Ou glissez vos PDF n&apos;importe où sur cette page.
          </p>
        </>
      }
    />
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Chargement des plans">
      <Skeleton className="h-12" />
      <Skeleton className="mt-5 h-[19rem]" />
    </div>
  );
}

// --- The list ---------------------------------------------------------------

function PlanList({
  projectId,
  plans,
  canManage,
  onMenu,
  onFolder,
}: ListProps & { plans: Plans; onFolder: (folder: PlanFolder | null) => void }) {
  const [search, setSearch] = useSearchText();
  // Typing stays instant with hundreds of sheets: the list follows the text
  // as soon as the browser has a moment, and rows that did not change are
  // not drawn again.
  const query = useDeferredValue(search).trim();
  const [view, setView] = usePlanView();
  const index = useMemo(() => indexSheets(plans.sheets), [plans.sheets]);
  const clear = useCallback(() => setSearch(""), [setSearch]);
  // Folders made before the first plans: nothing to search or to lay out yet.
  const searchable = plans.sheets.length > 0;
  const viewToggle = searchable ? <ViewToggle view={view} onChange={setView} /> : null;

  return (
    <>
      {searchable ? (
        // The search has the whole width: its words are never cut on a
        // narrow phone. The choice of view sits with the count, below.
        <div className="bg-canvas/95 sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 -mx-4 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-10 lg:px-10">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Rechercher un plan"
            className="lg:max-w-md"
          />
        </div>
      ) : null}

      {query && searchable ? (
        <SearchResults
          projectId={projectId}
          index={index}
          query={query}
          view={view}
          viewToggle={viewToggle}
          canManage={canManage}
          onMenu={onMenu}
          onClear={clear}
        />
      ) : (
        <Folders
          projectId={projectId}
          plans={plans}
          view={view}
          viewToggle={viewToggle}
          canManage={canManage}
          onMenu={onMenu}
          onFolder={onFolder}
        />
      )}
    </>
  );
}

function ViewToggle({ view, onChange }: { view: PlanView; onChange: (view: PlanView) => void }) {
  const options: { view: PlanView; label: string; icon: LucideIcon }[] = [
    { view: "list", label: "Afficher en liste", icon: List },
    { view: "grid", label: "Afficher en vignettes", icon: LayoutGrid },
  ];
  return (
    <div className="border-line bg-surface flex shrink-0 rounded-xl border p-0.5 shadow-xs">
      {options.map((option) => (
        <button
          key={option.view}
          type="button"
          aria-label={option.label}
          title={option.label}
          aria-pressed={view === option.view}
          onClick={() => onChange(option.view)}
          className={cn(
            "flex h-11 w-11 cursor-pointer items-center justify-center rounded-[0.625rem] transition-colors",
            view === option.view ? "bg-ead-dark text-white" : "text-dim hover:text-text",
          )}
        >
          <option.icon className="size-5" aria-hidden />
        </button>
      ))}
    </div>
  );
}

const Folders = memo(function Folders({
  projectId,
  plans,
  view,
  viewToggle,
  canManage,
  onMenu,
  onFolder,
}: ListProps & {
  plans: Plans;
  view: PlanView;
  /** The choice between list and thumbnails, at the end of the count's line. */
  viewToggle: ReactNode;
  onFolder: (folder: PlanFolder | null) => void;
}) {
  const [closed, toggle] = useClosedFolders(projectId);
  const groups = useMemo(() => groupByFolder(plans, { keepEmpty: canManage }), [plans, canManage]);
  const foldered = plans.folders.length > 0;

  return (
    <>
      <div className="mt-1 flex min-h-11 items-center gap-2">
        <p className="text-dim min-w-0 flex-1 text-sm leading-snug font-medium">
          <span className="whitespace-nowrap">{count(plans.sheets.length, "feuille")}</span>
          {foldered ? (
            <span
              className={cn(
                "whitespace-nowrap before:content-['_·_']",
                // Next to "Nouveau dossier" on a phone, the two counts stack.
                canManage && "max-sm:block max-sm:before:content-none",
              )}
            >
              {count(plans.folders.length, "dossier")}
            </span>
          ) : null}
        </p>
        {canManage ? (
          // On the narrowest phones the counts need the icon's room.
          <Button
            variant="ghost"
            className="px-2.5 max-[379px]:[&_svg]:hidden"
            onClick={() => onFolder(null)}
          >
            <FolderPlus aria-hidden /> Nouveau dossier
          </Button>
        ) : null}
        {viewToggle}
      </div>
      <div className={foldered ? "mt-1 space-y-2" : "mt-1"}>
        {groups.map((group) => (
          <FolderSection
            key={group.folder?.id ?? LOOSE}
            projectId={projectId}
            group={group}
            // Without folders, the list is just the list.
            titled={foldered}
            open={!closed.has(group.folder?.id ?? LOOSE)}
            view={view}
            canManage={canManage}
            onToggle={toggle}
            onMenu={onMenu}
            onFolder={onFolder}
          />
        ))}
      </div>
    </>
  );
});

const FolderSection = memo(function FolderSection({
  projectId,
  group,
  titled,
  open,
  view,
  canManage,
  onToggle,
  onMenu,
  onFolder,
}: ListProps & {
  group: FolderGroup;
  titled: boolean;
  open: boolean;
  view: PlanView;
  onToggle: (id: string) => void;
  onFolder: (folder: PlanFolder | null) => void;
}) {
  const { folder, sheets } = group;
  const name = folder?.name ?? "Sans dossier";
  if (!titled) {
    return (
      <SheetList
        projectId={projectId}
        sheets={sheets}
        view={view}
        canManage={canManage}
        onMenu={onMenu}
      />
    );
  }
  return (
    <section aria-label={name}>
      <div className={cn("flex items-center gap-1", open && "mb-1.5")}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onToggle(folder?.id ?? LOOSE)}
          className="hover:bg-line/60 active:bg-line/60 -ml-2 flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-xl px-2 text-left transition-colors"
        >
          <ChevronRight
            className={cn("text-dim size-5 shrink-0 transition-transform", open && "rotate-90")}
            aria-hidden
          />
          <span
            className={cn(
              "font-display truncate text-[17px] leading-tight font-bold",
              !folder && "text-dim",
            )}
          >
            {name}
          </span>
          <span className="text-dim ml-1 text-sm font-medium">{sheets.length}</span>
        </button>
        {canManage && folder ? (
          <IconButton label={`Modifier le dossier ${name}`} onClick={() => onFolder(folder)}>
            <Pencil aria-hidden />
          </IconButton>
        ) : null}
      </div>
      {!open ? null : sheets.length > 0 ? (
        <div className="pb-3">
          <SheetList
            projectId={projectId}
            sheets={sheets}
            view={view}
            canManage={canManage}
            onMenu={onMenu}
          />
        </div>
      ) : (
        <p className="border-line text-dim mb-3 rounded-2xl border border-dashed px-4 py-5 text-sm">
          Ce dossier est vide. Choisissez-le quand vous ajoutez des plans, ou ouvrez le menu
          d&apos;une feuille, puis « Déplacer dans un dossier ».
        </p>
      )}
    </section>
  );
});
