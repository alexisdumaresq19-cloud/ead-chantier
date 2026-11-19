import { Route, Switch, useParams } from "wouter";

import { isDay } from "@/shared/photos";

import { NotFound } from "../../routes";
import { GalleryScreen } from "./gallery";

// Every address under this module's part of a project:
//
//   /projets/:projectId/photos                 the gallery, by day
//   /projets/:projectId/photos/jour/:day       one day's photos
//
// A photo opened in large is the same address with ?photo=<id>.

function DayGallery() {
  const { day } = useParams<{ day: string }>();
  return isDay(day) ? <GalleryScreen key={day} day={day} /> : <NotFound />;
}

export default function PhotosRoutes() {
  return (
    <Switch>
      <Route path="/projets/:projectId/photos">
        <GalleryScreen day={null} />
      </Route>
      <Route path="/projets/:projectId/photos/jour/:day" component={DayGallery} />
      <Route component={NotFound} />
    </Switch>
  );
}
