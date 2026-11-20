import OpenSeadragon from "openseadragon";
import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react";

import { tileUrl, type SheetRevision, type Tiles } from "@/shared/plans";

import { Spinner } from "../../../ui";
import {
  fitPlacement,
  placementAlong,
  placementTransform,
  tileTuning,
  type Margins,
} from "./geometry";

// The sheet itself: OpenSeadragon draws the tiles in view and follows the
// fingers. Under its canvas lies the sheet's thumbnail, placed exactly where
// the tiles will be drawn, so a plan is on screen from the first frame and
// the tiles only sharpen it.

/**
 * How far the tiles in view have come:
 *  - "loading": on their way;
 *  - "sharp": all drawn;
 *  - "partial": some could not be fetched, the sheet is drawn from what there is;
 *  - "missing": none could be fetched.
 */
export type TileState = "loading" | "sharp" | "partial" | "missing";

/** Whether the sheet can still be made larger or smaller. */
export type ZoomRoom = { in: boolean; out: boolean };

export type PlanCanvasHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  /** Shows the whole sheet. */
  fit: () => void;
  /** Slides the view by a step: (1, 0) shows what is further right. */
  pan: (right: number, down: number) => void;
  /** Asks again for the tiles that could not be fetched. */
  retry: () => void;
};

// --- Feel -------------------------------------------------------------------
// OpenSeadragon's defaults are tuned for a mouse on a desk: slow, floating
// animations and a click that zooms. These make it behave like a map app.

/** Seconds a movement takes to settle (zoom steps, the glide after a flick). */
const ANIMATION_TIME = 0.9;
/** How front-loaded a movement is: most of it happens in the first quarter second. */
const SPRING_STIFFNESS = 7;
/** A flick carries the sheet this many seconds of finger speed further. */
const FLICK_MOMENTUM = 0.18;
/**
 * Two screen pixels per image pixel at most: lettering 2 mm high on paper is
 * then about 5 mm high on a phone, and nothing is gained by going further.
 */
const MAX_ZOOM_PIXEL_RATIO = 2;
const DOUBLE_TAP_ZOOM = 2.5;
const BUTTON_ZOOM = 1.6;
/** A tap waits this long to be sure it is not the first half of a double tap. */
const DOUBLE_TAP_MS = 300;
/** A weak signal drops requests: a tile is asked for again this many times before giving up. */
const TILE_RETRIES = 2;

/**
 * How the sheet moves. `still` is for someone who asked their device for less
 * motion: the sheet goes straight to where it is sent, without glide or
 * zoom animation.
 */
function movement(still: boolean): OpenSeadragon.Options {
  const gestures: OpenSeadragon.GestureSettings = {
    dragToPan: true,
    // The sheet follows the finger exactly, then glides.
    flickEnabled: !still,
    flickMomentum: FLICK_MOMENTUM,
    // A tap shows or hides the bars; the double tap is handled by the canvas.
    clickToZoom: false,
    dblClickToZoom: false,
    pinchRotate: false,
  };
  return {
    animationTime: still ? 0 : ANIMATION_TIME,
    springStiffness: SPRING_STIFFNESS,
    // New tiles fade in over the blurrier ones.
    blendTime: still ? 0 : 0.12,
    gestureSettingsTouch: { ...gestures, pinchToZoom: true, dblClickDragToZoom: true },
    gestureSettingsPen: { ...gestures, pinchToZoom: true },
    gestureSettingsUnknown: { ...gestures, pinchToZoom: true },
    gestureSettingsMouse: { ...gestures, scrollToZoom: true },
  };
}

