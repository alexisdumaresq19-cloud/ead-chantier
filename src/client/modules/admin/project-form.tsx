import { useMutation } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Info } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { ProjectDetail, ProjectSummary } from "@/shared/api";
import { isAdmin } from "@/shared/roles";

import { api, errorMessage } from "../../lib/api";
import { navigate } from "../../lib/location";
import { queryClient } from "../../lib/query";
import { keys, useCurrentProject, useCurrentUser } from "../../lib/session";
import { Page, Section } from "../../shell/page";
import { Badge, Button, Card, confirmAction, Field, Input, Textarea, toast } from "../../ui";
import { OfficeOnly } from "./office-only";
import { ShownError } from "./shown-error";

// Creating a project and correcting it. Only the office writes; everyone on
// the project may read what it holds.

type ProjectForm = {
  number: string;
  name: string;
  client: string;
  address: string;
  city: string;
  description: string;
};

const EMPTY: ProjectForm = {
  number: "",
  name: "",
  client: "",
  address: "",
  city: "",
  description: "",
};

const formOf = (project: ProjectDetail): ProjectForm => ({
  number: project.number ?? "",
  name: project.name,
  client: project.client ?? "",
  address: project.address ?? "",
  city: project.city ?? "",
  description: project.description ?? "",
});

const sameForm = (a: ProjectForm, b: ProjectForm) =>
  (Object.keys(a) as (keyof ProjectForm)[]).every((key) => a[key].trim() === b[key].trim());

function ProjectFields({
  form,
  onChange,
  autoFocus,
}: {
  form: ProjectForm;
  onChange: (form: ProjectForm) => void;
  autoFocus?: boolean;
}) {
  const set = (key: keyof ProjectForm) => (event: { target: { value: string } }) =>
    onChange({ ...form, [key]: event.target.value });
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="Numéro" optional>
        <Input
          value={form.number}
          onChange={set("number")}
          placeholder="24-118"
          maxLength={40}
          autoComplete="off"
          autoCapitalize="characters"
          autoFocus={autoFocus}
        />
      </Field>
      <Field label="Nom du projet" className="sm:col-span-2">
        <Input
          value={form.name}
          onChange={set("name")}
          required
          minLength={2}
          maxLength={120}
          autoComplete="off"
        />
      </Field>
      <Field label="Client" optional className="sm:col-span-3">
        <Input value={form.client} onChange={set("client")} maxLength={120} autoComplete="off" />
      </Field>
      <Field label="Adresse du chantier" optional className="sm:col-span-2">
        <Input value={form.address} onChange={set("address")} maxLength={200} autoComplete="off" />
      </Field>
      <Field label="Ville" optional>
        <Input value={form.city} onChange={set("city")} maxLength={80} autoComplete="off" />
      </Field>
      <Field
        label="Description"
        optional
        hint="Les travaux en une phrase ou deux. Tout le monde sur le projet la voit."
        className="sm:col-span-3"
      >
        <Textarea
          value={form.description}
          onChange={set("description")}
          rows={3}
          maxLength={2000}
        />
      </Field>
    </div>
  );
}

export function NewProjectScreen() {
  const me = useCurrentUser();
  const [form, setForm] = useState(EMPTY);
  const create = useMutation({
    mutationFn: () => api<ProjectSummary>("/api/projects", { method: "POST", body: form }),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: keys.projects, exact: true });
      toast.success("Projet créé");
      // The form is left behind: going back from the project must not offer
      // to create it a second time.
      navigate(`/projets/${project.id}`, { replace: true });
    },
  });
  if (!isAdmin(me.role)) return <OfficeOnly title="Nouveau projet" />;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };
  return (
    <Page
      title="Nouveau projet"
      subtitle="Le nom suffit pour commencer. Le reste se complète plus tard."
      back={{ href: "/", label: "Projets" }}
      narrow
    >
      <form onSubmit={submit} className="space-y-5">
        <Card className="p-4 sm:p-5">
          <ProjectFields form={form} onChange={setForm} autoFocus />
        </Card>
        <ShownError error={create.error} />
        <Button type="submit" size="lg" block loading={create.isPending || create.isSuccess}>
          Créer le projet
        </Button>
      </form>
    </Page>
  );
}

