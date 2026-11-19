import { describe, expect, it } from "vitest";

import {
  DOCUMENT_ACCEPT,
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  DOCUMENT_MAX_SIZE,
  DOCUMENT_TITLE_MAX,
  downloadName,
  extensionOf,
  fileProblem,
  fileTypeOf,
  fitFilename,
  opensInBrowser,
  tidyTitle,
  titleFromFilename,
  toCategory,
} from "./documents";

describe("document categories", () => {
  it("have a label each, and end with the catch-all", () => {
    for (const category of DOCUMENT_CATEGORIES)
      expect(DOCUMENT_CATEGORY_LABELS[category]).toBeTruthy();
    expect(DOCUMENT_CATEGORIES.at(-1)).toBe("autre");
  });

  it("files an unknown stored category with the others", () => {
    expect(toCategory("permis")).toBe("permis");
    expect(toCategory("ancienne-categorie")).toBe("autre");
    expect(toCategory("")).toBe("autre");
  });
});

describe("extensionOf", () => {
  it("reads the extension, whatever its case", () => {
    expect(extensionOf("Devis.PDF")).toBe("pdf");
    expect(extensionOf("photo.du.site.jpeg")).toBe("jpeg");
    expect(extensionOf("plan.dwg ")).toBe("dwg");
  });

  it("finds none where there is none", () => {
    expect(extensionOf("Devis")).toBe("");
    expect(extensionOf("Plan v1.2")).toBe("");
    expect(extensionOf("rapport.")).toBe("");
    expect(extensionOf("note.avec espace")).toBe("");
  });
});

describe("titleFromFilename", () => {
  it("drops the extension", () => {
    expect(titleFromFilename("Programme de prévention.pdf")).toBe("Programme de prévention");
    expect(titleFromFilename("Essai de compaction 2026-10-14.XLSX")).toBe(
      "Essai de compaction 2026-10-14",
    );
  });

  it("reads underscores as spaces and tidies the rest", () => {
    expect(titleFromFilename("Devis_section_3__égout.pdf")).toBe("Devis section 3 égout");
    expect(titleFromFilename("  Permis   MELCCFP .pdf")).toBe("Permis MELCCFP");
  });

  it("keeps a name without an extension, and dots that are part of it", () => {
    expect(titleFromFilename("Plan v1.2")).toBe("Plan v1.2");
    expect(titleFromFilename("Fiche tuyau PVC DR35 v1.2.pdf")).toBe("Fiche tuyau PVC DR35 v1.2");
  });

  it("never gives an empty title or one that is too long", () => {
    expect(titleFromFilename(".pdf")).toBe("Document");
    expect(titleFromFilename("___.pdf")).toBe("Document");
    const long = titleFromFilename(`${"Rapport ".repeat(40)}.pdf`);
    expect(long.length).toBeLessThanOrEqual(DOCUMENT_TITLE_MAX);
    expect(long).toBe(long.trim());
  });

  it("shortens a long name at the end of a word when it can", () => {
    const unit = "Essai de compaction du remblai ";
    expect(titleFromFilename(`${unit.repeat(6)}.pdf`)).toBe(
      `${unit.repeat(3)}Essai de compaction du`,
    );
    expect(titleFromFilename(`${"x".repeat(300)}.pdf`)).toHaveLength(DOCUMENT_TITLE_MAX);
  });
});

describe("tidyTitle", () => {
  it("makes one line with single spaces", () => {
    expect(tidyTitle("  Devis \n section\t3  ")).toBe("Devis section 3");
  });

  it("reads control characters as spaces, so a title of nothing else is empty", () => {
    expect(tidyTitle("Devis\u0000section\u0007 3\u007f")).toBe("Devis section 3");
    expect(tidyTitle("\u0000\u001b")).toBe("");
  });
});

