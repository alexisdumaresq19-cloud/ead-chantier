import { Redirect, Route, Switch, useParams } from "wouter";

import { AddDocumentsScreen } from "./add";
import { DocumentsScreen } from "./list";

/** Every address under this module's part of a project. */
export default function DocumentsRoutes() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <Switch>
      <Route path="/projets/:projectId/documents" component={DocumentsScreen} />
      <Route path="/projets/:projectId/documents/ajouter" component={AddDocumentsScreen} />
      {/* An address that no longer exists: the list is the way back in. */}
      <Route>
        <Redirect to={`/projets/${projectId}/documents`} replace />
      </Route>
    </Switch>
  );
}
