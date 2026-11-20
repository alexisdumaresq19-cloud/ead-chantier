import { useQueryClient } from "@tanstack/react-query";
import {
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
import { crewTotals } from "@/shared/reports";
import { isAdmin } from "@/shared/roles";

import { useAssistant } from "../../lib/assistant";
import { cn } from "../../lib/cn";
import { count, formatWeekday } from "../../lib/format";
import { recentSheetIds } from "../../lib/recents";
import { useCurrentProject, useCurrentUser, useProjects } from "../../lib/session";
import { planPaths, usePlans, warmSheet } from "../plans/data";
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
          const active = all.filter((project) => project.status === "actif");
          const archived = all.filter((project) => project.status === "archive");
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
          const shown = search ? all.filter((project) => matches(project, search)) : active;
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
      <div className="text-dim mt-auto flex gap-4 pt-4 text-sm font-medium">
        <span className="flex items-center gap-1.5">
          <Layers className="size-4" aria-hidden /> {count(project.sheetCount, "feuille")}
        </span>
        <span className="flex items-center gap-1.5">
          <Users className="size-4" aria-hidden /> {count(project.memberCount, "personne")}
        </span>
      </div>
    </Link>
  );
}

export function ProjectHomeScreen() {
  const project = useCurrentProject();
  const base = `/projets/${project.id}`;
  const address = [project.address, project.city].filter(Boolean).join(", ");

  return (
    <div className="animate-fade">
      {/* The black of the bar runs down into the project's card. */}
      <div className="bg-ink px-4 pt-2 pb-16 text-white sm:px-6 lg:bg-transparent lg:px-10 lg:pt-8 lg:pb-0">
        <div className="lg:bg-ink mx-auto max-w-6xl lg:rounded-3xl lg:px-8 lg:pt-8 lg:pb-20">
          {project.number ? (
            <p className="font-display text-ead text-xs font-bold tracking-wider uppercase">
              Projet {project.number}
            </p>
          ) : null}
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
        <div
          className={cn(
            "grid gap-2.5 sm:gap-3 lg:grid-cols-4",
            project.canManage ? "grid-cols-3" : "grid-cols-2",
          )}
        >
          <ModuleTile
            href={`${base}/plans`}
            icon={Layers}
            label="Plans"
            detail={count(project.sheetCount, "feuille")}
            main
          />
          <ModuleTile
            href={`${base}/documents`}
            icon={FileText}
            label="Documents"
            detail={count(project.documentCount, "document")}
            short={project.documentCount.toLocaleString("fr-CA")}
          />
          <ModuleTile
            href={`${base}/photos`}
            icon={Camera}
            label="Photos"
            detail={count(project.photoCount, "photo")}
            short={project.photoCount.toLocaleString("fr-CA")}
          />
          {project.canManage ? (
            <ModuleTile
              href={`${base}/rapports`}
              icon={ClipboardList}
              label="Rapports"
              detail={count(project.reportCount, "rapport")}
              short={project.reportCount.toLocaleString("fr-CA")}
            />
          ) : null}
        </div>

        <Today project={project} />
        <RecentPlans projectId={project.id} />

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
  const writes = project.canManage && project.status !== "archive";
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
        <ActionRow
          href={`${base}/photos`}
          icon={Camera}
          tone="light"
          label="Prendre une photo"
          detail="Avancement, imprévu, état des lieux."
        />
      </div>
    </Section>
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

/** The sheets this person opened last: a crew works off the same few for days. */
function RecentPlans({ projectId }: { projectId: string }) {
  const me = useCurrentUser();
  const client = useQueryClient();
  const plans = usePlans(projectId);
  // Read when the screen opens: coming back from a sheet shows it first.
  const [ids] = useState(() => recentSheetIds(me.id, projectId));
  const sheets = ids.flatMap((id) => plans.data?.sheets.find((sheet) => sheet.id === id) ?? []);
  if (sheets.length === 0) return null;

  return (
    <Section title="Derniers plans ouverts">
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

function ModuleTile({
  href,
  icon: Icon,
  label,
  detail,
  short,
  main,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  detail: string;
  /** On a narrow phone, where three tiles share a row: the number alone. */
  short?: string;
  /** The plans: what people open the app for. On a phone, a full-width row. */
  main?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex rounded-2xl border shadow-sm transition hover:shadow-md",
        main
          ? "border-ead-dark bg-ead-dark hover:bg-ead-darker col-span-full min-h-24 items-center gap-4 p-4 text-white lg:col-span-1 lg:min-h-36 lg:flex-col lg:items-stretch lg:justify-between"
          : "border-line bg-surface hover:border-ead/60 active:bg-canvas min-h-28 flex-col justify-between p-3 sm:p-4 lg:min-h-36",
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-xl",
          main
            ? "size-13 bg-white/15 text-white lg:size-11"
            : "bg-ead-tint text-ead-dark size-10 sm:size-11",
        )}
      >
        <Icon className={main ? "size-7 lg:size-6" : "size-5.5 sm:size-6"} aria-hidden />
      </span>
      <span
        className={cn("flex min-w-0 items-end justify-between gap-2", main ? "flex-1" : "mt-3")}
      >
        <span className="min-w-0">
          <span
            className={cn(
              "font-display block truncate leading-tight font-bold",
              main ? "text-xl lg:text-lg" : "text-[15px] sm:text-lg",
            )}
          >
            {label}
          </span>
          <span
            className={cn(
              "mt-0.5 block truncate",
              main ? "text-[15px] text-white/85 lg:text-sm" : "text-dim text-[13px] sm:text-sm",
            )}
          >
            {short ? (
              <>
                <span className="sm:hidden">{short}</span>
                <span className="max-sm:hidden">{detail}</span>
              </>
            ) : (
              detail
            )}
          </span>
        </span>
        <ChevronRight
          className={cn(
            "size-5 shrink-0 transition-transform group-hover:translate-x-0.5",
            main ? "self-center text-white/85 lg:self-end" : "text-dim hidden sm:block",
          )}
          aria-hidden
        />
      </span>
    </Link>
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
