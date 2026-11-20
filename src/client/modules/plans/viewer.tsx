import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileQuestion, History, Hourglass } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useParams, useSearch } from "wouter";

import type { Plans, SheetDetail, SheetRevision } from "@/shared/plans";

import { api, ApiFailure } from "../../lib/api";
import { navigate } from "../../lib/location";
import { useOnline } from "../../lib/online";
import { keys, useCurrentProject } from "../../lib/session";
import { Button, EmptyState, ErrorState, Spinner } from "../../ui";
import { arrivedFromAnotherScreen, canStepBack } from "./viewer/back";
import { PlanCanvas, type PlanCanvasHandle, type TileState, type ZoomRoom } from "./viewer/canvas";
import {
  Controls,
  Message,
  messageCard,
  ReplacedBanner,
  TileNotice,
  TopBar,
} from "./viewer/chrome";
import type { Margins } from "./viewer/geometry";
import { keyCommand } from "./viewer/keys";
import { failureOf } from "./viewer/network";
import { preloadRevision } from "./viewer/preload";
import { RevisionsSheet } from "./viewer/revisions";
import { neighbourRevisions, resolveSheetView } from "./viewer/sheet-view";
import { useWakeLock } from "./viewer/use-wake-lock";

// A plan sheet, full screen: /projets/:projectId/feuilles/:sheetId, with
// ?rev=<revisionId> for an earlier revision. The screen the app is opened
// for: a sheet tapped in the list is on screen at once (its thumbnail, then
// sharp tiles) and is moved with two fingers as in a map app.

// Both are held for as long as the app is open. The sheets fetched ahead have
// no screen holding on to them, and the app's usual lifetime for unused data
// (a month) is more than a browser timer can count: it runs out at once.
const sheetQuery = (projectId: string, sheetId: string) =>
  queryOptions({
    queryKey: keys.sheet(projectId, sheetId),
    queryFn: ({ signal }) => api<SheetDetail>(`/api/sheets/${sheetId}`, { signal }),
    gcTime: Infinity,
  });

const plansQuery = (projectId: string) =>
  queryOptions({
    queryKey: keys.plans(projectId),
    queryFn: ({ signal }) => api<Plans>(`/api/projects/${projectId}/plans`, { signal }),
    gcTime: Infinity,
  });

/** Dark grey behind the sheet, so that the white edges of the paper show. */
const backdrop = "bg-neutral-800";
/** A little of that grey stays visible around a sheet shown whole. */
const AIR = 8;

const noSafeArea: Margins = { top: 0, right: 0, bottom: 0, left: 0 };

