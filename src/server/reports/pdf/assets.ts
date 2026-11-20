import { readFile } from "node:fs/promises";
import { join } from "node:path";

// What the PDF is drawn with: the app's two typefaces (Inter for text,
// Archivo for titles, both under the SIL Open Font License kept beside them)
// and EAD's logo. They are read from disk once per server instance. On
// Vercel these files are not found by the bundler: next.config.ts names them
// in the trace of the API routes.

/**
 * A file of the project, by its place from the project's folder. The path is
 * put together at run time and marked, so that the bundler does not try to
 * follow it (it would put the whole project in the route's trace).
 */
const projectFile = (...place: string[]) =>
  readFile(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ process.cwd(), ...place));
const FONTS = ["src", "server", "reports", "pdf", "fonts"];
const BRAND = ["public", "brand"];

const FONT_FILES = {
  text: "Inter-Regular.ttf",
  italic: "Inter-Italic.ttf",
  strong: "Inter-SemiBold.ttf",
  bold: "Inter-Bold.ttf",
  title: "Archivo-Bold.ttf",
  display: "Archivo-ExtraBold.ttf",
} as const;

export type FontName = keyof typeof FONT_FILES;

export type PdfAssets = {
  fonts: Record<FontName, Buffer>;
  /** The full logo, with the company's name. Drawn for a black background. */
  logo: Buffer;
  /** The emblem alone. Drawn for a black background. */
  mark: Buffer;
};

let loading: Promise<PdfAssets> | undefined;

async function load(): Promise<PdfAssets> {
  const names = Object.keys(FONT_FILES) as FontName[];
  const [logo, mark, ...fonts] = await Promise.all([
    projectFile(...BRAND, "ead-logo.png"),
    projectFile(...BRAND, "ead-mark.png"),
    ...names.map((name) => projectFile(...FONTS, FONT_FILES[name])),
  ]);
  return {
    fonts: Object.fromEntries(names.map((name, index) => [name, fonts[index]])) as Record<
      FontName,
      Buffer
    >,
    logo,
    mark,
  };
}

export function pdfAssets(): Promise<PdfAssets> {
  loading ??= load().catch((error) => {
    // A failed read is tried again at the next document.
    loading = undefined;
    throw error;
  });
  return loading;
}
