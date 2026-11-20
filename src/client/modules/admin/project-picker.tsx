import type { ProjectSummary } from "@/shared/api";

import { cn } from "../../lib/cn";

/** A row to tick, tall enough for a thumb. */
export function CheckRow({
  checked,
  onChange,
  title,
  detail,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  detail?: string | null;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "hover:bg-canvas flex min-h-12 cursor-pointer items-center gap-3 px-3.5 py-2 transition-colors",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-ead-dark size-5 shrink-0"
      />
      <span className="min-w-0">
        <span className="block leading-snug font-medium wrap-anywhere">{title}</span>
        {detail ? <span className="text-dim block text-sm wrap-anywhere">{detail}</span> : null}
      </span>
    </label>
  );
}

/**
 * The projects someone is on, to tick. Archived projects only show when the
 * person is on them, so that they can be taken off.
 */
export function ProjectPicker({
  projects,
  value,
  onChange,
}: {
  projects: ProjectSummary[];
  value: string[];
  onChange: (projectIds: string[]) => void;
}) {
  const listed = projects.filter(
    (project) => project.status === "actif" || value.includes(project.id),
  );
  if (listed.length === 0) {
    return <p className="text-dim text-[15px]">Aucun projet en cours pour l&apos;instant.</p>;
  }
  return (
    <ul className="divide-line border-line bg-surface max-h-72 divide-y overflow-y-auto overscroll-contain rounded-xl border">
      {listed.map((project) => (
        <li key={project.id}>
          <CheckRow
            checked={value.includes(project.id)}
            onChange={(checked) =>
              onChange(checked ? [...value, project.id] : value.filter((id) => id !== project.id))
            }
            title={project.name}
            detail={[project.number, project.city, project.status === "archive" ? "Archivé" : null]
              .filter(Boolean)
              .join(" · ")}
          />
        </li>
      ))}
    </ul>
  );
}
