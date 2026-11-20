import { Trash2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import type { PlanFolder } from "@/shared/plans";

import { errorMessage } from "../../lib/api";
import { Button, Field, FormError, Input, Sheet, toast } from "../../ui";
import { confirmDeliberately } from "./confirm";
import { useCreateFolder, useDeleteFolder, useRenameFolder } from "./data";

/**
 * The window that creates a folder (no `folder`) or renames and deletes one.
 * Mounted when needed, so it always opens with the folder's current name.
 */
export function FolderDialog({
  projectId,
  folder,
  sheetCount = 0,
  onClose,
  onCreated,
}: {
  projectId: string;
  folder?: PlanFolder | null;
  /** How many sheets the folder holds, to say what deleting it does. */
  sheetCount?: number;
  onClose: () => void;
  onCreated?: (folder: PlanFolder) => void;
}) {
  const [name, setName] = useState(folder?.name ?? "");
  const formId = useId();
  const create = useCreateFolder(projectId);
  const rename = useRenameFolder(projectId);
  const remove = useDeleteFolder(projectId);
  const error = create.error ?? rename.error ?? remove.error;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const wanted = name.trim();
    if (!wanted) return;
    if (!folder) {
      create.mutate(wanted, {
        onSuccess: (created) => {
          toast.success(`Dossier « ${created.name} » créé`);
          onCreated?.(created);
          onClose();
        },
      });
    } else if (wanted === folder.name) {
      onClose();
    } else {
      rename.mutate(
        { folderId: folder.id, name: wanted },
        {
          onSuccess: () => {
            toast.success("Dossier renommé");
            onClose();
          },
        },
      );
    }
  };

  const destroy = async () => {
    if (!folder) return;
    const confirmed = await confirmDeliberately({
      title: `Supprimer le dossier « ${folder.name} »?`,
      text:
        sheetCount === 0
          ? "Ce dossier est vide."
          : sheetCount === 1
            ? "Sa feuille ira dans « Sans dossier ». Aucune feuille n'est supprimée."
            : `Ses ${sheetCount} feuilles iront dans « Sans dossier ». Aucune feuille n'est supprimée.`,
      confirmLabel: "Supprimer le dossier",
      danger: true,
    });
    if (!confirmed) return;
    remove.mutate(folder.id, {
      onSuccess: () => {
        toast.success(`Dossier « ${folder.name} » supprimé`);
        onClose();
      },
    });
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={folder ? "Modifier le dossier" : "Nouveau dossier"}
      description={
        folder
          ? undefined
          : "Un dossier regroupe des feuilles\u00a0: Civil, Structure, Électricité…"
      }
      footer={
        <>
          {folder ? (
            <Button
              variant="secondary"
              className="text-bad sm:mr-auto"
              onClick={destroy}
              loading={remove.isPending}
              disabled={rename.isPending}
            >
              <Trash2 aria-hidden /> Supprimer
            </Button>
          ) : (
            <Button variant="secondary" onClick={onClose}>
              Annuler
            </Button>
          )}
          <Button
            type="submit"
            form={formId}
            loading={create.isPending || rename.isPending}
            disabled={remove.isPending || !name.trim()}
          >
            {folder ? "Enregistrer" : "Créer le dossier"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        <Field label="Nom du dossier">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={"Ex.\u00a0: Civil"}
            maxLength={60}
            autoComplete="off"
            autoCapitalize="sentences"
            autoFocus
            required
          />
        </Field>
        <FormError>{error ? errorMessage(error) : null}</FormError>
      </form>
    </Sheet>
  );
}
