import { ClipboardList } from "lucide-react";

import { useCurrentProject } from "../../lib/session";
import { Page } from "../../shell/page";
import { ButtonLink, EmptyState } from "../../ui";
import { reportsPath } from "./data";

/** A report that was removed, or an address that leads to none. */
export function ReportMissing() {
  const project = useCurrentProject();
  const list = reportsPath(project.id);
  return (
    <Page title="Rapport introuvable" back={{ href: list, label: "Rapports" }}>
      <EmptyState
        icon={ClipboardList}
        title="Ce rapport n'existe plus"
        text="Il a peut-être été supprimé. Les autres rapports du projet sont dans la liste."
        action={<ButtonLink href={list}>Voir les rapports</ButtonLink>}
      />
    </Page>
  );
}