const options: OpenSeadragon.Options = {
  // Tiles are fetched as the service worker can keep them: with CORS.
  crossOriginPolicy: "Anonymous",
  // The screen brings its own bars and buttons, and listens to the keyboard
  // itself (OpenSeadragon's keys include a mirror flip, wrong for a plan).
  showNavigationControl: false,
  showNavigator: false,
  showSequenceControl: false,
  keyboardNavEnabled: false,
  tabIndex: -1,
  // There are no OpenSeadragon controls to fade; left on, each finger lifted
  // starts a fading animation that runs on, even after the screen is left.
  autoHideControls: false,

  // The sheet may be dragged past its edge and springs back on release; held
  // at the edge instead, it would lag behind the finger.
  constrainDuringPan: false,
  // Just over 1: no empty space once the sheet is larger than the screen,
  // and a sheet smaller than the screen stays centred (at exactly 1 it could
  // be left anywhere inside). Either way it cannot be lost.
  visibilityRatio: 1.0001,
  // Never smaller than the whole sheet.
  minZoomImageRatio: 1,
  maxZoomPixelRatio: MAX_ZOOM_PIXEL_RATIO,

  // The thumbnail is already the blurry version: fetch the level that suits
  // the screen straight away, not every level below it first.
  immediateRender: true,
  // What a browser opens to one host anyway; beyond it, tiles for a place
  // already left would queue ahead of the ones now in view.
  imageLoaderLimit: 6,
  maxTilesPerFrame: 3,
  tileRetryMax: TILE_RETRIES,
  tileRetryDelay: 1500,
  timeout: 45_000,
  // The tiles overlap by a pixel, so no seam needs the costly smoothing pass.
  smoothTileEdgesMinZoom: Infinity,
};

/** What OpenSeadragon hands a tile source to fetch one tile; its typings do not describe it. */
type TileJob = {
  src: string;
  finish: (image: HTMLImageElement, request: null, dataType: "image") => void;
  fail: (message: string, request: null) => void;
};

/**
 * The sheet's pyramid, as OpenSeadragon asks for it. It fetches its tiles
 * itself, the way OpenSeadragon would, to be able to drop the ones still on
 * their way when the sheet is left: OpenSeadragon lets them finish, and on a
 * weak signal they hold back the tiles of the sheet turned to.
 */
function tileSource(tiles: Tiles) {
  const underWay = new Map<TileJob, HTMLImageElement>();
  let closed = false;

  const stop = (job: TileJob) => {
    const image = underWay.get(job);
    if (!image) return;
    underWay.delete(job);
    image.onload = image.onerror = null;
    // Emptying the address is what makes the browser give up the request.
    image.src = "";
  };
  /**
   * Ends the download of a tile nobody is waiting for. OpenSeadragon cannot be
   * told so (a failure would be logged as an error and tried again): it is
   * handed the emptied image, which it sets aside as it does any tile that
   * arrives for a sheet it has closed.
   */
  const drop = (job: TileJob) => {
    const image = underWay.get(job) ?? new Image();
    stop(job);
    job.finish(image, null, "image");
  };

  return {
    width: tiles.width,
    height: tiles.height,
    tileSize: tiles.tileSize,
    tileOverlap: tiles.overlap,
    minLevel: tiles.minLevel,
    maxLevel: tiles.maxLevel,
    getTileUrl: (level: number, column: number, row: number) => tileUrl(tiles, level, column, row),
    downloadTileStart(job: TileJob) {
      // A tile of a sheet already left, due for another try.
      if (closed) return drop(job);
      const image = new Image();
      const end = () => {
        underWay.delete(job);
        image.onload = image.onerror = null;
      };
      image.onload = () => {
        end();
        job.finish(image, null, "image");
      };
      image.onerror = () => {
        end();
        job.fail("The tile could not be fetched.", null);
      };
      // With CORS, as the service worker needs to keep it.
      image.crossOrigin = "anonymous";
      underWay.set(job, image);
      image.src = job.src;
    },
    /** OpenSeadragon gives up on a tile that takes too long. */
    downloadTileAbort: stop,
    /** OpenSeadragon has closed the sheet: another one is opened, or the screen is left. */
    destroy(viewer: OpenSeadragon.Viewer) {
      closed = true;
      // Those waiting their turn first, or each tile dropped would start one of them.
      viewer.imageLoader.clear();
      for (const job of [...underWay.keys()]) drop(job);
    },
  };
}

const isWhole = (viewport: OpenSeadragon.Viewport) =>
  viewport.getZoom() <= viewport.getHomeZoom() * 1.005;

/**
 * Changes the room kept clear around the sheet without moving what is on
 * screen; a sheet that was shown whole then settles into the new room.
 */
function setMargins(viewer: OpenSeadragon.Viewer, margins: Margins) {
  const viewport = viewer.viewport;
  if (!viewer.isOpen()) {
    viewport.setMargins(margins);
    return;
  }
  const whole = isWhole(viewport);
  const centre = viewport.getContainerSize().divide(2);
  const before = viewport.pointFromPixel(centre, true);
  viewport.setMargins(margins);
  viewport.panBy(before.minus(viewport.pointFromPixel(centre, true)), true);
  if (whole) viewport.goHome();
  else viewport.applyConstraints();
}

