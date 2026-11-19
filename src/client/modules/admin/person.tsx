import { useMutation } from "@tanstack/react-query";
import { Link2, ShieldAlert, ShieldCheck, UserRoundCheck, UserRoundX, UserX } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { InviteLink, Person, ProjectSummary } from "@/shared/api";
import { ROLE_LABELS } from "@/shared/roles";

import { api, errorMessage } from "../../lib/api";
import { queryClient } from "../../lib/query";
import { keys, useCurrentUser, useProjects } from "../../lib/session";
import { Page, Section } from "../../shell/page";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  confirmAction,
  EmptyState,
  QueryState,
  Sheet,
  Skeleton,
  toast,
} from "../../ui";
import { adminKeys, refreshPeople, usePeople } from "./data";
import { DeviceList } from "./devices";
import { InviteLinkPanel } from "./invite-link";
import { firstName, formatPhone, lastSeenText, telHref } from "./people";
import { personBody, PersonFields, type PersonForm } from "./person-fields";
import { ShownError } from "./shown-error";

// One person, for the office: their details, role and projects, their
// devices, a new link for a new phone, and their access switched off or on.

const BACK = { href: "/equipe", label: "Équipe" };

export function PersonView({ id }: { id: string }) {
  const people = usePeople();
  const projects = useProjects();
  const person = people.data?.find((candidate) => candidate.id === id);

  if (person) return <PersonPage person={person} projects={projects.data ?? []} />;
  if (people.data) {
    return (
      <Page title="Personne introuvable" back={BACK}>
        <EmptyState
          icon={UserX}
          title="Cette personne n'est pas dans la liste"
          text="Le lien suivi est peut-être ancien."
          action={<ButtonLink href="/equipe">Voir l&apos;équipe</ButtonLink>}
        />
      </Page>
    );
  }
  return (
    <Page title="Équipe" back={BACK}>
      <QueryState query={people} loading={<Skeleton className="h-72" />}>
        {() => null}
      </QueryState>
    </Page>
  );
}

const formOf = (person: Person): PersonForm => ({
  name: person.name,
  role: person.role,
  title: person.title ?? "",
  phone: person.phone ?? "",
  email: person.email ?? "",
  projectIds: person.projectIds,
});

const sameForm = (a: PersonForm, b: PersonForm) =>
  a.name.trim() === b.name.trim() &&
  a.role === b.role &&
  a.title.trim() === b.title.trim() &&
  a.phone.trim() === b.phone.trim() &&
  a.email.trim() === b.email.trim() &&
  // The office is on every project: its list is neither shown nor sent.
  (a.role === "admin" ||
    (a.projectIds.length === b.projectIds.length &&
      a.projectIds.every((projectId) => b.projectIds.includes(projectId))));

