import type { ProjectDetail } from "@/shared/api";

/** On a project's home: keeping the project on the device for the site. */
export function OfflineProject({ project }: { project: ProjectDetail }) {
  void project;
  return null;
}
