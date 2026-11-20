import { formatSize } from "../../lib/format";
import type { PluginAnswer, ShellInfo } from "../../native/diagnostic";

// What the diagnostic screen says, worked out from what the page could
// learn. Kept apart from the screen so that every wording is tested.

export type Insets = { top: number; right: number; bottom: number; left: number };

export type Facts = {
  inApp: boolean;
  platform: string;
  /** The server's version (GET /api/version), null when it did not answer. */
  siteVersion: string | null;
  /** The shell's own version, inside the app only. */
  shell: ShellInfo | null;
  /** "controls": a worker answers this page; "waiting": registered, not yet answering. */
  worker: "controls" | "waiting" | "none" | "unsupported";
  /** null: the browser does not say. */
  persisted: boolean | null;
  estimate: { usage: number; quota: number } | null;
  plugins: PluginAnswer[] | null;
  userAgent: string;
  insets: Insets;
  online: boolean;
  cookies: boolean;
  /** What the page's own sharing (navigator.share) takes here. */
  webShare: "files" | "links" | "none";
};

export type Row = { label: string; value: string; tone?: "good" | "bad" };

const yesNo = (value: boolean) => (value ? "Oui" : "Non");

const workerText: Record<Facts["worker"], string> = {
  controls: "Actif sur cette page",
  waiting: "Installé, en attente du prochain lancement",
  none: "Aucun",
  unsupported: "Non disponible ici",
};

// Inside the app a file is shared either way: through the page's sharing
// when it takes files, else through the shell's.
const webShareText: Record<Facts["webShare"], string> = {
  files: "Fichiers et liens",
  links: "Liens seulement",
  none: "Non disponible",
};

const pluginText: Record<PluginAnswer["state"], string> = {
  answers: "répond",
  missing: "absent",
  silent: "ne répond pas",
  failed: "erreur",
};

export function pluginLine(answer: PluginAnswer): string {
  const detail = answer.detail ? ` (${answer.detail})` : "";
  return `${answer.name}\u00a0: ${pluginText[answer.state]}${detail}`;
}

export function rows(facts: Facts): Row[] {
  const { top, right, bottom, left } = facts.insets;
  const list: Row[] = [
    {
      label: "Dans l'app iPhone",
      value: yesNo(facts.inApp),
      tone: facts.inApp ? "good" : undefined,
    },
    {
      label: "Plateforme",
      value:
        facts.platform === "ios" ? "iOS" : facts.platform === "web" ? "Navigateur" : facts.platform,
    },
    {
      label: "Version du site",
      value: facts.siteVersion ?? "Pas de réponse du serveur",
      tone: facts.siteVersion ? undefined : "bad",
    },
  ];
  if (facts.inApp)
    list.push({
      label: "Version de l'app",
      value: facts.shell ? `${facts.shell.version} (${facts.shell.build})` : "Inconnue",
    });
  list.push(
    {
      label: "Mode hors ligne",
      value: workerText[facts.worker],
      tone:
        facts.worker === "controls" ? "good" : facts.worker === "unsupported" ? "bad" : undefined,
    },
    {
      label: "Stockage protégé",
      value:
        facts.persisted === null
          ? "Inconnu"
          : facts.persisted
            ? "Oui"
            : "Non, l'appareil peut l'effacer",
    },
    {
      label: "Espace utilisé",
      value: facts.estimate
        ? `${formatSize(facts.estimate.usage)} sur ${formatSize(facts.estimate.quota)}`
        : "Inconnu",
    },
  );
  if (facts.inApp)
    list.push({
      label: "Modules de l'app",
      value: facts.plugins ? facts.plugins.map(pluginLine).join("\n") : "Vérification…",
      tone:
        facts.plugins && facts.plugins.some((answer) => answer.state !== "answers")
          ? "bad"
          : undefined,
    });
  list.push(
    {
      label: "Partage par la page",
      value: webShareText[facts.webShare],
    },
    {
      label: "Réseau",
      value: facts.online ? "En ligne" : "Hors ligne",
      tone: facts.online ? undefined : "bad",
    },
    {
      label: "Témoins (cookies)",
      value: facts.cookies ? "Activés" : "Désactivés",
      tone: facts.cookies ? undefined : "bad",
    },
    {
      label: "Marges de l'écran",
      value: `haut ${top} · droite ${right} · bas ${bottom} · gauche ${left} px`,
    },
    { label: "Navigateur", value: facts.userAgent },
  );
  return list;
}

/** The whole screen as text, to paste in a message to support. */
export const asText = (list: Row[]) =>
  list.map((row) => `${row.label}\u00a0: ${row.value.replace(/\n/g, ", ")}`).join("\n");
