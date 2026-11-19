import { Route, Switch } from "wouter";

import { useCurrentProject } from "../../lib/session";
import { Page } from "../../shell/page";
import { ButtonLink } from "../../ui";
import { EditReportScreen, NewReportScreen } from "./editor";
import { ReportListScreen } from "./list";
import { ReportMissing } from "./missing";
import { ReportScreen } from "./view";

/** Every address under this module's part of a project. */
export default function RapportsRoutes() {
  const project = useCurrentProject();
  // Workers have no tab leading here; an address typed by hand gets an answer.
  if (!project.canManage) {
    return (
      <Page title="Rapports">
        <p className="text-dim max-w-prose">
          Les rapports journaliers sont réservés aux contremaîtres et au bureau.
        </p>
        <div className="mt-5">
          <ButtonLink href={`/projets/${project.id}`}>Retour au projet</ButtonLink>
        </div>
      </Page>
    );
  }
  const base = "/projets/:projectId/rapports";
  return (
    <Switch>
      <Route path={base} component={ReportListScreen} />
      <Route path={`${base}/nouveau`} component={NewReportScreen} />
      <Route path={`${base}/:reportId/modifier`} component={EditReportScreen} />
      <Route path={`${base}/:reportId`} component={ReportScreen} />
      <Route component={ReportMissing} />
    </Switch>
  );
}