function PersonPage({ person, projects }: { person: Person; projects: ProjectSummary[] }) {
  const me = useCurrentUser();
  const [form, setForm] = useState(() => formOf(person));
  const [link, setLink] = useState<InviteLink | null>(null);
  const self = person.id === me.id;
  const first = firstName(person.name);
  const path = `/api/users/${person.id}`;

  /** The list shows the change at once; the server's version follows. */
  const applied = (change: Partial<Person>) => {
    queryClient.setQueryData<Person[]>(adminKeys.people, (list) =>
      list?.map((other) => (other.id === person.id ? { ...other, ...change } : other)),
    );
    return Promise.all([
      refreshPeople(),
      queryClient.invalidateQueries({ queryKey: adminKeys.devices(person.id) }),
      self ? queryClient.invalidateQueries({ queryKey: keys.me }) : null,
    ]);
  };

  const save = useMutation({
    mutationFn: () => api(path, { method: "PATCH", body: personBody(form) }),
    onSuccess: () => {
      toast.success("Fiche enregistrée");
      return applied({
        name: form.name.trim(),
        role: form.role,
        title: form.title.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        ...(form.role === "admin" ? {} : { projectIds: form.projectIds }),
      });
    },
  });
  const change = useMutation({
    mutationFn: (body: { unreviewed: false } | { active: boolean }) =>
      api(path, { method: "PATCH", body }),
    onSuccess: (_, body) => {
      if ("unreviewed" in body) toast.success("Personne vérifiée");
      else if (body.active) toast.success("Accès réactivé. Envoyez-lui un nouveau lien.");
      else toast.success("Accès désactivé. Ses appareils sont déconnectés.");
      return applied("active" in body && !body.active ? { ...body, deviceCount: 0 } : body);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const invite = useMutation({
    mutationFn: () => api<InviteLink>(`${path}/invite`, { method: "POST" }),
    onSuccess: setLink,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (form.role === "admin" && person.role !== "admin") {
      const ok = await confirmAction({
        title: `Donner à ${first} l'accès du bureau?`,
        text: "Cette personne verra tous les projets et pourra gérer les personnes, comme vous.",
        confirmLabel: "Donner l'accès",
      });
      if (!ok) return;
    }
    save.mutate();
  };
  const deactivate = async () => {
    const ok = await confirmAction({
      title: `Désactiver l'accès de ${first}?`,
      text: "Ses appareils seront déconnectés sur-le-champ et ses liens cesseront de fonctionner. Sa fiche reste, et vous pourrez réactiver son accès.",
      confirmLabel: "Désactiver l'accès",
      danger: true,
    });
    if (ok) change.mutate({ active: false });
  };

  const tel = person.phone ? telHref(person.phone) : null;
  const pending = change.isPending ? change.variables : null;
  return (
    <Page
      title={person.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <Badge tone="blue">{ROLE_LABELS[person.role]}</Badge>
          {person.active ? null : <Badge>Accès désactivé</Badge>}
          {person.title ? <span>{person.title}</span> : null}
          <span>{lastSeenText(person.lastSeenAt)}</span>
          {tel && person.phone ? (
            <a
              href={tel}
              // A thumb-sized target around a line of text.
              className="text-ead-dark -my-3 inline-block py-3 font-semibold underline-offset-2 hover:underline"
            >
              {formatPhone(person.phone)}
            </a>
          ) : null}
        </span>
      }
      back={BACK}
    >
      {person.unreviewed && person.active ? (
        <div className="bg-warn-tint mb-5 flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center">
          <p className="text-warn flex flex-1 items-start gap-2.5 text-[15px] text-pretty">
            <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>
              <strong className="font-semibold">
                {first} a utilisé le code QR d&apos;un chantier pour entrer.
              </strong>{" "}
              Vous connaissez cette personne? Confirmez-le. Sinon, désactivez son accès.
            </span>
          </p>
          <Button
            onClick={() => change.mutate({ unreviewed: false })}
            loading={pending !== null && "unreviewed" in pending}
          >
            <ShieldCheck aria-hidden /> Je connais cette personne
          </Button>
        </div>
      ) : null}
      {person.active ? null : (
        <div className="border-line bg-surface mb-5 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center">
          <p className="flex-1 text-[15px] text-pretty">
            <strong className="font-semibold">L&apos;accès de {first} est désactivé.</strong> Cette
            personne ne peut plus ouvrir l&apos;application. Sa fiche est conservée.
          </p>
          <Button
            onClick={() => change.mutate({ active: true })}
            loading={pending !== null && "active" in pending}
          >
            <UserRoundCheck aria-hidden /> Réactiver l&apos;accès
          </Button>
        </div>
      )}

      <div className="grid gap-x-8 gap-y-8 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start">
        <form onSubmit={submit} className="space-y-4">
          <Card className="p-4 sm:p-5">
            <PersonFields
              form={form}
              onChange={setForm}
              projects={projects}
              roleLocked={
                self
                  ? "C'est votre compte. Pour changer votre rôle, demandez à une autre personne du bureau."
                  : undefined
              }
            />
          </Card>
          <ShownError error={save.error} />
          <Button
            type="submit"
            size="lg"
            block
            disabled={sameForm(form, formOf(person))}
            loading={save.isPending}
          >
            Enregistrer
          </Button>
        </form>

        <div>
          <Section title="Lien d'invitation">
            <Card className="p-4">
              <p className="text-dim text-[15px] text-pretty">
                {person.active
                  ? "Pour un nouveau téléphone ou un lien expiré. Un nouveau lien remplace celui qui n'a pas encore servi."
                  : "Réactivez l'accès de cette personne pour lui envoyer un lien."}
              </p>
              <Button
                variant="secondary"
                block
                className="mt-3"
                onClick={() => invite.mutate()}
                loading={invite.isPending}
                disabled={!person.active}
              >
                <Link2 aria-hidden /> Créer un nouveau lien
              </Button>
            </Card>
          </Section>

          <Section title="Appareils connectés">
            <Card className="p-4">
              <DeviceList
                userId={person.id}
                empty={
                  person.active
                    ? "Aucun appareil pour l'instant. Cette personne entre en ouvrant son lien, ou avec le code QR d'un chantier."
                    : "Aucun appareil connecté."
                }
              />
            </Card>
          </Section>

          {person.active ? (
            <Section title="Accès">
              <Card className="p-4">
                <p className="text-dim text-[15px] text-pretty">
                  {self
                    ? "C'est votre compte. Pour le désactiver, demandez à une autre personne du bureau."
                    : `${first} ne travaille plus avec vous? Coupez son accès. Ses appareils sont déconnectés sur-le-champ.`}
                </p>
                {self ? null : (
                  <Button
                    variant="secondary"
                    block
                    className="text-bad mt-3"
                    onClick={deactivate}
                    loading={pending !== null && "active" in pending}
                  >
                    <UserRoundX aria-hidden /> Désactiver l&apos;accès
                  </Button>
                )}
              </Card>
            </Section>
          ) : null}
        </div>
      </div>

      <Sheet
        open={link !== null}
        onClose={() => setLink(null)}
        title={`Nouveau lien pour ${first}`}
        description="Envoyez-le maintenant. Il ne s'affichera plus ensuite."
        footer={<Button onClick={() => setLink(null)}>Terminé</Button>}
      >
        {link ? (
          <InviteLinkPanel
            link={link}
            person={{ name: person.name, phone: person.phone, email: person.email }}
          />
        ) : null}
      </Sheet>
    </Page>
  );
}
