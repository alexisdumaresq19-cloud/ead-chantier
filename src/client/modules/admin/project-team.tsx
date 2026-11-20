import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Phone,
  Printer,
  QrCode as QrIcon,
  RefreshCw,
  Share2,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

import type { InviteLink, Member, ProjectDetail } from "@/shared/api";
import { isAdmin } from "@/shared/roles";

import { api, errorMessage } from "../../lib/api";
import { count, formatWeekday } from "../../lib/format";
import { queryClient } from "../../lib/query";
import { useCurrentProject, useCurrentUser } from "../../lib/session";
import { isNativeApp, shareLinkInApp } from "../../native";
import { Page } from "../../shell/page";
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  confirmAction,
  EmptyState,
  FormError,
  IconButton,
  LogoFull,
  QueryState,
  SearchInput,
  Sheet,
  Skeleton,
  Spinner,
  toast,
} from "../../ui";
import { adminKeys, refreshPeople, useMembers, useNow, usePeople } from "./data";
import { canShare, LinkField, shareLink } from "./invite-link";
import {
  formatPhone,
  matchesPerson,
  roleAndTitle,
  SITE_CODE_DAYS,
  siteCodeText,
  sortByName,
  sortMembers,
  telHref,
  titleOrRole,
} from "./people";
import { CheckRow } from "./project-picker";
import { QrCode } from "./qr";
import { ShownError } from "./shown-error";
import { hasRunOut, storeSiteCode, useStoredSiteCode } from "./site-code";
import { ToConfirm } from "./to-confirm";

// The iPhone app always has the share sheet. It cannot print a page
// (window.print() does nothing there): the poster is printed from a computer.
const canShareHere = () => isNativeApp() || canShare();
async function shareHere(data: { title?: string; text?: string; url: string }) {
  if (!isNativeApp()) return shareLink(data);
  if (!(await shareLinkInApp(data)))
    toast.error("Le partage n'a pas fonctionné. Copiez le lien à la place.");
}

// A project's people and its way in: the QR code shown at the site, which
// workers scan to join.

export function ProjectTeamScreen() {
  const me = useCurrentUser();
  const project = useCurrentProject();
  const office = isAdmin(me.role);
  // An archived project admits nobody new: it has no code to show.
  const open = project.status !== "archive";
  // Nor does the demonstration account let anyone in.
  const showsCode = project.canChange && open && !me.demo;
  const [codeOpen, setCodeOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const members = useMembers(project.id, { watch: codeOpen });
  const code = useSiteCode(project.id, codeOpen);
  // While the code is on screen, printing gives its poster.
  const poster = codeOpen && code.state === "ready" ? code.link : null;

  const openCode = () => {
    setCodeOpen(true);
    code.show();
  };
  const actions =
    office || showsCode ? (
      <>
        {office ? (
          <Button
            variant={showsCode ? "secondary" : "primary"}
            size="lg"
            onClick={() => setAdding(true)}
          >
            <UserPlus aria-hidden /> Ajouter des personnes
          </Button>
        ) : null}
        {showsCode ? (
          <Button size="lg" onClick={openCode}>
            <QrIcon aria-hidden /> Code QR du chantier
          </Button>
        ) : null}
      </>
    ) : null;

  return (
    // A name without a space breaks where the line ends, in the windows and
    // on the poster too, and never pushes the screen wider than the phone.
    <div className="wrap-anywhere">
      <div className={poster ? "print:hidden" : undefined}>
        <Page
          title="Équipe du projet"
          subtitle={members.data?.length ? count(members.data.length, "personne") : undefined}
          back={{ href: `/projets/${project.id}`, label: "Accueil du projet" }}
          actions={actions ? <div className="hidden gap-2 sm:flex">{actions}</div> : undefined}
        >
          {actions ? (
            <div className="mb-5 flex flex-col-reverse gap-2 sm:hidden [&>button]:w-full">
              {actions}
            </div>
          ) : null}
          <QueryState query={members} loading={<Skeleton className="h-48" />}>
            {(list) =>
              list.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="Personne sur ce projet pour l'instant"
                  text={
                    showsCode
                      ? "Au chantier, montrez le code QR : chacun le scanne avec son téléphone et inscrit son nom."
                      : open
                        ? "Le bureau ou votre contremaître y ajoutera l'équipe."
                        : "Ce projet est archivé."
                  }
                />
              ) : (
                <>
                  {list.some((member) => member.unreviewed) ? (
                    <ToConfirm
                      projectId={project.id}
                      people={list.filter((member) => member.unreviewed)}
                    />
                  ) : null}
                  {/* Under the people to confirm, the rest of the team gets its own title. */}
                  {list.some((member) => member.unreviewed) &&
                  list.some((member) => !member.unreviewed) ? (
                    <h2 className="font-display text-dim mb-3 text-sm font-bold tracking-wider uppercase">
                      Équipe confirmée
                    </h2>
                  ) : null}
                  <MemberList
                    project={project}
                    members={list.filter((member) => !member.unreviewed)}
                    office={office}
                  />
                </>
              )
            }
          </QueryState>
        </Page>
      </div>
      {poster ? <SitePoster project={project} link={poster} /> : null}
      {showsCode ? (
        <SiteCodeSheet
          open={codeOpen}
          onClose={() => setCodeOpen(false)}
          project={project}
          code={code}
          memberCount={members.data?.length}
        />
      ) : null}
      {office ? (
        <AddPeopleSheet
          open={adding}
          onClose={() => setAdding(false)}
          projectId={project.id}
          members={members.data ?? []}
        />
      ) : null}
    </div>
  );
}

