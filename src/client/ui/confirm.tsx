import { useSyncExternalStore } from "react";

import { Button } from "./button";
import { Sheet } from "./sheet";

// "Are you sure?" from anywhere:
//   if (await confirmAction({ title: "Retirer cette feuille ?", danger: true })) …

type Question = {
  title: string;
  text?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** The confirm button is red: the action removes something. */
  danger?: boolean;
};

let current: (Question & { resolve: (ok: boolean) => void }) | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function confirmAction(question: Question): Promise<boolean> {
  return new Promise((resolve) => {
    current?.resolve(false);
    current = { ...question, resolve };
    emit();
  });
}

function answer(ok: boolean) {
  current?.resolve(ok);
  current = null;
  emit();
}

/** Rendered once, at the root of the app. */
export function ConfirmHost() {
  const question = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
  return (
    <Sheet
      open={Boolean(question)}
      onClose={() => answer(false)}
      title={question?.title ?? ""}
      description={question?.text}
      footer={
        <>
          <Button variant="secondary" onClick={() => answer(false)}>
            {question?.cancelLabel ?? "Annuler"}
          </Button>
          <Button variant={question?.danger ? "danger" : "primary"} onClick={() => answer(true)}>
            {question?.confirmLabel ?? "Confirmer"}
          </Button>
        </>
      }
    />
  );
}
