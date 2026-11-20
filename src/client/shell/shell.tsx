import {
  Camera,
  ChevronLeft,
  ClipboardList,
  FileText,
  House,
  Layers,
  LayoutGrid,
  Settings,
  UserRound,
  Users,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { useLayoutEffect, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";

import type { ProjectDetail } from "@/shared/api";
import { isAdmin, ROLE_LABELS } from "@/shared/roles";

import { cn } from "../lib/cn";
import { useOnline } from "../lib/online";
import { useCurrentUser } from "../lib/session";
import { Avatar } from "../ui/bits";
import { LogoMark } from "../ui/logo";
import { useBack } from "./back";

// The frame around every signed-in screen. On a phone: a black bar on top and
// tabs under the thumb. On a computer or a wide tablet: a black sidebar.

type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean; also?: string };

const isActive = (path: string, item: NavItem) =>
  path === item.href ||
  (!item.exact && path.startsWith(`${item.href}/`)) ||
  (item.also !== undefined && path.startsWith(item.also));

/** Daily reports are for foremen and the office: workers do not see them. */
function projectTabs(project: ProjectDetail): NavItem[] {
  const base = `/projets/${project.id}`;
  return [
    { href: base, label: "Accueil", icon: House, exact: true },
    { href: `${base}/plans`, label: "Plans", icon: Layers },
    { href: `${base}/documents`, label: "Documents", icon: FileText },
    { href: `${base}/photos`, label: "Photos", icon: Camera },
    ...(project.canManage
      ? [{ href: `${base}/rapports`, label: "Rapports", icon: ClipboardList }]
      : []),
  ];
}

function projectManagement(projectId: string): NavItem[] {
  const base = `/projets/${projectId}`;
  return [
    { href: `${base}/equipe`, label: "Équipe du projet", icon: Users },
    { href: `${base}/reglages`, label: "Réglages du projet", icon: Settings },
  ];
}

function generalTabs(admin: boolean): NavItem[] {
  return [
    { href: "/", label: "Projets", icon: LayoutGrid, exact: true, also: "/projets" },
    ...(admin ? [{ href: "/equipe", label: "Équipe", icon: Users }] : []),
    { href: "/moi", label: "Mon compte", icon: UserRound },
  ];
}

/**
 * Forms are filled in a hurry, on screens where a save bar takes the bottom:
 * on a phone, the tabs make way, and leaving goes through the top bar's arrow.
 */
const FORMS = [
  /^\/projets\/nouveau$/,
  /^\/projets\/[^/]+\/rapports\/nouveau$/,
  /^\/projets\/[^/]+\/rapports\/[^/]+\/modifier$/,
  /^\/projets\/[^/]+\/documents\/ajouter$/,
  /^\/projets\/[^/]+\/plans\/import\/[^/]+$/,
  /^\/projets\/[^/]+\/reglages$/,
];
const isForm = (path: string, search: string) =>
  FORMS.some((form) => form.test(path)) ||
  (path === "/equipe" && new URLSearchParams(search).has("personne"));

/**
 * Tells the bars that stick to the bottom of a screen where to sit: the
 * stylesheet turns this mark into the --ead-tabs height (globals.css).
 */
function useTabsMark(shown: boolean) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.tabs = shown ? "shown" : "hidden";
    return () => {
      delete root.dataset.tabs;
    };
  }, [shown]);
}