// --- The people ---------------------------------------------------------------

function MemberList({
  project,
  members,
  office,
}: {
  project: ProjectDetail;
  members: Member[];
  office: boolean;
}) {
  const [search, setSearch] = useState("");
  const remove = useMutation({
    mutationFn: (member: Member) =>
      api(`/api/projects/${project.id}/members/${member.id}`, { method: "DELETE" }),
    onSuccess: (_, member) => toast.success(`${member.name} ne fait plus partie du projet`),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: refreshPeople,
  });
  const askToRemove = async (member: Member) => {
    const ok = await confirmAction({
      title: `Retirer ${member.name} du projet?`,
      text:
        member.role === "admin"
          ? "Son nom quittera la liste de l'équipe. Le bureau garde l'accès à tous les projets."
          : "Cette personne ne verra plus ce projet. Son compte et ses autres projets restent.",
      confirmLabel: "Retirer du projet",
      danger: true,
    });
    if (ok) remove.mutate(member);
  };

  if (members.length === 0) return null;
  const shown = sortMembers(members.filter((member) => matchesPerson(member, search)));
  return (
    <>
      {members.length > 8 ? (
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Rechercher une personne"
          className="mb-4 max-w-md"
        />
      ) : null}
      {shown.length > 0 ? (
        <Card className="overflow-hidden">
          <ul className="divide-line divide-y">
            {shown.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                office={office}
                onRemove={() => askToRemove(member)}
                removing={remove.isPending && remove.variables.id === member.id}
              />
            ))}
          </ul>
        </Card>
      ) : (
        <p className="text-dim py-10 text-center">
          Personne ne correspond à «&nbsp;{search}&nbsp;».
        </p>
      )}
    </>
  );
}

function MemberRow({
  member,
  office,
  onRemove,
  removing,
}: {
  member: Member;
  office: boolean;
  onRemove: () => void;
  removing: boolean;
}) {
  const tel = member.phone ? telHref(member.phone) : null;
  const phone = member.phone ? formatPhone(member.phone) : null;
  // A foreman or the office carries a badge (in their own words when their
  // title says the same): the line under the name is for the job title.
  const { role, title } = roleAndTitle(member);
  const badge = member.demo ? "Démonstration" : member.role === "travailleur" ? null : role;
  const detail = badge ? title : (title ?? role);
  const name = <span className="font-semibold wrap-anywhere">{member.name}</span>;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
      <Avatar name={member.name} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {office ? (
            <Link
              href={`/equipe?personne=${member.id}`}
              className="text-ead-dark -my-2.5 inline-block py-2.5 underline-offset-2 hover:underline"
            >
              {name}
            </Link>
          ) : (
            name
          )}
          {badge ? <Badge tone="blue">{badge}</Badge> : null}
        </p>
        {detail ? <p className="text-dim text-sm wrap-anywhere">{detail}</p> : null}
        {/* Beside the name on a wide screen, the number is in the call button. */}
        {phone ? <p className="text-dim text-sm sm:hidden">{phone}</p> : null}
      </div>
      {tel ? (
        <a
          href={tel}
          aria-label={`Appeler ${member.name} au ${phone}`}
          className="bg-ead-tint text-ead-dark hover:bg-ead/20 inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full text-[15px] font-semibold transition-colors sm:px-4"
        >
          <Phone className="size-5" aria-hidden />
          <span className="hidden tabular-nums sm:inline">{phone}</span>
        </a>
      ) : null}
      {office ? (
        removing ? (
          <span className="flex size-11 shrink-0 items-center justify-center">
            <Spinner className="size-5" />
          </span>
        ) : (
          <IconButton label={`Retirer ${member.name} du projet`} onClick={onRemove}>
            <UserMinus aria-hidden />
          </IconButton>
        )
      ) : null}
    </li>
  );
}

