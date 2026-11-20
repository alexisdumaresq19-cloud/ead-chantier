import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import {
  downloadName,
  opensInBrowser,
  type DocumentLink,
  type ProjectDocument,
} from "@/shared/documents";

import { api, ApiFailure, errorMessage } from "../../lib/api";
import { isNativeApp } from "../../native";
import { buttonClass, Sheet, toast } from "../../ui";
import { documentsKey, download, refreshProject } from "./data";

// Opening a document: its link is asked for at that moment, used once and
// never kept. PDFs and images go to a new tab, where the phone's own viewer
// shows them; other files are saved on the device. In the iPhone app, where
// a new tab goes to Safari and a download does nothing, every file opens in
// the system's viewer (which shares, prints and saves it too).

export const NO_NETWORK = "Pas de réseau. Les documents s'ouvrent seulement avec une connexion.";

/**
 * Up to this size the page fetches the file and hands it over under its
 * title; a larger one the viewer downloads itself, from the signed link,
 * rather than through the page's memory.
 */
const FETCHED_IN_PAGE = 25 * 1024 * 1024;

/** In the iPhone app: the file in the system's viewer. */
async function openInApp(document: ProjectDocument, url: string) {
  const files = await import("../../native/files");
  const address = new URL(url, window.location.origin).href;
  if (document.size <= FETCHED_IN_PAGE) {
    let file: Blob | null = null;
    try {
      // The link is signed: it needs no session, and storage allows any page to read it.
      const response = await fetch(address, { credentials: "omit" });
      if (response.ok) file = await response.blob();
    } catch {
      // Unreadable from the page: the viewer fetches it below.
    }
    if (file) return files.openFile(file, downloadName(document.title, document.filename));
  }
  return files.openFileAt(address);
}

/**
 * A tab opened during the tap itself: once the link has arrived, phones no
 * longer let a page open one. It says what is going on until the file shows.
 */
function openWaitingTab(): Window | null {
  const tab = window.open("", "_blank");
  if (!tab) return null;
  try {
    tab.document.title = "Ouverture du document";
    // Without it a phone lays the blank page out a desktop wide, and the text is lost.
    const viewport = tab.document.createElement("meta");
    viewport.name = "viewport";
    viewport.content = "width=device-width, initial-scale=1";
    tab.document.head.append(viewport);
    const text = tab.document.createElement("p");
    text.textContent = "Ouverture du document…";
    text.style.cssText =
      "margin: 40vh 24px 0; text-align: center; color: #5a6572; font: 17px system-ui, sans-serif";
    tab.document.body.append(text);
  } catch {
    // A browser that locks its blank page shows an empty tab for a moment.
  }
  return tab;
}

export function useDocumentOpener(projectId: string) {
  const queryClient = useQueryClient();
  const busy = useRef(new Set<string>());
  const [opening, setOpening] = useState<ReadonlySet<string>>(new Set());
  /** A link that could not be opened for the person: they open it themselves. */
  const [ready, setReady] = useState<{ document: ProjectDocument; url: string } | null>(null);

  const open = useCallback(
    async (document: ProjectDocument) => {
      // A second tap while the link is on its way would open the file twice.
      if (busy.current.has(document.id)) return;
      // "Offline" is certain when the device says so; "online" is only a hope.
      if (!navigator.onLine) {
        toast.error(NO_NETWORK);
        return;
      }
      busy.current.add(document.id);
      const inApp = isNativeApp();
      const inTab = !inApp && opensInBrowser(document.filename);
      const tab = inTab ? openWaitingTab() : null;
      setOpening((ids) => new Set(ids).add(document.id));
      try {
        const { url } = await queryClient.fetchQuery({
          queryKey: [...documentsKey(projectId), document.id, "link"],
          queryFn: () => api<DocumentLink>(`/api/documents/${document.id}/link`),
          meta: { persist: false },
          staleTime: 0,
          gcTime: 0,
          retry: false,
        });
        if (inApp) {
          await openInApp(document, url).catch(() =>
            toast.error("Le document n'a pas pu s'ouvrir. Réessayez."),
          );
        } else if (!inTab) {
          download(url);
          toast.success("Téléchargement lancé");
        } else if (tab && !tab.closed) {
          // The file comes from storage, which has no business reaching back here.
          tab.opener = null;
          tab.location.replace(url);
        } else {
          setReady({ document, url });
        }
      } catch (error) {
        tab?.close();
        const offline = error instanceof ApiFailure && error.offline;
        toast.error(offline ? NO_NETWORK : errorMessage(error));
        // Someone archived it in the meantime: the list is out of date.
        if (error instanceof ApiFailure && error.status === 404) void refreshProject(projectId);
      } finally {
        busy.current.delete(document.id);
        setOpening((ids) => {
          const next = new Set(ids);
          next.delete(document.id);
          return next;
        });
      }
    },
    [projectId, queryClient],
  );

  return { open, opening, ready, dismissReady: () => setReady(null) };
}

/** Shown when the browser refused the new tab: a link the person taps is always allowed. */
export function ReadyDocumentSheet({
  ready,
  onClose,
}: {
  ready: { document: ProjectDocument; url: string } | null;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={Boolean(ready)}
      onClose={onClose}
      title="Document prêt"
      description={ready?.document.title}
    >
      <a
        href={ready?.url}
        target="_blank"
        rel="noreferrer"
        onClick={onClose}
        className={buttonClass({ size: "lg", block: true })}
      >
        <ExternalLink aria-hidden /> Ouvrir le document
      </a>
    </Sheet>
  );
}
