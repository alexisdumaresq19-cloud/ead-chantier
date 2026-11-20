import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Camera,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  FileText,
  Layers,
  LayoutGrid,
  MapPin,
  Mic,
  Navigation,
  PenLine,
  Plus,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

import type { ProjectDetail, ProjectSummary } from "@/shared/api";
import type { Sheet } from "@/shared/plans";
import { crewTotals } from "@/shared/reports";
import { isAdmin } from "@/shared/roles";

import { useAssistant } from "../../lib/assistant";
import { cn } from "../../lib/cn";
import { count, formatWeekday } from "../../lib/format";
import { projectsOpenedAt, recentSheetIds } from "../../lib/recents";
import { useCurrentProject, useCurrentUser, useProjects } from "../../lib/session";
import { planPaths, usePlans, warmSheet } from "../plans/data";
import { TakePhotoButton } from "../photos/take";
import { PlanThumb } from "../plans/parts";
import { useDayReport, useToday } from "../reports/data";
import { formatHours } from "../reports/lib";
import { OfflineProject } from "../../pwa/offline-project";
import { Page, Section } from "../../shell/page";
import {
  Badge,
  buttonClass,
  ButtonLink,
  EmptyState,
  QueryState,
  SearchInput,
  Skeleton,
} from "../../ui";

// The list of projects, and a project's home.

/** Lowercase, without accents: "Gaspé" is found by typing "gaspe". */
const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const matches = (project: ProjectSummary, search: string) =>
  plain(
    [project.number, project.name, project.client, project.city].filter(Boolean).join(" "),
  ).includes(plain(search));