export function ProjectSettingsScreen() {
  const me = useCurrentUser();
  const project = useCurrentProject();
  const back = { href: `/projets/${project.id}`, label: "Accueil du projet" };
  return (
    <Page
      title="Réglages du projet"
      subtitle={project.status === "archive" ? <Badge>Projet archivé</Badge> : undefined}
      back={back}
      narrow
    >
      {isAdmin(me.role) ? (
        // Opening another project starts from that project's details.
        <ProjectEditor key={project.id} project={project} />
      ) : (
        <ProjectFacts project={project} />
      )}
    </Page>
  );
}

function ProjectEditor({ project }: { project: ProjectDetail }) {
  const [form, setForm] = useState(() => formOf(project));
  const archived = project.status === "archive";

  /** What the server answered goes straight to every screen of the project. */
  const store = (saved: ProjectSummary, description: string | null) => {
    queryClient.setQueryData<ProjectDetail>(keys.project(project.id), (current) =>
      current ? { ...current, ...saved, description } : current,
    );
    return queryClient.invalidateQueries({ queryKey: keys.projects, exact: true });
  };

  const save = useMutation({
    mutationFn: () =>
      api<ProjectSummary>(`/api/projects/${project.id}`, { method: "PATCH", body: form }),
    onSuccess: (saved) => {
      const description = form.description.trim() || null;
      setForm(formOf({ ...project, ...saved, description }));
      toast.success("Réglages enregistrés");
      return store(saved, description);
    },
  });
  const setStatus = useMutation({
    mutationFn: (status: ProjectSummary["status"]) =>
      api<ProjectSummary>(`/api/projects/${project.id}`, { method: "PATCH", body: { status } }),
    onSuccess: (saved) => {
      toast.success(saved.status === "archive" ? "Projet archivé" : "Projet rouvert");
      return store(saved, project.description);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  const archive = async () => {
    const ok = await confirmAction({
      title: "Archiver ce projet?",
      text: "Il quittera la liste des projets en cours. Ses plans, ses documents et ses photos resteront lisibles, et vous pourrez le rouvrir.",
      confirmLabel: "Archiver",
    });
    if (ok) setStatus.mutate("archive");
  };
  const reopen = async () => {
    const ok = await confirmAction({
      title: "Rouvrir ce projet?",
      text: "Il reviendra dans la liste des projets en cours.",
      confirmLabel: "Rouvrir",
    });
    if (ok) setStatus.mutate("actif");
  };

  const dirty = !sameForm(form, formOf(project));
  return (
    <>
      <form onSubmit={submit} className="space-y-4">
        <Card className="p-4 sm:p-5">
          <ProjectFields form={form} onChange={setForm} />
        </Card>
        <ShownError error={save.error} />
        <Button type="submit" size="lg" block disabled={!dirty} loading={save.isPending}>
          Enregistrer
        </Button>
      </form>

      <Section title={archived ? "Projet archivé" : "Fin du projet"}>
        <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
          <p className="text-dim flex-1 text-[15px] text-pretty">
            {archived
              ? "Ce projet est hors de la liste des projets en cours. Tout ce qu'il contient reste lisible."
              : "Les travaux sont terminés? Archivez le projet : il quitte la liste des projets en cours et reste lisible."}
          </p>
          {archived ? (
            <Button variant="secondary" onClick={reopen} loading={setStatus.isPending}>
              <ArchiveRestore aria-hidden /> Rouvrir le projet
            </Button>
          ) : (
            <Button variant="secondary" onClick={archive} loading={setStatus.isPending}>
              <Archive aria-hidden /> Archiver le projet
            </Button>
          )}
        </Card>
      </Section>
    </>
  );
}

/** The project's details, to read. */
function ProjectFacts({ project }: { project: ProjectDetail }) {
  const facts: [string, string | null][] = [
    ["Numéro", project.number],
    ["Nom du projet", project.name],
    ["Client", project.client],
    ["Adresse du chantier", project.address],
    ["Ville", project.city],
    ["Description", project.description],
  ];
  return (
    <>
      <p className="bg-ead-tint text-ead-darker mb-4 flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[15px] text-pretty">
        <Info className="mt-0.5 size-5 shrink-0" aria-hidden />
        Le bureau fait les changements. Pour une correction, appelez le bureau.
      </p>
      <Card>
        <dl className="divide-line divide-y">
          {facts.map(([label, value]) => (
            <div key={label} className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-5">
              <dt className="text-dim text-sm font-semibold">{label}</dt>
              <dd className="mt-0.5 text-[15px] break-words whitespace-pre-line sm:col-span-2 sm:mt-0">
                {value ?? <span className="text-dim">Non précisé</span>}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  );
}
