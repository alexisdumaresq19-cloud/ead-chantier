import { Copy, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import { formatTime } from "../../lib/format";
import { isNativeApp, nativePlatform } from "../../native";
import { Button, Card, LogoFull, toast } from "../../ui";
import { asText, rows, type Facts, type Insets } from "./facts";

// /diagnostic, for support and for whoever builds the iPhone app: whether
// the shell works, in large plain text that reads in a screenshot. Open to
// anyone, linked from nowhere, and nothing personal on it.

async function siteVersion(): Promise<string | null> {
  try {
    const response = await fetch("/api/version", { cache: "no-store" });
    if (!response.ok) return null;
    const { version } = (await response.json()) as { version?: string };
    return version ?? null;
  } catch {
    return null;
  }
}

async function workerState(): Promise<Facts["worker"]> {
  if (!("serviceWorker" in navigator)) return "unsupported";
  if (navigator.serviceWorker.controller) return "controls";
  try {
    return (await navigator.serviceWorker.getRegistration()) ? "waiting" : "none";
  } catch {
    return "none";
  }
}

async function storageState(): Promise<Pick<Facts, "persisted" | "estimate">> {
  let persisted: boolean | null = null;
  let estimate: Facts["estimate"] = null;
  try {
    persisted = await navigator.storage.persisted();
  } catch {
    // Not said by this browser.
  }
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (quota !== undefined) estimate = { usage: usage ?? 0, quota };
  } catch {
    // Not said by this browser.
  }
  return { persisted, estimate };
}

/** The safe-area insets, read from an element that takes them as padding. */
function readInsets(probe: HTMLElement | null): Insets {
  if (!probe) return { top: 0, right: 0, bottom: 0, left: 0 };
  const style = getComputedStyle(probe);
  const px = (value: string) => Math.round(parseFloat(value) || 0);
  return {
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft),
  };
}

async function gather(probe: HTMLElement | null): Promise<Facts> {
  const inApp = isNativeApp();
  const native = inApp ? await import("../../native/diagnostic") : null;
  const [version, worker, storage, shell, plugins] = await Promise.all([
    siteVersion(),
    workerState(),
    storageState(),
    native ? native.shellInfo() : null,
    native ? native.askPlugins() : null,
  ]);
  return {
    inApp,
    platform: nativePlatform(),
    siteVersion: version,
    shell,
    worker,
    ...storage,
    plugins,
    userAgent: navigator.userAgent,
    insets: readInsets(probe),
    online: navigator.onLine,
    cookies: navigator.cookieEnabled,
  };
}

export function DiagnosticScreen() {
  const probe = useRef<HTMLDivElement>(null);
  const [facts, setFacts] = useState<Facts | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [checking, setChecking] = useState(true);

  const load = useCallback(
    () =>
      gather(probe.current)
        .then((found) => {
          setFacts(found);
          setCheckedAt(new Date());
        })
        .finally(() => setChecking(false)),
    [],
  );
  useEffect(() => void load(), [load]);

  function check() {
    setChecking(true);
    void load();
  }

  const list = facts ? rows(facts) : [];

  async function copy() {
    try {
      await navigator.clipboard.writeText(asText(list));
      toast.success("Diagnostic copié");
    } catch {
      toast.error("La copie n'a pas fonctionné. Faites plutôt une capture d'écran.");
    }
  }

  return (
    <div className="bg-canvas min-h-dvh pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div
        ref={probe}
        aria-hidden
        className="pointer-events-none invisible fixed top-0 left-0 size-0 pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
      />
      <header className="bg-ink flex items-center justify-between gap-4 pt-[calc(1rem+env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-4 pl-[max(1.25rem,env(safe-area-inset-left))] text-white">
        <LogoFull className="w-24" />
        <p className="text-sm font-semibold text-white/70">
          {checkedAt ? `Vérifié à ${formatTime(checkedAt)}` : "Vérification…"}
        </p>
      </header>
      <main className="mx-auto max-w-2xl pt-5 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]">
        <h1 className="font-display text-[32px] leading-tight font-bold">Diagnostic</h1>
        <p className="text-dim mt-1 text-[17px] text-pretty">
          Ce que l&apos;appareil dit de l&apos;app, pour le soutien. Aucune donnée personnelle.
        </p>
        <Card className="divide-line mt-5 divide-y">
          {facts === null ? (
            <p className="text-dim px-4 py-6 text-[19px]">Vérification…</p>
          ) : (
            list.map((row) => (
              <div key={row.label} className="px-4 py-3">
                <p className="text-dim text-[15px] font-semibold">{row.label}</p>
                <p
                  data-diagnostic={row.label}
                  className={cn(
                    "mt-0.5 text-[21px] leading-snug font-bold break-words whitespace-pre-line",
                    row.label === "Navigateur" && "text-[15px] leading-normal font-medium",
                    row.tone === "good" && "text-good",
                    row.tone === "bad" && "text-bad",
                  )}
                >
                  {row.value}
                </p>
              </div>
            ))
          )}
        </Card>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button size="lg" loading={checking} onClick={check}>
            <RefreshCw aria-hidden /> Vérifier de nouveau
          </Button>
          <Button size="lg" variant="secondary" disabled={!facts} onClick={copy}>
            <Copy aria-hidden /> Copier le texte
          </Button>
        </div>
      </main>
    </div>
  );
}