/** The office picks, among everyone, people to put on the project. */
function AddPeopleSheet({
  open,
  onClose,
  projectId,
  members,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  members: Member[];
}) {
  const people = usePeople({ enabled: open });
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const close = () => {
    setSearch("");
    setPicked([]);
    onClose();
  };
  const add = useMutation({
    mutationFn: () =>
      api(`/api/projects/${projectId}/members`, { method: "POST", body: { userIds: picked } }),
    onSuccess: () => {
      toast.success(
        picked.length > 1
          ? `${picked.length} personnes ajoutées au projet`
          : "Personne ajoutée au projet",
      );
      close();
      return refreshPeople();
    },
  });

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Ajouter des personnes"
      description="Parmi les personnes déjà inscrites. Au chantier, le code QR va plus vite."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Annuler
          </Button>
          <Button
            onClick={() => add.mutate()}
            disabled={picked.length === 0}
            loading={add.isPending}
          >
            {picked.length > 1 ? `Ajouter ${picked.length} personnes` : "Ajouter au projet"}
          </Button>
        </>
      }
    >
      <QueryState query={people}>
        {(all) => {
          const onProject = new Set(members.map((member) => member.id));
          const available = sortByName(
            // The demonstration account's projects are on its own card.
            all.filter((person) => person.active && !person.demo && !onProject.has(person.id)),
          );
          if (available.length === 0) {
            return (
              <div className="py-6 text-center">
                <p className="text-dim text-[15px] text-pretty">
                  Tout le monde est déjà sur ce projet. Pour inviter quelqu&apos;un de nouveau,
                  ajoutez cette personne à l&apos;équipe.
                </p>
                <div className="mt-4">
                  <ButtonLink href="/equipe" variant="secondary">
                    Ouvrir l&apos;équipe
                  </ButtonLink>
                </div>
              </div>
            );
          }
          const shown = available.filter((person) => matchesPerson(person, search));
          return (
            <div className="space-y-3">
              {available.length > 8 ? (
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Rechercher une personne"
                />
              ) : null}
              {shown.length > 0 ? (
                <ul className="divide-line border-line divide-y rounded-xl border">
                  {shown.map((person) => (
                    <li key={person.id}>
                      <CheckRow
                        checked={picked.includes(person.id)}
                        onChange={(checked) =>
                          setPicked((current) =>
                            checked
                              ? [...current, person.id]
                              : current.filter((id) => id !== person.id),
                          )
                        }
                        title={person.name}
                        detail={titleOrRole(person)}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-dim py-6 text-center">
                  Personne ne correspond à «&nbsp;{search}&nbsp;».
                </p>
              )}
              <ShownError error={add.error} />
            </div>
          );
        }}
      </QueryState>
    </Sheet>
  );
}

// --- The site's QR code -------------------------------------------------------

type SiteCode = (
  | { state: "none" | "making" | "expired" | "replaced" | "ended" }
  | { state: "failed"; error: unknown }
  /** renewError: why asking for a new code failed; the current one still works. */
  | { state: "ready"; link: InviteLink; renewError: unknown }
) & {
  now: Date;
  /** Shows the code, making one only if this device holds none that still works. */
  show: () => void;
  /** Makes a new code, which ends the previous one. */
  renew: () => void;
};

/**
 * This device's QR code for the site: made when the person asks for it, then
 * kept until it runs out (see site-code.ts). Showing it again never makes a
 * new one.
 */
function useSiteCode(projectId: string, watching: boolean): SiteCode {
  const me = useCurrentUser();
  const now = useNow();
  const link = useStoredSiteCode(me.id, projectId);
  const expired = link !== null && hasRunOut(link, now);
  // Another device may have made a newer code since: the server says which
  // one is in force, without giving the link again.
  const inForce = useQuery({
    queryKey: adminKeys.siteCodeCheck(projectId),
    queryFn: () => api<{ expiresAt: string | null }>(`/api/projects/${projectId}/qr`),
    enabled: watching && link !== null && !expired,
    staleTime: 0,
    meta: { persist: false },
  });
  const make = useMutation({
    mutationFn: () => api<InviteLink>(`/api/projects/${projectId}/qr`, { method: "POST" }),
    onSuccess: async (made) => {
      // An answer on its way describes the code just replaced.
      await queryClient.cancelQueries({ queryKey: adminKeys.siteCodeCheck(projectId) });
      queryClient.setQueryData(adminKeys.siteCodeCheck(projectId), { expiresAt: made.expiresAt });
      storeSiteCode(me.id, projectId, made);
    },
  });

  const common = {
    now,
    show: () => {
      // A code that still works is shown again, whatever went wrong before.
      if (link && !hasRunOut(link, new Date())) make.reset();
      else if (!make.isPending) make.mutate();
    },
    renew: () => make.mutate(),
  };
  if (make.isPending) return { state: "making", ...common };
  const superseded =
    link !== null && inForce.data !== undefined && inForce.data.expiresAt !== link.expiresAt;
  // A code that works stays on screen, even when asking for a new one failed:
  // without signal, the code in hand is the one people can still scan.
  if (link && !expired && !superseded)
    return { state: "ready", link, renewError: make.error, ...common };
  if (make.isError) return { state: "failed", error: make.error, ...common };
  if (!link) return { state: "none", ...common };
  if (expired) return { state: "expired", ...common };
  return { state: inForce.data?.expiresAt ? "replaced" : "ended", ...common };
}

function SiteCodeSheet({
  open,
  onClose,
  project,
  code,
  memberCount,
}: {
  open: boolean;
  onClose: () => void;
  project: ProjectDetail;
  code: SiteCode;
  memberCount: number | undefined;
}) {
  const renew = async () => {
    const ok = await confirmAction({
      title: "Créer un nouveau code?",
      text: "Le code actuel cessera de fonctionner, sur cet écran comme sur l'affiche imprimée.",
      confirmLabel: "Créer un nouveau code",
    });
    if (ok) code.renew();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Code QR du chantier"
      description={[project.number, project.name].filter(Boolean).join(" · ")}
    >
      {code.state === "ready" ? (
        <>
          <div className="border-line mx-auto w-full max-w-[min(100%,54dvh)] overflow-hidden rounded-2xl border bg-white">
            <QrCode value={code.link.url} label={`Code QR pour entrer sur ${project.name}`} />
          </div>
          <p className="mt-3 text-center text-[15px] font-semibold text-pretty">
            À scanner avec l&apos;appareil photo du téléphone
          </p>
          {/* Said plainly: the code is printed and taped up for the week. */}
          <p className="mt-1 text-center text-[15px] text-pretty">
            {siteCodeText(code.link.expiresAt)}
          </p>
          {memberCount !== undefined ? (
            <p className="text-dim mt-1 flex items-center justify-center gap-1.5 text-sm">
              <Users className="size-4" aria-hidden />
              {count(memberCount, "personne")} dans l&apos;équipe
            </p>
          ) : null}
          <div className="mt-4 space-y-2">
            {/* A new code starts with a link not copied yet. */}
            <LinkField key={code.link.url} url={code.link.url} label="Lien du code QR" />
            {/* Side by side where both fit, one under the other on a narrow phone. */}
            <div className="flex flex-wrap gap-2 *:flex-1">
              {canShareHere() ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    shareHere({
                      title: project.name,
                      text: `Pour voir les plans du chantier ${project.name} dans EAD Chantier, ouvrez ce lien et inscrivez votre nom.`,
                      url: code.link.url,
                    })
                  }
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
            <Button variant="ghost" block onClick={renew}>
              <RefreshCw aria-hidden /> Créer un nouveau code
            </Button>
            <ShownError error={code.renewError} />
          </div>
        </>
      ) : code.state === "making" ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <Spinner className="size-8" label="Création du code" />
          <p className="text-dim text-[15px]">Création du code…</p>
        </div>
      ) : (
        <div className="space-y-4 py-4">
          {code.state === "failed" ? (
            <FormError>{errorMessage(code.error)}</FormError>
          ) : (
            <p className="text-[15px] text-pretty">
              {code.state === "expired"
                ? "Ce code est arrivé à échéance\u00a0: il ne fonctionne plus."
                : code.state === "replaced"
                  ? "Ce code a été remplacé par un plus récent, créé sur un autre de vos appareils. Il ne fonctionne plus."
                  : code.state === "ended"
                    ? "Ce code ne fonctionne plus."
                    : `Le code permet aux travailleurs d'entrer sur ce projet avec leur téléphone, pendant ${SITE_CODE_DAYS}\u00a0jours.`}
            </p>
          )}
          <Button size="lg" block onClick={code.renew}>
            <QrIcon aria-hidden />
            {code.state === "failed"
              ? "Réessayer"
              : code.state === "none"
                ? "Créer le code"
                : "Créer un nouveau code"}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

// Letter paper without margins: the poster sets its own. The windows open
// over the screen (the code itself) stay out of the print.
const PRINT_RULES = `
@page { size: letter portrait; margin: 0; }
@media print {
  html, body { background: #fff !important; }
  dialog { display: none !important; }
}`;

/**
 * The poster for the site trailer. It only exists on paper: hidden on screen,
 * alone on the sheet when printed.
 */
function SitePoster({ project, link }: { project: ProjectDetail; link: InviteLink }) {
  const end = new Date(link.expiresAt);
  const place = [project.client, project.city].filter(Boolean).join(" · ");
  return (
    <div className="hidden bg-white text-black print:fixed print:inset-0 print:flex print:flex-col">
      <style>{PRINT_RULES}</style>
      {/* The logo is drawn for black: the band is printed even when the
          browser leaves backgrounds out. */}
      <div className="bg-ink flex items-center justify-between gap-8 px-[0.7in] py-[0.3in] text-white [-webkit-print-color-adjust:exact] [print-color-adjust:exact]">
        <LogoFull className="w-[1.7in]" />
        <p className="font-display text-right text-[21pt] leading-tight font-bold">
          Les plans du chantier
          <br />
          sur votre téléphone
        </p>
      </div>
      <div className="flex flex-1 flex-col items-center px-[0.7in] pt-[0.4in] pb-[0.45in] text-center">
        {project.number ? (
          <p className="font-display text-ead-dark text-[13pt] font-bold tracking-wider uppercase">
            Projet {project.number}
          </p>
        ) : null}
        <h1 className="font-display mt-1 text-[27pt] leading-tight font-extrabold text-balance">
          {project.name}
        </h1>
        {place ? <p className="mt-1 text-[13pt]">{place}</p> : null}
        {/* The code takes the room the project's name leaves, up to 4.6 inches. */}
        <div className="flex min-h-0 flex-1 items-center justify-center py-[0.25in]">
          <QrCode
            value={link.url}
            level="M"
            label={`Code QR pour entrer sur ${project.name}`}
            className="h-full max-h-[4.6in] w-auto max-w-full"
          />
        </div>
        <ol className="space-y-1.5 text-left text-[15pt] leading-snug">
          <li>
            <strong>1.</strong> Visez ce code avec l&apos;appareil photo de votre téléphone.
          </li>
          <li>
            <strong>2.</strong> Touchez le lien qui s&apos;affiche, puis inscrivez votre nom.
          </li>
        </ol>
        <p className="mt-[0.3in] text-[10.5pt] text-balance">
          Ce code fonctionne jusqu&apos;au {formatWeekday(end)}. Ensuite, demandez le nouveau code à
          votre contremaître.
        </p>
        <p className="font-display mt-1 text-[10.5pt] font-bold">
          Les Entreprises Allen Dumaresq · EAD Chantier
        </p>
      </div>
    </div>
  );
}
