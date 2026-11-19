import type { PlanImport } from "@/shared/plans";

import { importPageDto } from "./dto";
import { importWithPages } from "./imports";

export async function importDto(importId: string): Promise<PlanImport & { projectId: string }> {
  const { current, pages } = await importWithPages(importId);
  return {
    id: current.id,
    projectId: current.projectId,
    filename: current.filename,
    status: current.status,
    error: current.error,
    pageCount: current.pageCount,
    folderId: current.folderId,
    revisionLabel: current.revisionLabel,
    issuedOn: current.issuedOn,
    createdAt: current.createdAt.toISOString(),
    pages: pages.map(importPageDto),
  };
}
