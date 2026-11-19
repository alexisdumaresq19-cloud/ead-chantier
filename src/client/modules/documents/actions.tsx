import { useMutation } from "@tanstack/react-query";
import { Archive, Check, ChevronRight, FolderInput, Pencil, type LucideIcon } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  DOCUMENT_TITLE_MAX,
  tidyTitle,
  type DocumentCategory,
  type ProjectDocument,
} from "@/shared/documents";

import { api, ApiFailure, errorMessage } from "../../lib/api";
import { cn } from "../../lib/cn";
import { Button, Field, FormError, Input, Sheet, Spinner, toast } from "../../ui";
import { changeDocuments, refreshProject } from "./data";

// What a manager does to one document: rename it, move it to another
// category, archive it. One window, which goes from the menu to the form.

type Step = "menu" | "rename" | "category";

const titles: Record<Step, string> = {
  menu: "Gérer le document",
  rename: "Renommer le document",
  category: "Changer de catégorie",
};

export function DocumentActions({
  projectId,
  document,
  onArchive,
  onClose,
}: {
  projectId: string;
  /** The document whose menu is open, or null. */
  document: ProjectDocument | null;
  /** Archiving is confirmed and done by the list, which outlives this window. */
  onArchive: (document: ProjectDocument) => void;
  onClose: () => void;
}) {
  // Keyed by document: each opening starts at the menu, with its own fields.
  return (
    <ActionsSheet
      key={document?.id ?? ""}
      projectId={projectId}
      document={document}
      onArchive={onArchive}
      onClose={onClose}
    />
  );
}

function ActionsSheet({
  projectId,
  document,
  onArchive,
  onClose,
}: {
  projectId: string;
  document: ProjectDocument | null;
  onArchive: (document: ProjectDocument) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("menu");
  const [title, setTitle] = useState(document?.title ?? "");
  const formId = useId();

  const change = useMutation({
    mutationFn: (input: { title?: string; category?: DocumentCategory }) =>
      api<ProjectDocument>(`/api/documents/${document?.id}`, { method: "PATCH", body: input }),
    onSuccess(updated, input) {
      void changeDocuments(projectId, (documents) =>
        documents.map((current) => (current.id === updated.id ? updated : current)),
      );
      toast.success(
        input.category
          ? `Document classé dans « ${DOCUMENT_CATEGORY_LABELS[updated.category]} »`
          : "Document renommé",
      );
      onClose();
    },
    onError(error) {
      // Archived by someone else in the meantime: the list is out of date,
      // and this window is about a document that is no longer there.
      if (error instanceof ApiFailure && error.status === 404) {
        toast.error(errorMessage(error));
        void refreshProject(projectId);
        onClose();
      }
    },
  });

  const rename = (event: FormEvent) => {
    event.preventDefault();
    const next = tidyTitle(title);
    if (!next) return;
    if (next === document?.title) onClose();
    else change.mutate({ title: next });
  };

  return (
    <Sheet
      open={Boolean(document)}
      onClose={onClose}
      title={titles[step]}
      description={<span className="wrap-anywhere">{document?.title}</span>}
      footer={
        step === "rename" ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" form={formId} loading={change.isPending}>
              Enregistrer
            </Button>
          </>
        ) : undefined
      }
    >
      {document && step === "menu" ? (
        <Choices>
          <Choice icon={Pencil} label="Renommer" onClick={() => setStep("rename")} />
          <Choice
            icon={FolderInput}
            label="Changer de catégorie"
            detail={DOCUMENT_CATEGORY_LABELS[document.category]}
            onClick={() => setStep("category")}
          />
          <Choice icon={Archive} label="Archiver" danger onClick={() => onArchive(document)} />
        </Choices>
      ) : null}

      {document && step === "rename" ? (
        <form id={formId} onSubmit={rename} className="space-y-4">
          <Field label="Titre">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onFocus={(event) => event.target.select()}
              maxLength={DOCUMENT_TITLE_MAX}
              autoFocus
              required
              autoComplete="off"
              enterKeyHint="done"
            />
          </Field>
          <FormError>{change.isError ? errorMessage(change.error) : null}</FormError>
        </form>
      ) : null}

      {document && step === "category" ? (
        <div className="space-y-4">
          <div role="radiogroup" aria-label="Catégorie">
            <Choices>
              {DOCUMENT_CATEGORIES.map((category) => {
                const current = category === document.category;
                const saving = change.isPending && change.variables.category === category;
                return (
                  <button
                    key={category}
                    type="button"
                    role="radio"
                    aria-checked={current}
                    disabled={change.isPending}
                    onClick={() => (current ? onClose() : change.mutate({ category }))}
                    className={cn(choiceClass, current && "text-ead-dark")}
                  >
                    <span className="min-w-0 flex-1">{DOCUMENT_CATEGORY_LABELS[category]}</span>
                    {saving ? (
                      <Spinner className="size-5" label="Enregistrement" />
                    ) : current ? (
                      <Check className="size-5 shrink-0" aria-hidden />
                    ) : null}
                  </button>
                );
              })}
            </Choices>
          </div>
          <FormError>{change.isError ? errorMessage(change.error) : null}</FormError>
        </div>
      ) : null}
    </Sheet>
  );
}

const choiceClass =
  "flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-2 text-left font-semibold transition-colors hover:bg-canvas active:bg-canvas disabled:pointer-events-none disabled:opacity-60";

function Choices({ children }: { children: ReactNode }) {
  return (
    <div className="divide-line border-line divide-y overflow-hidden rounded-2xl border">
      {children}
    </div>
  );
}

function Choice({
  icon: Icon,
  label,
  detail,
  danger,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  detail?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={cn(choiceClass, danger && "text-bad")}>
      <Icon className={cn("size-5 shrink-0", !danger && "text-ead-dark")} aria-hidden />
      <span className="min-w-0 flex-1">
        {label}
        {detail ? (
          <span className="text-dim block truncate text-sm font-normal">{detail}</span>
        ) : null}
      </span>
      {danger ? null : <ChevronRight className="text-dim size-5 shrink-0" aria-hidden />}
    </button>
  );
}
