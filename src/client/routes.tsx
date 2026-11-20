import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { Redirect, Route, Router, Switch, useLocation, useParams, useRoute } from "wouter";

import { ApiFailure } from "./lib/api";
import { useAppLocation, useAppSearch } from "./lib/location";
import { MeContext, ProjectContext, useMe, useProject } from "./lib/session";
import { Page } from "./shell/page";
import { PublicLayout } from "./shell/public-layout";
import { Shell } from "./shell/shell";
import { Splash } from "./shell/splash";
import { Skeleton, Spinner } from "./ui/bits";
import { Button, ButtonLink } from "./ui/button";
import { ErrorState } from "./ui/states";

// Every address of the app.
//
//   /bienvenue, /demarrer, /i/:token, /j/:token      before signing in
//   /                                                the projects
//   /projets/nouveau, /equipe, /moi                  office and account
//   /projets/:projectId                              a project's home
//   /projets/:projectId/plans/…  documents/…  photos/…  rapports/…
//                                                    one module each: the
//                                                    module's routes.tsx owns
//                                                    every address under it
//   /projets/:projectId/equipe, /reglages            managing the project
//   /projets/:projectId/feuilles/:sheetId            a plan sheet, full screen
//
// Screens are loaded when first opened, then kept.

const loaders = {
  auth: () => import("./modules/auth"),
  projects: () => import("./modules/projects"),
  plans: () => import("./modules/plans/routes"),
  viewer: () => import("./modules/plans/viewer"),
  documents: () => import("./modules/documents/routes"),
  photos: () => import("./modules/photos/routes"),
  reports: () => import("./modules/reports/routes"),
  admin: () => import("./modules/admin"),
};

/** Downloads every screen, so that all of them open without a network. */
export function preloadScreens() {
  return Promise.allSettled(Object.values(loaders).map((load) => load()));
}

function screen<Module, Name extends keyof Module>(load: () => Promise<Module>, name: Name) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }));
}

const WelcomeScreen = screen(loaders.auth, "WelcomeScreen");
const SetupScreen = screen(loaders.auth, "SetupScreen");
const InviteScreen = screen(loaders.auth, "InviteScreen");
const ProjectsScreen = screen(loaders.projects, "ProjectsScreen");
const ProjectHomeScreen = screen(loaders.projects, "ProjectHomeScreen");
const PlansRoutes = screen(loaders.plans, "default");
const SheetViewerScreen = screen(loaders.viewer, "SheetViewerScreen");
const DocumentsRoutes = screen(loaders.documents, "default");
const PhotosRoutes = screen(loaders.photos, "default");
const ReportsRoutes = screen(loaders.reports, "default");
const NewProjectScreen = screen(loaders.admin, "NewProjectScreen");
const ProjectSettingsScreen = screen(loaders.admin, "ProjectSettingsScreen");
const ProjectTeamScreen = screen(loaders.admin, "ProjectTeamScreen");
const TeamScreen = screen(loaders.admin, "TeamScreen");
const AccountScreen = screen(loaders.admin, "AccountScreen");

export function AppRoutes() {
  return (
    <Router hook={useAppLocation} searchHook={useAppSearch}>
      <Screens />
    </Router>
  );
}

function Screens() {
  useScrollToTopOnNavigation();
  return (
    <Suspense fallback={<Splash />}>
      <Switch>
        <Route path="/bienvenue" component={WelcomeScreen} />
        <Route path="/demarrer" component={SetupScreen} />
        <Route path="/i/:token" component={InviteScreen} />
        <Route path="/j/:token" component={InviteScreen} />
        <Route component={SignedIn} />
      </Switch>
    </Suspense>
  );
}

/** Everything below needs a signed-in person. */
function SignedIn() {
  const me = useMe();
  if (me.data === undefined) {
    if (!me.isError) return <Splash />;
    return (
      <PublicLayout>
        <ErrorState
          error={me.error}
          onRetry={() => me.refetch()}
          className="border-0 bg-transparent p-0"
        />
      </PublicLayout>
    );
  }
  if (me.data === null) return <Redirect to="/bienvenue" replace />;
  return (
    <MeContext.Provider value={me.data}>
      <Switch>
        <Route path="/projets/nouveau">
          <Framed>
            <NewProjectScreen />
          </Framed>
        </Route>
        <Route path="/projets/:projectId/*?" component={ProjectArea} />
        <Route path="/equipe">
          <Framed>
            <TeamScreen />
          </Framed>
        </Route>
        <Route path="/moi">
          <Framed>
            <AccountScreen />
          </Framed>
        </Route>
        <Route path="/">
          <Framed>
            <ProjectsScreen />
          </Framed>
        </Route>
        <Route>
          <Framed>
            <NotFound />
          </Framed>
        </Route>
      </Switch>
    </MeContext.Provider>
  );
}