export function Shell({ project, children }: { project?: ProjectDetail; children: ReactNode }) {
  const me = useCurrentUser();
  const [path] = useLocation();
  const online = useOnline();
  const admin = isAdmin(me.role);
  const tabs = project ? projectTabs(project) : generalTabs(admin);
  const back = useBack();
  const showTabs = !isForm(path, useSearch());
  useTabsMark(showTabs);

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Computer: the sidebar */}
      <aside className="no-print bg-ink fixed inset-y-0 left-0 z-30 hidden w-64 flex-col text-white lg:flex">
        <Link
          href="/"
          className="flex items-center gap-3 px-5 pt-6 pb-5"
          aria-label="EAD Chantier, tous les projets"
        >
          <LogoMark className="h-9" />
          <span className="font-display text-lg font-bold tracking-tight">Chantier</span>
        </Link>
        <nav aria-label="Navigation" className="flex-1 overflow-y-auto px-3 pb-4">
          <SideLink
            item={generalTabs(admin)[0]}
            active={!project && isActive(path, generalTabs(admin)[0])}
          />
          {admin ? (
            <SideLink
              item={{ href: "/equipe", label: "Équipe", icon: Users }}
              active={path === "/equipe"}
            />
          ) : null}
          {project ? (
            <>
              <div className="mt-6 mb-2 px-3">
                {project.number ? (
                  <p className="font-display text-ead text-xs font-semibold tracking-wider uppercase">
                    {project.number}
                  </p>
                ) : null}
                <p className="font-display mt-0.5 line-clamp-2 text-[15px] leading-snug font-bold">
                  {project.name}
                </p>
              </div>
              {projectTabs(project).map((item) => (
                <SideLink key={item.href} item={item} active={isActive(path, item)} />
              ))}
              {project.canManage ? (
                <>
                  <div className="mx-3 my-3 border-t border-white/10" />
                  {projectManagement(project.id).map((item) => (
                    <SideLink key={item.href} item={item} active={isActive(path, item)} />
                  ))}
                </>
              ) : null}
            </>
          ) : null}
        </nav>
        {online ? null : (
          <p className="bg-warn-tint text-warn mx-3 mb-2 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold">
            <WifiOff className="size-4" aria-hidden /> Hors ligne
          </p>
        )}
        <Link
          href="/moi"
          className={cn(
            "m-3 mt-0 flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/10",
            path === "/moi" && "bg-white/10",
          )}
        >
          <Avatar name={me.name} className="size-9 bg-white/15 text-white" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{me.name}</span>
            <span className="block truncate text-xs text-white/60">
              {me.title ?? ROLE_LABELS[me.role]}
            </span>
          </span>
        </Link>
      </aside>

      {/* Phone: the top bar */}
      <header className="no-print bg-ink sticky top-0 z-30 pt-[env(safe-area-inset-top)] text-white lg:hidden">
        {/* An iPhone held sideways has its notch at one end: the bar's ends keep clear of it. */}
        <div className="flex h-14 items-center gap-1 pr-[calc(0.5rem+env(safe-area-inset-right))] pl-[calc(0.25rem+env(safe-area-inset-left))]">
          {project || back ? (
            <>
              <Link
                href={back?.href ?? "/"}
                aria-label={back ? `Retour\u00a0: ${back.label}` : "Tous les projets"}
                className="flex h-11 shrink-0 items-center gap-0.5 rounded-xl pr-2 pl-1 text-white/80 active:bg-white/10"
              >
                <ChevronLeft className="size-6" aria-hidden />
                <LogoMark className="h-6" />
              </Link>
              {/* The project's home shows its name in large just below. */}
              <div className="min-w-0 flex-1 pl-1">
                {project && path !== `/projets/${project.id}` ? (
                  <>
                    {project.number ? (
                      <p className="font-display text-ead text-xs leading-none font-semibold tracking-wider uppercase">
                        {project.number}
                      </p>
                    ) : null}
                    <p className="font-display truncate text-[15px] leading-tight font-bold">
                      {project.name}
                    </p>
                  </>
                ) : (
                  <p className="font-display text-lg font-bold tracking-tight">Chantier</p>
                )}
              </div>
            </>
          ) : (
            <Link
              href="/"
              className="flex h-11 flex-1 items-center gap-2.5 pl-3"
              aria-label="EAD Chantier"
            >
              <LogoMark className="h-7" />
              <span className="font-display text-lg font-bold tracking-tight">Chantier</span>
            </Link>
          )}
          {online ? null : (
            <span className="bg-warn-tint text-warn flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold">
              <WifiOff className="size-3.5" aria-hidden /> Hors ligne
            </span>
          )}
          <Link
            href="/moi"
            aria-label="Mon compte"
            className="flex size-11 items-center justify-center rounded-xl active:bg-white/10"
          >
            <Avatar name={me.name} className="size-8 bg-white/15 text-xs text-white" />
          </Link>
        </div>
      </header>

      {/*
        Room under the content for the tabs, or for the home indicator without
        them; on its sides, for the notch of an iPhone held sideways.
      */}
      <main className="pr-[env(safe-area-inset-right)] pb-[calc(max(var(--ead-tabs,0px),env(safe-area-inset-bottom))+0.75rem)] pl-[env(safe-area-inset-left)] lg:pb-0">
        {children}
      </main>

      {/* Phone: the tabs */}
      <nav
        aria-label="Navigation"
        hidden={!showTabs}
        className="no-print border-line bg-surface/95 fixed inset-x-0 bottom-0 z-30 border-t pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur lg:hidden"
      >
        <ul className="mx-auto flex max-w-lg">
          {tabs.map((item) => {
            const active = isActive(path, item);
            return (
              <li key={item.href} className="min-w-0 flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold transition-colors",
                    active ? "text-ead-dark" : "text-text/75 active:text-text",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-14 items-center justify-center rounded-full transition-colors",
                      active && "bg-ead-tint",
                    )}
                  >
                    <item.icon className="size-5.5" strokeWidth={active ? 2.4 : 2} aria-hidden />
                  </span>
                  <span className="max-w-full truncate px-0.5">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function SideLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative mb-0.5 flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors",
        active ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white",
      )}
    >
      {active ? (
        <span className="bg-ead absolute top-2.5 bottom-2.5 left-0 w-1 rounded-full" aria-hidden />
      ) : null}
      <item.icon className="size-5" aria-hidden />
      {item.label}
    </Link>
  );
}