describe("downloadName", () => {
  it("is the title with the file's extension", () => {
    expect(downloadName("Devis — section 3", "DEV_S3_final.PDF")).toBe("Devis — section 3.pdf");
  });

  it("does not repeat an extension already in the title", () => {
    expect(downloadName("Horaire.xlsx", "horaire.xlsx")).toBe("Horaire.xlsx");
  });

  it("removes what a file name cannot hold", () => {
    expect(downloadName('Essai 3/4 : "béton" <28 j>?', "essai.pdf")).toBe(
      "Essai 3 4 béton 28 j.pdf",
    );
    expect(downloadName("Rapport final...", "r.docx")).toBe("Rapport final.docx");
  });

  it("falls back on the original name", () => {
    expect(downloadName("???", "essai.pdf")).toBe("essai.pdf");
  });
});

describe("fitFilename", () => {
  it("leaves an ordinary name alone", () => {
    expect(fitFilename("Devis section 3.pdf")).toBe("Devis section 3.pdf");
  });

  it("shortens a very long name and keeps its extension", () => {
    const fitted = fitFilename(`${"x".repeat(240)}.PDF`);
    expect(fitted).toHaveLength(200);
    expect(fitted.endsWith(".pdf")).toBe(true);
    expect(fileProblem({ name: fitted, size: 10 })).toBeNull();
  });

  it("shortens a long name that has no extension", () => {
    expect(fitFilename("y".repeat(240))).toHaveLength(200);
  });
});

describe("file types", () => {
  it("recognises a file by its extension", () => {
    expect(fileTypeOf("Devis.pdf")).toMatchObject({ kind: "pdf", label: "PDF" });
    expect(fileTypeOf("IMG_0042.JPG")).toMatchObject({ kind: "image", contentType: "image/jpeg" });
    expect(fileTypeOf("coupe.dwg")).toMatchObject({ kind: "drawing", label: "DWG" });
    expect(fileTypeOf("quantités.xlsx").kind).toBe("sheet");
    expect(fileTypeOf("mystère.xyz")).toMatchObject({ kind: "other", label: "Fichier" });
    expect(fileTypeOf("sans extension").kind).toBe("other");
  });

  it("opens PDFs and common images in the browser, and saves the rest", () => {
    expect(opensInBrowser("Devis.pdf")).toBe(true);
    expect(opensInBrowser("photo.png")).toBe(true);
    expect(opensInBrowser("photo.heic")).toBe(false);
    expect(opensInBrowser("Devis.docx")).toBe(false);
    expect(opensInBrowser("Devis")).toBe(false);
  });

  it("only announces types storage accepts for documents", () => {
    // The rule of src/server/uploads.ts for kind "document".
    const accepted =
      /^(application\/pdf|image\/(jpeg|png|webp|heic|heif)|text\/(plain|csv)|application\/(msword|vnd\.ms-excel|vnd\.ms-powerpoint|zip|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.dwg|acad|dxf|octet-stream)|image\/vnd\.dwg)$/;
    for (const extension of DOCUMENT_ACCEPT.split(","))
      expect(fileTypeOf(`fichier${extension}`).contentType).toMatch(accepted);
  });
});

describe("fileProblem", () => {
  it("accepts what a site keeps", () => {
    expect(fileProblem({ name: "Devis.pdf", size: 1200 })).toBeNull();
    expect(fileProblem({ name: "coupe.DXF", size: 1200 })).toBeNull();
    expect(fileProblem({ name: "gros.pdf", size: DOCUMENT_MAX_SIZE })).toBeNull();
  });

  it("says why it refuses the rest", () => {
    expect(fileProblem({ name: "installateur.exe", size: 1200 })).toBe("type");
    expect(fileProblem({ name: "sans extension", size: 1200 })).toBe("type");
    expect(fileProblem({ name: "x.constructor", size: 1200 })).toBe("type");
    expect(fileProblem({ name: "vide.pdf", size: 0 })).toBe("empty");
    expect(fileProblem({ name: "gros.pdf", size: DOCUMENT_MAX_SIZE + 1 })).toBe("size");
  });
});