// --- The component ----------------------------------------------------------

/** The thumbnail's own width: it is laid out at that size and scaled into place. */
const UNDERLAY_WIDTH = 640;

/** What is on screen for one revision, by the address of its tiles. */
type Progress = {
  url: string;
  thumb: "pending" | "loaded" | "failed";
  /** At least one tile has been drawn. */
  drawn: boolean;
  /** The tiles have covered the sheet once: the thumbnail has done its job. */
  covered: boolean;
  tiles: TileState;
};

const blank = (url: string): Progress => ({
  url,
  thumb: "pending",
  drawn: false,
  covered: false,
  tiles: "loading",
});

export function PlanCanvas({
  ref,
  label,
  revision,
  margins,
  quarterTurns,
  onTap,
  onTileState,
  onZoomRoom,
}: {
  ref: Ref<PlanCanvasHandle>;
  /** What the picture is, for someone who cannot see it. */
  label: string;
  revision: SheetRevision;
  margins: Margins;
  /** Quarter turns clockwise; kept from one sheet to the next. */
  quarterTurns: number;
  onTap: () => void;
  onTileState: (state: TileState) => void;
  onZoomRoom: (room: ZoomRoom) => void;
}) {
  const { url, width, height, tileSize, overlap, minLevel, maxLevel } = revision.tiles;
  const { top, right, bottom, left } = margins;

  const hostRef = useRef<HTMLDivElement>(null);
  const underlayRef = useRef<HTMLImageElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  /** The tiles the screen asks for, the ones being opened, and the ones open. */
  const wantedRef = useRef<Tiles>(revision.tiles);
  const openingRef = useRef<string | null>(null);
  const openRef = useRef<string | null>(null);
  /** Tiles of the open sheet that came in, and those that did not (yet, or for good). */
  const loadedRef = useRef(0);
  const troubleRef = useRef(new Map<OpenSeadragon.Tile, "retrying" | "failed">());
  /** The tiles' state is to be worked out again once the next frame is drawn. */
  const recheckRef = useRef(false);

  const [progress, setProgress] = useState(() => blank(url));
  // A new revision starts from nothing, whatever the previous one had reached.
  const current = progress.url === url ? progress : blank(url);
  const advance = (of: string, change: Partial<Progress>) =>
    setProgress((was) => ({ ...(was.url === of ? was : blank(of)), ...change }));

  /** Puts the thumbnail where the tiles are, or where they will first be drawn. */
  const placeUnderlay = useEffectEvent(() => {
    const image = underlayRef.current;
    const host = hostRef.current;
    if (!image || !host) return;
    const viewport = openRef.current === url ? viewerRef.current?.viewport : undefined;
    const placement = viewport
      ? placementAlong(
          viewport.pixelFromPoint(new OpenSeadragon.Point(0, 0), true),
          viewport.pixelFromPoint(new OpenSeadragon.Point(1, 0), true),
        )
      : fitPlacement(
          { width: host.clientWidth, height: host.clientHeight },
          margins,
          { width, height },
          quarterTurns,
        );
    image.style.transform = placementTransform(placement, UNDERLAY_WIDTH);
  });

  /** Works out how far the tiles have come, for the open sheet. */
  const settle = useEffectEvent(() => {
    const open = openRef.current;
    const image = viewerRef.current?.world.getItemAt(0);
    if (!open || !image) return;
    const trouble = [...troubleRef.current.values()];
    const drawn = loadedRef.current > 0;
    let tiles: TileState = "loading";
    if (trouble.includes("failed")) tiles = drawn ? "partial" : "missing";
    else if (trouble.length === 0 && drawn && image.getFullyLoaded()) tiles = "sharp";
    advance(open, tiles === "sharp" ? { tiles, drawn, covered: true } : { tiles, drawn });
    if (open === url) onTileState(tiles);
  });

  /** What the buttons were last told; told again only when it changes. */
  const zoomRoomRef = useRef<ZoomRoom | null>(null);
  const reportZoomRoom = useEffectEvent(() => {
    const viewport = viewerRef.current?.viewport;
    if (!viewport) return;
    const zoom = viewport.getZoom();
    const room = { in: zoom < viewport.getMaxZoom() * 0.995, out: !isWhole(viewport) };
    const told = zoomRoomRef.current;
    if (told && room.in === told.in && room.out === told.out) return;
    zoomRoomRef.current = room;
    onZoomRoom(room);
  });

  /** Opens the sheet the screen asks for, one at a time: OpenSeadragon would pile them up. */
  const openWanted = useEffectEvent(() => {
    const viewer = viewerRef.current;
    const host = hostRef.current;
    const wanted = wantedRef.current;
    if (!viewer || !host || openingRef.current || openRef.current === wanted.url) return;
    openingRef.current = wanted.url;
    openRef.current = null;
    loadedRef.current = 0;
    troubleRef.current.clear();
    // The canvas still holds the sheet being left: keep it out of sight until
    // the new one has been drawn, so only the new thumbnail shows meanwhile.
    host.style.visibility = "hidden";
    viewer.open({ tileSource: tileSource(wanted) });
  });

  const start = useEffectEvent(() => ({ margins, degrees: quarterTurns * 90 }));
  const tap = useEffectEvent(() => onTap());

  // The viewer lives as long as the screen and is given one sheet after
  // another; it is destroyed, with its listeners and its tiles, on leaving.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let destroy = () => {};

    const build = () => {
      const { margins: viewportMargins, degrees } = start();
      const viewer = new OpenSeadragon.Viewer({
        ...options,
        ...tileTuning({
          width: window.innerWidth,
          height: window.innerHeight,
          pixelRatio: window.devicePixelRatio,
        }),
        ...movement(window.matchMedia("(prefers-reduced-motion: reduce)").matches),
        element: host,
        viewportMargins,
        degrees,
      });
      viewerRef.current = viewer;
      let tapTimer: number | undefined;
      let unveil = false;
      /** Whether the sheet was shown whole in the last frame, and is to be again in this one. */
      let whole = true;
      let refit = false;

      const ofOpenSheet = (event: { tiledImage: OpenSeadragon.TiledImage }) =>
        openRef.current !== null && event.tiledImage === viewer.world.getItemAt(0);

      viewer.addHandler("open", () => {
        openRef.current = openingRef.current;
        openingRef.current = null;
        if (wantedRef.current.url !== openRef.current) {
          openWanted();
          return;
        }
        unveil = true;
        whole = true;
        viewer.world.getItemAt(0).addHandler("fully-loaded-change", () => settle());
        settle();
        placeUnderlay();
        reportZoomRoom();
      });
      viewer.addHandler("open-failed", () => {
        openingRef.current = null;
        host.style.visibility = "";
      });
      viewer.addHandler("update-viewport", () => {
        if (unveil) {
          unveil = false;
          host.style.visibility = "";
        }
        if (recheckRef.current) {
          recheckRef.current = false;
          settle();
        }
      });

      // A phone turned on its side: a sheet shown whole stays whole. (By the
      // time OpenSeadragon says the screen changed, "whole" already means
      // something else: it is remembered from the frame before.)
      viewer.addHandler("resize", () => {
        refit = whole;
      });
      viewer.addHandler("viewport-change", () => {
        if (refit) {
          refit = false;
          viewer.viewport.goHome(true);
        }
        whole = isWhole(viewer.viewport);
        placeUnderlay();
        reportZoomRoom();
      });

      viewer.addHandler("tile-loaded", (event) => {
        if (!ofOpenSheet(event)) return;
        loadedRef.current++;
        troubleRef.current.delete(event.tile);
        settle();
      });
      viewer.addHandler("tile-load-failed", (event) => {
        if (!ofOpenSheet(event)) return;
        // Without a network the other tries will fail too: say so at once.
        const final = event.tries > TILE_RETRIES || !navigator.onLine;
        troubleRef.current.set(event.tile, final ? "failed" : "retrying");
        settle();
      });

      viewer.addHandler("canvas-press", () => window.clearTimeout(tapTimer));
      viewer.addHandler("canvas-click", (event) => {
        if (!event.quick) return;
        window.clearTimeout(tapTimer);
        tapTimer = window.setTimeout(() => tap(), DOUBLE_TAP_MS);
      });
      viewer.addHandler("canvas-double-click", (event) => {
        event.preventDefaultAction = true;
        window.clearTimeout(tapTimer);
        const viewport = viewer.viewport;
        // Each double tap goes closer to the point; at the closest, back to the whole sheet.
        if (viewport.getZoom() >= viewport.getMaxZoom() * 0.99) {
          viewport.goHome();
        } else {
          viewport.zoomBy(DOUBLE_TAP_ZOOM, viewport.pointFromPixel(event.position, true));
          viewport.applyConstraints();
        }
      });

      openWanted();
      destroy = () => {
        window.clearTimeout(tapTimer);
        viewerRef.current = null;
        openingRef.current = null;
        openRef.current = null;
        viewer.destroy();
      };
    };

    // Built once the first frame is out: the thumbnail does not wait for the
    // viewer, whose drawing surface takes a moment to come up on a modest phone.
    let timer: number | undefined;
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(build);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      destroy();
    };
  }, []);

  useEffect(() => {
    wantedRef.current = { url, width, height, tileSize, overlap, minLevel, maxLevel };
    openWanted();
  }, [url, width, height, tileSize, overlap, minLevel, maxLevel]);

  // Before the browser paints: the thumbnail of a sheet just arrived at is in
  // place in the same frame as its name.
  useLayoutEffect(() => {
    const viewer = viewerRef.current;
    if (viewer) setMargins(viewer, { top, right, bottom, left });
    placeUnderlay();
  }, [top, right, bottom, left]);

  useLayoutEffect(() => {
    const viewport = viewerRef.current?.viewport;
    if (viewport && viewport.getRotation() !== quarterTurns * 90) {
      const whole = isWhole(viewport);
      viewport.setRotation(quarterTurns * 90);
      if (whole) viewport.goHome();
      else viewport.applyConstraints();
    }
    placeUnderlay();
  }, [quarterTurns]);

  useLayoutEffect(() => {
    placeUnderlay();
  }, [url, width, height, current.covered]);

  useImperativeHandle(ref, () => {
    const onSheet = (act: (viewport: OpenSeadragon.Viewport) => void) => {
      const viewer = viewerRef.current;
      if (viewer?.isOpen()) act(viewer.viewport);
    };
    return {
      zoomIn: () => onSheet((viewport) => viewport.zoomBy(BUTTON_ZOOM).applyConstraints()),
      zoomOut: () => onSheet((viewport) => viewport.zoomBy(1 / BUTTON_ZOOM).applyConstraints()),
      fit: () => onSheet((viewport) => viewport.goHome()),
      pan: (right, down) =>
        onSheet((viewport) => {
          const size = viewport.getContainerSize();
          const step = Math.min(size.x, size.y) / 5;
          const delta = new OpenSeadragon.Point(right * step, down * step);
          viewport.panBy(viewport.deltaPointsFromPixels(delta)).applyConstraints();
        }),
      retry: () => {
        // A tile that failed is marked as absent; saying it exists has it
        // asked for again if it is still in view, and its arrival or failure
        // is reported as before.
        for (const tile of troubleRef.current.keys()) tile.exists = true;
        troubleRef.current.clear();
        recheckRef.current = true;
        // OpenSeadragon only looks for tiles to fetch when the view moves or
        // the image changes: setting its clip (none) again makes it look.
        viewerRef.current?.world.getItemAt(0)?.setClip(null);
      },
    };
  }, []);

  const waiting = current.thumb !== "loaded" && !current.drawn && current.tiles === "loading";

  return (
    <div role="img" aria-label={label} className="absolute inset-0">
      {current.covered || current.thumb === "failed" ? null : (
        <img
          key={url}
          ref={underlayRef}
          src={revision.thumbUrl}
          crossOrigin="anonymous"
          alt=""
          decoding="sync"
          draggable={false}
          onLoad={() => advance(url, { thumb: "loaded" })}
          onError={() => advance(url, { thumb: "failed" })}
          // Until the picture arrives, a faint outline of the sheet.
          className="pointer-events-none absolute top-0 left-0 max-w-none origin-top-left bg-white/5 will-change-transform select-none"
          style={{ width: UNDERLAY_WIDTH, height: (UNDERLAY_WIDTH * height) / width }}
        />
      )}
      <div ref={hostRef} className="absolute inset-0" />
      {waiting ? (
        <div className="animate-fade pointer-events-none absolute inset-0 grid place-items-center [animation-delay:600ms]">
          <Spinner className="size-9" label="Chargement du plan" />
        </div>
      ) : null}
    </div>
  );
}
