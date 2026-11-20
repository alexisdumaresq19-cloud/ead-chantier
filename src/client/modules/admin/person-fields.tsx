import type { ProjectSummary } from "@/shared/api";
import { ROLE_LABELS, type Role } from "@/shared/roles";

import { Field, Input, Select } from "../../ui";
import { ProjectPicker } from "./project-picker";

// The details the office keeps about someone, as the form to add a person and
// the one to correct them both show them.

export type PersonForm = {
  name: string;
  role: Role;
  title: string;
  phone: string;
  email: string;
  projectIds: string[];
};

export const NEW_PERSON: PersonForm = {
  name: "",
  role: "travailleur",
  title: "",
  phone: "",
  email: "",
  projectIds: [],
};

/** The most common first. */
const ROLE_CHOICES: Role[] = ["travailleur", "contremaitre", "admin"];

const ROLE_HINTS: Record<Role, string> = {
  travailleur: "Voit les plans et les documents de ses projets, et ajoute des photos.",
  contremaitre: "Gère ses projets : plans, documents, rapports journaliers et code QR du chantier.",
  admin: "Voit tous les projets et gère les personnes.",
};

/** What the server receives: the office sees every project, so it is given none. */
export const personBody = (form: PersonForm) => ({
  name: form.name,
  role: form.role,
  title: form.title,
  phone: form.phone,
  email: form.email,
  ...(form.role === "admin" ? {} : { projectIds: form.projectIds }),
});

export function PersonFields({
  form,
  onChange,
  projects,
  roleLocked,
  focusName,
}: {
  form: PersonForm;
  onChange: (form: PersonForm) => void;
  projects: ProjectSummary[];
  /** Why the role cannot be changed here, when it cannot. */
  roleLocked?: string;
  /** The name field takes the focus when the form appears. */
  focusName?: boolean;
}) {
  const set =
    (key: "name" | "title" | "phone" | "email") => (event: { target: { value: string } }) =>
      onChange({ ...form, [key]: event.target.value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Prénom et nom" className="sm:col-span-2">
        <Input
          value={form.name}
          onChange={set("name")}
          required
          minLength={2}
          maxLength={80}
          autoComplete="off"
          autoCapitalize="words"
          // The window focuses data-autofocus when it opens; autoFocus covers
          // a form that comes back inside a window already open.
          data-autofocus={focusName || undefined}
          autoFocus={focusName}
        />
      </Field>
      <Field label="Rôle" hint={roleLocked ?? ROLE_HINTS[form.role]} className="sm:col-span-2">
        <Select
          value={form.role}
          onChange={(event) => onChange({ ...form, role: event.target.value as Role })}
          disabled={Boolean(roleLocked)}
        >
          {ROLE_CHOICES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Titre" optional className="sm:col-span-2">
        <Input
          value={form.title}
          onChange={set("title")}
          placeholder="Opérateur de pelle"
          maxLength={80}
          autoComplete="off"
        />
      </Field>
      <Field label="Cellulaire" optional>
        <Input
          value={form.phone}
          onChange={set("phone")}
          type="tel"
          inputMode="tel"
          placeholder="418 555-0142"
          maxLength={30}
          autoComplete="off"
        />
      </Field>
      <Field label="Courriel" optional>
        <Input
          value={form.email}
          onChange={set("email")}
          type="email"
          inputMode="email"
          maxLength={120}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </Field>
      <div className="sm:col-span-2">
        <p className="mb-1.5 text-sm font-semibold">Projets</p>
        {form.role === "admin" ? (
          <p className="text-dim text-[15px]">Le bureau voit tous les projets.</p>
        ) : (
          <ProjectPicker
            projects={projects}
            value={form.projectIds}
            onChange={(projectIds) => onChange({ ...form, projectIds })}
          />
        )}
      </div>
    </div>
  );
}