function Framed({ children }: { children: React.ReactNode }) {
  return (
    <Shell>
      <Suspense fallback={<PageLoading />}>{children}</Suspense>
    </Shell>
  );
}

/** A project's screens: the project is loaded once, here, for all of them. */
function ProjectArea() {
  const { projectId } = useParams<{ projectId: string }>();
  const project = useProject(projectId);
  const [fullScreen] = useRoute("/projets/:projectId/feuilles/:sheetId");
  const waiting = fullScreen ? <Splash /> : <PageLoading />;

  let content: React.ReactNode;
  if (project.data !== undefined) {
    const base = "/projets/:projectId";
    content = (
      <Suspense fallback={waiting}>
        <Switch>
          <Route path={base} component={ProjectHomeScreen} />
          <Route path={`${base}/plans/*?`} component={PlansRoutes} />
          <Route path={`${base}/feuilles/:sheetId`} component={SheetViewerScreen} />
          <Route path={`${base}/documents/*?`} component={DocumentsRoutes} />
          <Route path={`${base}/photos/*?`} component={PhotosRoutes} />
          <Route path={`${base}/rapports/*?`} component={ReportsRoutes} />
          <Route path={`${base}/equipe`} component={ProjectTeamScreen} />
          <Route path={`${base}/reglages`} component={ProjectSettingsScreen} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    );
  } else if (!project.isError) {
    content = waiting;
  } else {
    const missing =
      project.error instanceof ApiFailure && [403, 404].includes(project.error.status);
    content = (
      <Page
        title={missing ? "Projet introuvable" : "Projet"}
        back={{ href: "/", label: "Projets" }}
      >
        {missing ? (
          <p className="text-dim max-w-prose">
            Ce projet n&apos;existe pas, ou vous n&apos;y avez pas accès. Demandez à votre
            contremaître de vous y ajouter.
          </p>
        ) : (
          <ErrorState error={project.error} onRetry={() => project.refetch()} />
        )}
      </Page>
    );
  }

  // A sheet fills the screen; everything else sits in the frame, which stays
  // in place while the project loads.
  if (fullScreen && (project.data !== undefined || !project.isError)) {
    return (
      <ProjectContext.Provider value={project.data ?? null}>{content}</ProjectContext.Provider>
    );
  }
  return (
    <ProjectContext.Provider value={project.data ?? null}>
      <Shell project={project.data}>{content}</Shell>
    </ProjectContext.Provider>
  );
}

function PageLoading() {
  return (
    <div
      className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6 lg:px-10 lg:pt-10"
      role="status"
      aria-label="Chargement"
    >
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-6 h-28" />
      <Skeleton className="mt-3 h-28" />
      <span className="sr-only">
        <Spinner />
      </span>
    </div>
  );
}

export function NotFound() {
  return (
    <Page title="Page introuvable">
      <p className="text-dim max-w-prose">
        Cette adresse ne mène nulle part dans l&apos;application.
      </p>
      <div className="mt-5 flex gap-2">
        <ButtonLink href="/">Voir les projets</ButtonLink>
        <Button variant="secondary" onClick={() => window.history.back()}>
          Revenir en arrière
        </Button>
      </div>
    </Page>
  );
}

/** A new screen starts at its top; going back keeps where the person was. */
function useScrollToTopOnNavigation() {
  const [path] = useLocation();
  useEffect(() => {
    // Going back within the same screen (a closed photo, a closed person)
    // changes no path: it must not count against the next real navigation.
    const onPop = () => {
      goingBack = window.location.pathname !== shownPath;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (!goingBack) window.scrollTo(0, 0);
    goingBack = false;
    shownPath = path;
  }, [path]);
}
let goingBack = false;
let shownPath = "";
