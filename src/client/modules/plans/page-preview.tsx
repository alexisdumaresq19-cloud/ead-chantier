import { useEffect, useRef, useState } from "react";

import { tileUrl, type ImportPage, type Tiles } from "@/shared/plans";

import { Sheet, Spinner } from "../../ui";

/**
 * A page of an import, enlarged: to check a sheet's number and title, the
 * office has to read its title block, so the page can be zoomed all the way
 * in, from the same tiles the site will see.
 */
export function PagePreview({ page, onClose }: { page: ImportPage; onClose: () => void }) {
  return (
    <Sheet
      open
      wide
      onClose={onClose}
      title={`Page ${page.pageIndex + 1}`}
      description="Pincez l'image ou tournez la molette pour lire le cartouche."
    >
      {page.tiles ? <Zoomable tiles={page.tiles} still={page.thumbUrl} /> : null}
    </Sheet>
  );
}

function Zoomable({ tiles, still }: { tiles: Tiles; still: string | null }) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "still">("loading");

  useEffect(() => {
    let closed = false;
    let viewer: { destroy: () => void } | undefined;
    // The zooming library is large and only this window uses it here: it is
    // fetched when the window opens.
    import("openseadragon")
      .then(({ default: OpenSeadragon }) => {
        if (closed || !container.current) return;
        viewer = OpenSeadragon({
          element: container.current,
          tileSources: {
            width: tiles.width,
            height: tiles.height,
            tileSize: tiles.tileSize,
            tileOverlap: tiles.overlap,
            minLevel: tiles.minLevel,
            maxLevel: tiles.maxLevel,
            getTileUrl: (level, column, row) => tileUrl(tiles, level, column, row),
          },
          crossOriginPolicy: "Anonymous",
          showNavigationControl: false,
          visibilityRatio: 1,
          constrainDuringPan: true,
          maxZoomPixelRatio: 2,
          animationTime: 0.4,
          gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true },
          gestureSettingsTouch: { dblClickToZoom: true },
        });
        setState("ready");
      })
      // Without the library (no network), the small image still shows the page.
      .catch(() => setState("still"));
    return () => {
      closed = true;
      viewer?.destroy();
    };
  }, [tiles]);

  return (
    <div className="border-line relative h-[62dvh] overflow-hidden rounded-xl border bg-white">
      {state === "still" && still ? (
        <img src={still} alt="" crossOrigin="anonymous" className="size-full object-contain" />
      ) : (
        <div ref={container} className="size-full touch-none" />
      )}
      {state === "loading" ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner className="size-8" />
        </div>
      ) : null}
    </div>
  );
}
