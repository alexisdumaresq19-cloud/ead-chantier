import { Archive } from "lucide-react";

import { useCurrentProject } from "../../lib/session";
import { Page } from "../../shell/page";
import { ButtonLink, EmptyState } from "../../ui";
import { reportsPath } from "./data";

/** Writing or changing a report of an archived project, for anyone but the office. */
export function ReportsArchived({ reportId }: { reportId?: string }) {
  const project = useCurrentProject();
  const list = reportsPath(project.id);
  const back = reportId ? `${list}/${reportId}` : list;
  return (
    <Page title="Projet archivé" back={{ href: back, label: reportId ? "Rapport" : "Rapports" }}>
      <EmptyState
        icon={Archive}
        title="Les rapports ne se modifient plus"
        text={
          "Ce projet est archivé\u00a0: ses rapports se lisent et s'impriment. Pour un changement, adressez-vous au bureau."
        }
        action={
          <ButtonLink href={back}>{reportId ? "Voir le rapport" : "Voir les rapports"}</ButtonLink>
        }
      />
    </Page>
  );
}
