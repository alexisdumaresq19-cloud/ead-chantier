import {
  DraftingCompass,
  File,
  FileArchive,
  FileSpreadsheet,
  FileText,
  FileType,
  Image,
  Presentation,
  type LucideIcon,
} from "lucide-react";

import { fileTypeOf, type DocumentKind } from "@/shared/documents";

import { cn } from "../../lib/cn";

// The colours people already know these files by: red for a PDF, green for a
// spreadsheet. They help find a paper in a long list at a glance.
const looks: Record<DocumentKind, { icon: LucideIcon; tone: string }> = {
  pdf: { icon: FileText, tone: "bg-bad-tint text-bad" },
  image: { icon: Image, tone: "bg-ead-tint text-ead-dark" },
  word: { icon: FileType, tone: "bg-ead-tint text-ead-dark" },
  sheet: { icon: FileSpreadsheet, tone: "bg-good-tint text-good" },
  slides: { icon: Presentation, tone: "bg-warn-tint text-warn" },
  text: { icon: FileText, tone: "bg-canvas text-dim" },
  drawing: { icon: DraftingCompass, tone: "bg-warn-tint text-warn" },
  archive: { icon: FileArchive, tone: "bg-canvas text-dim" },
  other: { icon: File, tone: "bg-canvas text-dim" },
};

/** A tile that says what kind of file this is. */
export function FileIcon({ filename, className }: { filename: string; className?: string }) {
  const { icon: Icon, tone } = looks[fileTypeOf(filename).kind];
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-xl",
        tone,
        className,
      )}
    >
      <Icon className="size-5.5" />
    </span>
  );
}
