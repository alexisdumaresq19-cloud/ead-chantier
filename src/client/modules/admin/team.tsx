import { useMutation } from "@tanstack/react-query";
import { ChevronRight, ShieldAlert, UserPlus, Users } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "wouter";

import type { InviteLink, Person, ProjectSummary } from "@/shared/api";
import { isAdmin } from "@/shared/roles";

import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { count } from "../../lib/format";
import { useCurrentUser, useProjects } from "../../lib/session";
import { Page, Section } from "../../shell/page";
import {
  Avatar,
  Badge,
  Button,
  buttonClass,
  Card,
  EmptyState,
  QueryState,
  SearchInput,
  Sheet,
  Skeleton,
} from "../../ui";
import { refreshPeople, usePeople } from "./data";
import { InviteLinkPanel } from "./invite-link";
import { Meta } from "./meta";
import { OfficeOnly } from "./office-only";
import {
  firstName,
  lastSeenText,
  matchesPerson,
  roleAndTitle,
  sortPeople,
  UNREVIEWED_RULE,
} from "./people";
import {
  focusName,
  NEW_PERSON,
  nameProblem,
  personBody,
  PersonFields,
  type PersonForm,
} from "./person-fields";
import { PersonView } from "./person";
import { ShownError } from "./shown-error";

// Everyone who has, or had, a way into the app: the office's list. A person
// opens at /equipe?personne=…, over the list, which keeps its place.

export function TeamScreen() {
  const me = useCurrentUser();
  const [params] = useSearchParams();
  const personId = params.get("personne");
  const listScroll = useRef(0);

  // The path stays "/equipe" between the list and a person, and the app only
  // moves to the top of a screen when the path changes. So it is done here: a
  // person opens at the top, and closing them returns to where the list was.
  useLayoutEffect(() => {
    window.scrollTo(0, personId ? 0 : listScroll.current);
  }, [personId]);

  if (!isAdmin(me.role)) return <OfficeOnly title="Équipe" />;
  return (
    // A name typed without a space (anyone gives theirs at a site's QR code)
    // breaks where the line ends, in the page's title and the windows' too,
    // and never pushes the screen wider than the phone.
    <div className="wrap-anywhere">
      {/* Kept in place under an open person, with its search. */}
      <div hidden={Boolean(personId)}>
        <PeopleList
          onOpen={() => {
            listScroll.current = window.scrollY;
          }}
        />
      </div>
      {personId ? <PersonView key={personId} id={personId} /> : null}
    </div>
  );
}

function PeopleList({ onOpen }: { onOpen: () => void }) {
  const people = usePeople();
  const projects = useProjects();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const add = () => setAdding(true);

  return (
    <Page
      title="Équipe"
      subtitle={
        people.data
          ? count(people.data.filter((person) => person.active).length, "personne")
          : undefined
      }
      actions={
        <Button size="lg" className="hidden sm:inline-flex" onClick={add}>
          <UserPlus aria-hidden /> Ajouter une personne
        </Button>
      }
    >
      <Button size="lg" block className="mb-6 sm:hidden" onClick={add}>
        <UserPlus aria-hidden /> Ajouter une personne
      </Button>
      <QueryState
        query={people}
        loading={
          <div className="space-y-2">
            <Skeleton className="h-12 max-w-md" />
            <Skeleton className="h-64" />
          </div>
        }
      >
        {(all) => (
          <>
            {all.length > 6 ? (
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Rechercher une personne"
                className="mb-5 max-w-md"
              />
            ) : null}
            {search ? (
              <Found people={all} search={search} onOpen={onOpen} />
            ) : (
              <Everyone people={all} onOpen={onOpen} />
            )}
          </>
        )}
      </QueryState>
      <AddPersonSheet
        open={adding}
        onClose={() => setAdding(false)}
        projects={projects.data ?? []}
      />
    </Page>
  );
}