export function ProjectsScreen() {
  const me = useCurrentUser();
  const projects = useProjects();
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const admin = isAdmin(me.role);
  // Read when the screen opens: the project just left comes first.
  const [openedAt] = useState(() => projectsOpenedAt(me.id));
  // A stable sort: projects never opened here keep the server's order.
  const lastOpenedFirst = (list: ProjectSummary[]) =>
    [...list].sort((a, b) => (openedAt[b.id] ?? 0) - (openedAt[a.id] ?? 0));

  return (
    <Page
      title="Projets"
      actions={
        admin ? (
          <ButtonLink href="/projets/nouveau">
            <Plus aria-hidden /> Nouveau projet
          </ButtonLink>
        ) : null
      }
    >
      <QueryState
        query={projects}
        loading={
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
          </div>
        }
      >
        {(all) => {
          const sorted = lastOpenedFirst(all);
          const active = sorted.filter((project) => project.status === "actif");
          const archived = sorted.filter((project) => project.status === "archive");
          if (all.length === 0) {
            return (
              <EmptyState
                icon={LayoutGrid}
                title="Aucun projet pour l'instant"
                text={
                  admin
                    ? "Créez votre premier projet, puis ajoutez-y les plans."
                    : "Votre contremaître ou le bureau doit vous ajouter à un projet. Au chantier, scannez son code QR."
                }
                action={
                  admin ? (
                    <ButtonLink href="/projets/nouveau" size="lg">
                      <Plus aria-hidden /> Créer un projet
                    </ButtonLink>
                  ) : undefined
                }
              />
            );
          }
          const shown = search ? sorted.filter((project) => matches(project, search)) : active;
          return (
            <>
              {all.length > 5 ? (
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Rechercher un projet"
                  className="mb-4 max-w-md"
                />
              ) : null}
              {shown.length > 0 ? (
                <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {shown.map((project) => (
                    <li key={project.id}>
                      <ProjectCard project={project} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-dim py-10 text-center">
                  {search
                    ? `Aucun projet ne correspond à « ${search} ».`
                    : "Aucun projet en cours."}
                </p>
              )}
              {!search && archived.length > 0 ? (
                <div className="mt-8">
                  <button
                    type="button"
                    onClick={() => setShowArchived((value) => !value)}
                    aria-expanded={showArchived}
                    className={buttonClass({ variant: "ghost", size: "sm" })}
                  >
                    <ChevronRight
                      className={cn("transition-transform", showArchived && "rotate-90")}
                      aria-hidden
                    />
                    {count(archived.length, "projet archivé", "projets archivés")}
                  </button>
                  {showArchived ? (
                    <ul className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {archived.map((project) => (
                        <li key={project.id}>
                          <ProjectCard project={project} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </>
          );
        }}
      </QueryState>
    </Page>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const place = [project.client, project.city].filter(Boolean).join(" · ");
  return (
    <Link
      href={`/projets/${project.id}`}
      className="group border-line bg-surface hover:border-ead/60 active:bg-canvas flex h-full flex-col rounded-2xl border p-4 shadow-xs transition hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-ead-dark text-xs font-bold tracking-wider uppercase">
          {project.number ?? "Projet"}
        </span>
        {project.status === "archive" ? (
          <Badge>Archivé</Badge>
        ) : (
          <ChevronRight
            className="text-dim size-5 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        )}
      </div>
      <h2 className="font-display mt-1.5 line-clamp-2 text-lg leading-snug font-bold">
        {project.name}
      </h2>
      {place ? <p className="text-dim mt-1 truncate text-sm">{place}</p> : null}
      {/* A project not set up yet says what it lacks, quietly. */}
      <div className="text-dim mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-4 text-sm font-medium">
        <span
          className={cn("flex items-center gap-1.5", project.sheetCount === 0 && "text-dim/75")}
        >
          <Layers className="size-4" aria-hidden />
          {project.sheetCount === 0 ? "Aucun plan" : count(project.sheetCount, "feuille")}
        </span>
        <span
          className={cn("flex items-center gap-1.5", project.memberCount === 0 && "text-dim/75")}
        >
          <Users className="size-4" aria-hidden />
          {project.memberCount === 0 ? "Personne encore" : count(project.memberCount, "personne")}
        </span>
      </div>
    </Link>
  );
}

export function ProjectHomeScreen() {
  const project = useCurrentProject();
  const base = `/projets/${project.id}`;
  const address = [project.address, project.city].filter(Boolean).join(", ");
  const archived = project.status === "archive";
  const me = useCurrentUser();
  const office = isAdmin(me.role);
  // The sheets this person opened last: a crew works off the same few for
  // days. Read when the screen opens, so coming back from a sheet shows it.
  const plans = usePlans(project.id);
  const [recentIds] = useState(() => recentSheetIds(me.id, project.id));
  const recent = recentIds.flatMap(
    (id) => plans.data?.sheets.find((sheet) => sheet.id === id) ?? [],
  );
  const [resumed, ...others] = recent;
  const waitingForPlans =
    recentIds.length > 0 && plans.data === undefined && plans.fetchStatus === "fetching";

  return (
    <div className="animate-fade">
      {/* The black of the bar runs down into the project's card. */}
      <div className="bg-ink px-4 pt-2 pb-16 text-white sm:px-6 lg:bg-transparent lg:px-10 lg:pt-8 lg:pb-0">
        <div className="lg:bg-ink mx-auto max-w-6xl lg:rounded-3xl lg:px-8 lg:pt-8 lg:pb-20">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {project.number ? (
              <p className="font-display text-ead text-xs font-bold tracking-wider uppercase">
                Projet {project.number}
              </p>
            ) : null}
            {archived ? (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-white/15 px-2 py-0.5 text-xs font-semibold">
                <Archive className="size-3.5" aria-hidden />
                Projet archivé
              </span>
            ) : null}
          </div>
          <h1 className="font-display mt-1 text-[26px] leading-tight font-bold tracking-tight text-balance lg:text-4xl">
            {project.name}
          </h1>
          {project.client ? (
            <p className="mt-1.5 text-[15px] text-white/70">{project.client}</p>
          ) : null}
          {address ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="flex items-center gap-1.5 text-sm text-white/80">
                <MapPin className="text-ead size-4 shrink-0" aria-hidden /> {address}
              </p>
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-sm font-semibold transition-colors hover:bg-white/20"
              >
                <Navigation className="size-4" aria-hidden /> Itinéraire
              </a>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mx-auto -mt-11 max-w-6xl px-4 pb-8 sm:px-6 lg:-mt-12 lg:px-18">
        <PlansCard project={project} resumed={resumed} waiting={waitingForPlans} />
        {archived ? (
          <p className="border-line bg-surface text-dim mt-5 rounded-2xl border px-4 py-3 text-[15px] leading-snug">
            Ce projet est archivé&nbsp;: il se consulte, mais rien ne s&apos;y ajoute.
            {office ? (
              <>
                {" "}
                <Link href={`${base}/reglages`} className="text-ead-dark font-semibold underline">
                  Le rouvrir dans les réglages
                </Link>
              </>
            ) : null}
          </p>
        ) : null}

        <Today project={project} />
        <RecentPlans projectId={project.id} sheets={others} />
        <ModuleLinks project={project} />

        <OfflineProject project={project} />

        {project.description ? (
          <Section title="À propos du projet">
            <p className="text-text max-w-prose text-[15px] leading-relaxed whitespace-pre-line">
              {project.description}
            </p>
          </Section>
        ) : null}

        {project.canManage ? (
          <Section title="Gestion du projet" className="lg:hidden">
            <div className="divide-line border-line bg-surface divide-y overflow-hidden rounded-2xl border shadow-xs">
              <ManageLink
                href={`${base}/equipe`}
                icon={Users}
                label="Équipe et code QR"
                detail={count(project.memberCount, "personne")}
              />
              <ManageLink href={`${base}/reglages`} icon={Settings} label="Réglages du projet" />
            </div>
          </Section>
        ) : null}
      </div>
    </div>
  );
}

/**
 * What is done every day at the site, one tap away: the day's report (for
 * those who write it) and a photo.
 */
function Today({ project }: { project: ProjectDetail }) {
  const base = `/projets/${project.id}`;
  const today = useToday();
  // The day's report is written by those who manage the project, while it is open.
  const writes = project.canChange && project.status !== "archive";
  const day = useDayReport(project.id, today, writes && today !== "");
  const canDictate = useAssistant().data?.dictation === true;
  const report = day.data?.report ?? null;
  const totals = report ? crewTotals(report.crew) : null;
  if (project.status === "archive") return null;

  return (
    <Section title={today ? `Aujourd'hui · ${formatWeekday(today)}` : "Aujourd'hui"}>
      <div className={cn("grid grid-cols-1 gap-2.5 sm:gap-3", writes && "sm:grid-cols-2")}>
        {writes && report ? (
          <ActionRow
            href={`${base}/rapports/${report.id}`}
            icon={CircleCheck}
            tone="done"
            label="Rapport du jour fait"
            detail={
              totals && totals.people > 0
                ? `${count(totals.people, "personne")} · ${formatHours(totals.hours)}`
                : "Ouvrir le rapport"
            }
          />
        ) : writes && canDictate ? (
          <ActionRow
            href={`${base}/rapports/nouveau?dicter=1`}
            icon={Mic}
            tone="dark"
            label="Dicter le rapport du jour"
            detail="Parlez, le rapport se remplit."
          />
        ) : writes ? (
          <ActionRow
            href={`${base}/rapports/nouveau`}
            icon={PenLine}
            tone="dark"
            label="Rapport du jour"
            detail={day.isPending && day.fetchStatus !== "idle" ? "…" : "À faire"}
          />
        ) : null}
        <PhotoAction projectId={project.id} />
      </div>
    </Section>
  );
}

/**
 * Opens the phone's camera at once, from the home. The photos module does the
 * rest on the same screen: the photo goes to its outbox, and a window offers
 * a description and the next photo.
 */
function PhotoAction({ projectId }: { projectId: string }) {
  return (
    <TakePhotoButton
      projectId={projectId}
      label="Prendre une photo"
      className="group border-line bg-surface hover:border-ead/60 active:bg-canvas flex min-h-19 items-center gap-3.5 rounded-2xl border p-3.5 shadow-xs transition active:scale-[0.99]"
    >
      <span className="bg-ead-tint text-ead-dark grid size-12 shrink-0 place-items-center rounded-full">
        <Camera className="size-6" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-display block text-[17px] leading-tight font-bold">
          Prendre une photo
        </span>
        <span className="text-dim mt-0.5 block text-sm leading-snug text-pretty">
          Avancement, imprévu, état des lieux.
        </span>
      </span>
      <ChevronRight
        className="text-dim size-5 shrink-0 transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </TakePhotoButton>
  );
}

function ActionRow({
  href,
  icon: Icon,
  tone,
  label,
  detail,
}: {
  href: string;
  icon: LucideIcon;
  tone: "dark" | "light" | "done";
  label: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex min-h-19 items-center gap-3.5 rounded-2xl border p-3.5 shadow-xs transition active:scale-[0.99]",
        tone === "dark"
          ? "border-ink bg-ink text-white"
          : "border-line bg-surface hover:border-ead/60 active:bg-canvas",
      )}
    >
      <span
        className={cn(
          "grid size-12 shrink-0 place-items-center rounded-full",
          tone === "dark" && "bg-ead text-white shadow-md",
          tone === "light" && "bg-ead-tint text-ead-dark",
          tone === "done" && "bg-good-tint text-good",
        )}
      >
        <Icon className="size-6" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-display block text-[17px] leading-tight font-bold">{label}</span>
        <span
          className={cn(
            "mt-0.5 block text-sm leading-snug text-pretty",
            tone === "dark" ? "text-white/70" : "text-dim",
          )}
        >
          {detail}
        </span>
      </span>
      <ChevronRight
        className={cn(
          "size-5 shrink-0 transition-transform group-hover:translate-x-0.5",
          tone === "dark" ? "text-white/70" : "text-dim",
        )}
        aria-hidden
      />
    </Link>
  );
}

/** The other sheets opened lately, after the one the home offers to resume. */
function RecentPlans({ projectId, sheets }: { projectId: string; sheets: Sheet[] }) {
  const client = useQueryClient();
  if (sheets.length === 0) return null;

  return (
    <Section title="Autres plans récents">
      {/* Bleeds to the screen's edges, so the strip scrolls from side to side. */}
      <ul className="-mx-4 flex snap-x scroll-px-4 [scrollbar-width:none] gap-2.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0">
        {sheets.map((sheet) => (
          <li key={sheet.id} className="w-38 shrink-0 snap-start sm:w-44">
            <Link
              href={planPaths.sheet(projectId, sheet.id)}
              onPointerDown={() => warmSheet(client, projectId, sheet.id)}
              className="group border-line bg-surface hover:border-ead/60 active:bg-canvas block rounded-2xl border p-2 shadow-xs transition active:scale-[0.98]"
            >
              <PlanThumb
                url={sheet.current?.thumbUrl}
                tiles={sheet.current?.tiles}
                className="aspect-[4/3] w-full rounded-xl"
              />
              <span className="font-display mt-2 block truncate px-1 text-[15px] leading-tight font-bold">
                {sheet.number}
              </span>
              <span className="text-dim block truncate px-1 pb-0.5 text-[13px]">{sheet.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * The plans, first on the home: what people open the app for. When this
 * person has opened a sheet here, the card takes them straight back to it.
 */
function PlansCard({
  project,
  resumed,
  waiting,
}: {
  project: ProjectDetail;
  resumed: Sheet | undefined;
  /** Sheets were opened here, and the list that says which is on its way. */
  waiting: boolean;
}) {
  const client = useQueryClient();
  const list = planPaths.list(project.id);
  if (waiting) return <Skeleton className="h-31 rounded-2xl" />;
  if (!resumed) {
    return (
      <Link
        href={list}
        className="group border-ead-dark bg-ead-dark hover:bg-ead-darker flex min-h-24 items-center gap-4 rounded-2xl border p-4 text-white shadow-sm transition hover:shadow-md"
      >
        <span className="flex size-13 shrink-0 items-center justify-center rounded-xl bg-white/15">
          <Layers className="size-7" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-display block truncate text-xl leading-tight font-bold">Plans</span>
          <span className="mt-0.5 block truncate text-[15px] text-white/85">
            {count(project.sheetCount, "feuille")}
          </span>
        </span>
        <ChevronRight
          className="size-5 shrink-0 text-white/85 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
    );
  }
  return (
    <div className="bg-ead-dark overflow-hidden rounded-2xl text-white shadow-sm">
      <Link
        href={planPaths.sheet(project.id, resumed.id)}
        onPointerDown={() => warmSheet(client, project.id, resumed.id)}
        className="group hover:bg-ead-darker active:bg-ead-darker flex min-h-21 items-center gap-3.5 py-3 pr-4 pl-3 transition-colors"
      >
        <PlanThumb
          url={resumed.current?.thumbUrl}
          tiles={resumed.current?.tiles}
          className="h-15 w-20 rounded-lg border-white/30"
        />
        <span className="min-w-0 flex-1">
          <span className="font-display block text-xl leading-tight font-bold">
            Reprendre {resumed.number}
          </span>
          <span className="mt-0.5 block truncate text-[15px] text-white/85">{resumed.title}</span>
        </span>
        <ChevronRight
          className="size-5 shrink-0 text-white/85 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
      <Link
        href={list}
        className="group hover:bg-ead-darker active:bg-ead-darker flex h-12 items-center gap-3 border-t border-white/15 px-4 text-[15px] font-semibold transition-colors"
      >
        <Layers className="size-5 text-white/85" aria-hidden />
        <span className="flex-1">Toutes les feuilles ({project.sheetCount})</span>
        <ChevronRight
          className="size-5 shrink-0 text-white/85 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
    </div>
  );
}

/**
 * The project's other contents, with what they hold: one short row, since
 * the tabs already lead there.
 */
function ModuleLinks({ project }: { project: ProjectDetail }) {
  const base = `/projets/${project.id}`;
  return (
    <ul
      className={cn(
        "border-line bg-surface divide-line mt-8 grid divide-x overflow-hidden rounded-2xl border shadow-xs",
        project.canManage ? "grid-cols-3" : "grid-cols-2",
      )}
    >
      <ModuleLink
        href={`${base}/documents`}
        icon={FileText}
        label={count(project.documentCount, "document")}
      />
      <ModuleLink
        href={`${base}/photos`}
        icon={Camera}
        label={count(project.photoCount, "photo")}
      />
      {project.canManage ? (
        <ModuleLink
          href={`${base}/rapports`}
          icon={ClipboardList}
          label={count(project.reportCount, "rapport")}
        />
      ) : null}
    </ul>
  );
}

function ModuleLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <li className="min-w-0">
      <Link
        href={href}
        className="hover:bg-canvas active:bg-canvas flex h-14 flex-col items-center justify-center gap-0.5 px-1 text-[13px] font-semibold transition-colors sm:flex-row sm:gap-2 sm:text-[15px]"
      >
        <Icon className="text-ead-dark size-5 shrink-0" aria-hidden />
        <span className="max-w-full truncate">{label}</span>
      </Link>
    </li>
  );
}

function ManageLink({
  href,
  icon: Icon,
  label,
  detail,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  detail?: string;
}) {
  return (
    <Link
      href={href}
      className="hover:bg-canvas active:bg-canvas flex min-h-14 items-center gap-3 px-4 py-2 transition-colors"
    >
      <Icon className="text-ead-dark size-5" aria-hidden />
      <span className="flex-1 font-semibold">{label}</span>
      {detail ? <span className="text-dim text-sm">{detail}</span> : null}
      <ChevronRight className="text-dim size-5" aria-hidden />
    </Link>
  );
}
