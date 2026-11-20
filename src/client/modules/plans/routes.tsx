import { Route, Switch } from "wouter";

import { useCurrentProject } from "../../lib/session";
import { Page } from "../../shell/page";
import { ButtonLink } from "../../ui";
import { planPaths } from "./data";
import { ImportScreen } from "./import";
import { PlansScreen } from "./list";

/** Every address under this module's part of a project. */
export default function PlansRoutes() {
  return (
    <Switch>
      <Route path="/projets/:projectId/plans" component={PlansScreen} />
      <Route path="/projets/:projectId/plans/import/:importId" component={ImportScreen} />
      <Route component={NoSuchPage} />
    </Switch>
  );
}

function NoSuchPage() {
  const project = useCurrentProject();
  return (
    <Page title="Page introuvable">
      <p className="text-dim max-w-prose">Cette adresse ne mène à aucun plan.</p>
      <div className="mt-5">
        <ButtonLink href={planPaths.list(project.id)}>Voir les plans</ButtonLink>
      </div>
    </Page>
  );
}