/** What a search finds, deactivated people included. */
function Found({
  people,
  search,
  onOpen,
}: {
  people: Person[];
  search: string;
  onOpen: () => void;
}) {
  const found = sortPeople(people.filter((person) => matchesPerson(person, search)));
  return found.length > 0 ? (
    <PeopleTable people={found} onOpen={onOpen} />
  ) : (
    <p className="text-dim py-10 text-center">Personne ne correspond à «&nbsp;{search}&nbsp;».</p>
  );
}

/** The whole list: people to check first, then everyone, then those whose access is off. */
function Everyone({ people, onOpen }: { people: Person[]; onOpen: () => void }) {
  const [showInactive, setShowInactive] = useState(false);
  const active = sortPeople(people.filter((person) => person.active));
  const waiting = active.filter((person) => person.unreviewed);
  const checked = active.filter((person) => !person.unreviewed);
  const inactive = sortPeople(people.filter((person) => !person.active));
  return (
    // The first section sits right under the search box.
    <div>
      {waiting.length > 0 ? (
        <Section title={`À confirmer (${waiting.length})`}>
          <p className="bg-warn-tint text-warn mb-3 flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[15px] text-pretty">
            <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>
              {waiting.length > 1
                ? "Ces personnes sont entrées avec le code QR d'un chantier. Ouvrez une fiche pour confirmer la personne ou couper son accès."
                : "Cette personne est entrée avec le code QR d'un chantier. Ouvrez sa fiche pour la confirmer ou couper son accès."}{" "}
              {UNREVIEWED_RULE}
            </span>
          </p>
          <PeopleTable people={waiting} onOpen={onOpen} />
        </Section>
      ) : null}
      {/* Without anyone to check, the list needs no title: the page's says it. */}
      {waiting.length > 0 ? (
        <Section title="Tout le monde">
          <PeopleTable people={checked} onOpen={onOpen} />
        </Section>
      ) : (
        <PeopleTable people={checked} onOpen={onOpen} />
      )}
      {people.length === 1 ? (
        <EmptyState
          icon={Users}
          title="L'équipe est encore vide"
          text="Ajoutez une personne pour lui envoyer son lien personnel. Au chantier, les travailleurs entrent aussi avec le code QR du projet."
          className="mt-4"
        />
      ) : null}
      {inactive.length > 0 ? (
        <div className="mt-8">
          <button
            type="button"
            onClick={() => setShowInactive((value) => !value)}
            aria-expanded={showInactive}
            className={buttonClass({ variant: "ghost" })}
          >
            <ChevronRight
              className={cn("transition-transform", showInactive && "rotate-90")}
              aria-hidden
            />
            {count(inactive.length, "personne désactivée", "personnes désactivées")}
          </button>
          {showInactive ? (
            <div className="mt-3">
              <PeopleTable people={inactive} onOpen={onOpen} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const COLUMNS = "lg:grid lg:grid-cols-[minmax(0,1fr)_8.5rem_8rem_8rem_11rem_1.25rem] lg:gap-4";

/** Rows on a phone; on a wide screen, the same rows lined up in columns. */
function PeopleTable({ people, onOpen }: { people: Person[]; onOpen: () => void }) {
  return (
    <Card className="overflow-hidden">
      <div
        className={cn(
          "border-line text-dim hidden border-b px-4 py-2.5 text-xs font-bold tracking-wider uppercase",
          COLUMNS,
        )}
        aria-hidden
      >
        <span>Personne</span>
        <span>Rôle</span>
        <span>Projets</span>
        <span>Appareils</span>
        <span>Dernière activité</span>
      </div>
      <ul className="divide-line divide-y">
        {people.map((person) => (
          <li key={person.id}>
            <PersonRow person={person} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PersonRow({ person, onOpen }: { person: Person; onOpen: () => void }) {
  const projects =
    person.role === "admin"
      ? "Tous les projets"
      : person.projectIds.length > 0
        ? count(person.projectIds.length, "projet")
        : "Aucun projet";
  const devices = person.deviceCount > 0 ? count(person.deviceCount, "appareil") : "Aucun appareil";
  const seen = lastSeenText(person.lastSeenAt);
  const { role, title } = roleAndTitle(person);
  return (
    <Link
      href={`/equipe?personne=${person.id}`}
      onClick={onOpen}
      className={cn(
        "hover:bg-canvas active:bg-canvas flex min-h-16 items-center gap-3 px-3 py-3 transition-colors sm:px-4",
        COLUMNS,
        !person.active && "opacity-70",
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={person.name} />
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold wrap-anywhere">{person.name}</span>
            {person.unreviewed ? (
              <Badge tone="warn">
                <ShieldAlert aria-hidden /> À confirmer
              </Badge>
            ) : null}
            {person.active ? null : <Badge>Accès désactivé</Badge>}
          </span>
          <Meta items={[role, title]} className="text-dim text-sm wrap-anywhere lg:hidden" />
          {/* "Jamais connecté" already says there is no device. */}
          <Meta
            items={[projects, person.lastSeenAt ? devices : null, seen]}
            className="text-dim text-sm lg:hidden"
          />
          {title ? (
            <span className="text-dim hidden text-sm wrap-anywhere lg:block">{title}</span>
          ) : null}
        </span>
      </span>
      <span className="hidden text-sm lg:block">{role}</span>
      <span className="text-dim hidden text-sm lg:block">{projects}</span>
      <span className="text-dim hidden text-sm lg:block">{devices}</span>
      <span className="text-dim hidden text-sm lg:block">{seen}</span>
      <ChevronRight className="text-dim size-5 shrink-0" aria-hidden />
    </Link>
  );
}

/** Adds someone, then shows their personal link, once. */
function AddPersonSheet({
  open,
  onClose,
  projects,
}: {
  open: boolean;
  onClose: () => void;
  projects: ProjectSummary[];
}) {
  const formId = useId();
  const [form, setForm] = useState<PersonForm>(NEW_PERSON);
  const [checked, setChecked] = useState(false);
  // The link lives here only: closing the window lets go of it for good.
  const [invited, setInvited] = useState<{ person: PersonForm; link: InviteLink } | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api<{ id: string; invite: InviteLink }>("/api/users", {
        method: "POST",
        body: personBody(form),
      }),
    onSuccess: ({ invite }) => {
      // The window keeps its scroll from one step to the next: the link must
      // not open half hidden where the bottom of the form was.
      document.getElementById(formId)?.scrollIntoView({ block: "start" });
      setInvited({ person: form, link: invite });
      return refreshPeople();
    },
  });

  const startOver = () => {
    setForm(NEW_PERSON);
    setChecked(false);
    setInvited(null);
    create.reset();
  };
  const close = () => {
    startOver();
    onClose();
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setChecked(true);
    if (nameProblem(form)) return focusName(event.currentTarget);
    create.mutate();
  };

  if (invited) {
    const { person, link } = invited;
    return (
      <Sheet
        open={open}
        onClose={close}
        title={`${firstName(person.name)} peut entrer`}
        description="Envoyez-lui son lien personnel maintenant. Il ne s'affichera plus ensuite."
        footer={
          <>
            <Button variant="secondary" onClick={startOver}>
              Ajouter une autre personne
            </Button>
            <Button onClick={close}>Terminé</Button>
          </>
        }
      >
        <InviteLinkPanel
          link={link}
          person={{
            name: person.name,
            phone: person.phone.trim() || null,
            email: person.email.trim() || null,
          }}
        />
      </Sheet>
    );
  }
  return (
    <Sheet
      open={open}
      onClose={close}
      title="Ajouter une personne"
      description="Vous recevrez ensuite son lien personnel, à lui envoyer par texto ou par courriel."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Annuler
          </Button>
          <Button type="submit" form={formId} loading={create.isPending}>
            Ajouter et créer le lien
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        {/* The name is what the office is about to type, for the first person and the next. */}
        <PersonFields
          form={form}
          onChange={setForm}
          projects={projects}
          focusName
          nameError={checked ? nameProblem(form) : null}
        />
        <ShownError error={create.error} />
      </form>
    </Sheet>
  );
}