export function SheetViewerScreen() {
  const project = useCurrentProject();
  const { sheetId } = useParams<{ sheetId: string }>();
  const revisionId = new URLSearchParams(useSearch()).get("rev");
  const queryClient = useQueryClient();
  const online = useOnline();

  const detail = useQuery({
    ...sheetQuery(project.id, sheetId),
    // A sheet still being prepared: look again until its plan is ready.
    refetchInterval: (query) => (query.state.data && !query.state.data.current ? 5000 : false),
  });
  const plans = useQuery(plansQuery(project.id));
  const view = useMemo(
    () => resolveSheetView({ sheetId, revisionId, detail: detail.data, plans: plans.data }),
    [sheetId, revisionId, detail.data, plans.data],
  );
  // The server's word that the sheet is gone or closed to this person counts
  // for more than a list kept on the device.
  const refused = detail.error instanceof ApiFailure && [403, 404].includes(detail.error.status);
  const shown = refused ? null : (view?.shown ?? null);
  const failure = failureOf(detail);

  const canvasRef = useRef<PlanCanvasHandle>(null);
  const [bars, setBars] = useState(true);
  const [quarterTurns, setQuarterTurns] = useState(0);
  const [zoomRoom, setZoomRoom] = useState<ZoomRoom>({ in: true, out: false });
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [tileReport, setTileReport] = useState<{ of: string; state: TileState } | null>(null);
  const tiles: TileState = shown && tileReport?.of === shown.id ? tileReport.state : "loading";
  // Without a plan to look at there is nothing for the bars to get out of the
  // way of, and a tap on the empty screen must not take the way back with it.
  const noPlan = !shown || tiles === "missing";
  const barsVisible = bars || noPlan;

  useWakeLock(shown !== null);

  // --- Getting around -------------------------------------------------------

  const plansPath = `/projets/${project.id}/plans`;
  const sheetPath = `/projets/${project.id}/feuilles`;
  const [arrivedInApp] = useState(arrivedFromAnotherScreen);

  const back = () => {
    if (canStepBack(arrivedInApp)) window.history.back();
    else navigate(plansPath, { replace: true });
  };
  // Sheets and revisions take each other's place in history: the back button
  // of the phone leaves the viewer in one press, however many were looked at.
  const openSheet = (id: string | null | undefined) => {
    if (id) navigate(`${sheetPath}/${id}`, { replace: true });
  };
  const openRevision = (revision: SheetRevision | null) => {
    setRevisionsOpen(false);
    const current = !revision || revision.id === view?.current?.id;
    navigate(`${sheetPath}/${sheetId}${current ? "" : `?rev=${encodeURIComponent(revision.id)}`}`, {
      replace: true,
    });
  };

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const typing =
      event.target instanceof HTMLElement &&
      (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
    // A window over the screen (the revisions) has the keyboard to itself.
    if (event.defaultPrevented || typing || document.querySelector("dialog[open]")) return;
    const command = keyCommand(event);
    if (!command) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    switch (command) {
      case "zoom-in":
        return canvas?.zoomIn();
      case "zoom-out":
        return canvas?.zoomOut();
      case "fit":
        return canvas?.fit();
      case "rotate":
        return setQuarterTurns((turns) => turns + 1);
      case "pan-left":
        return canvas?.pan(-1, 0);
      case "pan-right":
        return canvas?.pan(1, 0);
      case "pan-up":
        return canvas?.pan(0, -1);
      case "pan-down":
        return canvas?.pan(0, 1);
      case "next":
        return openSheet(view?.nextId);
      case "previous":
        return openSheet(view?.previousId);
      case "back":
        return back();
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // --- The sheets on either side --------------------------------------------

  // Fetched ahead once the sheet on screen is sharp, so they never slow it down.
  const sharp = tiles === "sharp";
  useEffect(() => {
    if (!sharp || !view) return;
    for (const revision of neighbourRevisions(view, plans.data)) preloadRevision(revision);
    for (const id of [view.nextId, view.previousId]) {
      if (!id) continue;
      queryClient.fetchQuery(sheetQuery(project.id, id)).then(
        (sheet) => {
          if (sheet.current) preloadRevision(sheet.current);
        },
        () => {
          // No network, or the sheet is gone: it will say so when opened.
        },
      );
    }
  }, [sharp, view, plans.data, project.id, queryClient]);

  // The network is back: ask again for the tiles that could not be fetched.
  useEffect(() => {
    if (online) canvasRef.current?.retry();
  }, [online]);

  // --- Room for the sheet ---------------------------------------------------

  // The sheet is shown whole in the room the bars leave, and may be slid
  // until any of its edges clears them. The viewer needs that room in pixels.
  const rootRef = useRef<HTMLDivElement>(null);
  const safeRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState({ top: 0, banner: 0, controls: 0, safe: noSafeArea });

  const measure = useEffectEvent(() => {
    const root = rootRef.current;
    const safeBox = safeRef.current;
    if (!root || !safeBox) return;
    const safe = {
      top: safeBox.offsetTop,
      left: safeBox.offsetLeft,
      right: root.clientWidth - safeBox.offsetLeft - safeBox.offsetWidth,
      bottom: root.clientHeight - safeBox.offsetTop - safeBox.offsetHeight,
    };
    const next = {
      top: topRef.current?.offsetHeight ?? 0,
      banner: bannerRef.current?.offsetHeight ?? 0,
      controls: controlsRef.current?.offsetHeight ?? 0,
      safe,
    };
    setSizes((was) =>
      was.top === next.top &&
      was.banner === next.banner &&
      was.controls === next.controls &&
      (Object.keys(safe) as (keyof Margins)[]).every((side) => was.safe[side] === safe[side])
        ? was
        : next,
    );
  });
  // Measured before the first paint, so the thumbnail is drawn in place at
  // once; again whenever the banner comes or goes, or the screen changes.
  const replaced = Boolean(shown && view?.replaced);
  const hasControls = view !== null && !refused;
  useLayoutEffect(() => {
    measure();
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    return () => observer.disconnect();
  }, [replaced, hasControls, shown?.id]);

  const topInset = barsVisible ? sizes.top : sizes.safe.top;
  const bottomInset = barsVisible ? sizes.controls : sizes.safe.bottom;
  const room: Margins = {
    top: topInset + sizes.banner + AIR,
    right: sizes.safe.right + AIR,
    bottom: bottomInset + AIR,
    left: sizes.safe.left + AIR,
  };
  // OpenSeadragon turns its drawing about the middle of the screen but
  // reckons positions about the middle of the room. For a sheet that has been
  // turned the two only agree when the room is centred, so facing margins
  // then both take the larger of the two.
  const above = Math.max(room.top, room.bottom);
  const beside = Math.max(room.left, room.right);
  const margins: Margins =
    quarterTurns % 4 === 0 ? room : { top: above, right: beside, bottom: above, left: beside };

  // --- What fills the screen ------------------------------------------------

  let body: ReactNode;
  if (refused) {
    body = (
      <Message>
        <EmptyState
          icon={FileQuestion}
          title="Feuille introuvable"
          text="Cette feuille a été retirée, ou vous n'y avez pas accès."
          action={<Button onClick={back}>Retour aux plans</Button>}
          className={messageCard}
        />
      </Message>
    );
  } else if (shown) {
    body = (
      <PlanCanvas
        ref={canvasRef}
        label={[view?.number, view?.title].filter(Boolean).join(", ")}
        revision={shown}
        margins={margins}
        quarterTurns={quarterTurns}
        onTap={() => {
          if (!noPlan) setBars((visible) => !visible);
        }}
        onTileState={(state) => setTileReport({ of: shown.id, state })}
        onZoomRoom={setZoomRoom}
      />
    );
  } else if (view?.gap === "unrendered") {
    body = (
      <Message>
        <EmptyState
          icon={Hourglass}
          title="Plan en préparation"
          text="Cette feuille n'est pas encore prête. Elle s'affichera ici d'elle-même dans un instant."
          className={messageCard}
        />
      </Message>
    );
  } else if (view?.gap === "unknown-revision") {
    body = (
      <Message>
        <EmptyState
          icon={History}
          title="Révision introuvable"
          text="Cette révision a été retirée de la feuille."
          action={<Button onClick={() => openRevision(null)}>Voir la révision en vigueur</Button>}
          className={messageCard}
        />
      </Message>
    );
  } else if (failure) {
    // Nothing on the device for this address, and no way to fetch it now.
    body = (
      <Message>
        <ErrorState
          error={failure}
          onRetry={() => {
            void detail.refetch();
            void plans.refetch();
          }}
          className={messageCard}
        />
        {view?.gap === "awaiting-revisions" ? (
          <Button variant="secondary" block className="mt-3" onClick={() => openRevision(null)}>
            Voir la révision en vigueur
          </Button>
        ) : null}
      </Message>
    );
  } else {
    body = (
      <div className="absolute inset-0 grid place-items-center">
        <Spinner className="size-9" label="Chargement du plan" />
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      data-tiles={shown ? tiles : undefined}
      className={`${backdrop} fixed inset-0 z-40 overflow-hidden text-white select-none`}
    >
      {/* The part of the screen clear of the notch and the home indicator. */}
      <div
        ref={safeRef}
        aria-hidden
        className="pointer-events-none invisible absolute top-[env(safe-area-inset-top)] right-[env(safe-area-inset-right)] bottom-[env(safe-area-inset-bottom)] left-[env(safe-area-inset-left)]"
      />
      {body}
      <TopBar
        ref={topRef}
        visible={barsVisible}
        view={refused ? null : view}
        onBack={back}
        onRevisions={() => setRevisionsOpen(true)}
      />
      {view && replaced ? (
        <ReplacedBanner
          ref={bannerRef}
          offset={topInset}
          view={view}
          onShowCurrent={() => openRevision(null)}
        />
      ) : null}
      {/* Missing details are not worth covering the plan once the bars are sent away. */}
      {shown && (tiles === "missing" || (tiles === "partial" && barsVisible)) ? (
        <TileNotice
          offset={bottomInset + 12}
          missing={tiles === "missing"}
          online={online}
          onRetry={() => canvasRef.current?.retry()}
        />
      ) : null}
      {view && hasControls ? (
        <Controls
          ref={controlsRef}
          visible={barsVisible}
          view={view}
          zoom={shown ? zoomRoom : null}
          onPrevious={() => openSheet(view.previousId)}
          onNext={() => openSheet(view.nextId)}
          onZoomIn={() => canvasRef.current?.zoomIn()}
          onZoomOut={() => canvasRef.current?.zoomOut()}
          onFit={() => canvasRef.current?.fit()}
          onRotate={() => setQuarterTurns((turns) => turns + 1)}
        />
      ) : null}
      {view ? (
        <RevisionsSheet
          open={revisionsOpen}
          onClose={() => setRevisionsOpen(false)}
          view={view}
          detail={detail}
          onPick={openRevision}
        />
      ) : null}
    </div>
  );
}
