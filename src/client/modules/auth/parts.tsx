import type { FormEvent, ReactNode } from "react";

// What the screens seen before signing in share.

/** What a name needs before it is sent: the server asks for two letters at least. */
export const NAME_MISSING = "Inscrivez votre prénom et votre nom.";
export const nameMissing = (name: string) => name.trim().length < 2;

/** Puts the cursor in the field that needs something, with its message under it. */
export function focusField(event: FormEvent<HTMLFormElement>, name: string) {
  focusNamed(event.currentTarget, name);
}

export function focusNamed(form: HTMLFormElement | null, name: string) {
  const field = form?.elements.namedItem(name);
  if (field instanceof HTMLElement) field.focus();
}

export function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <h1 className="font-display text-2xl leading-tight font-bold tracking-tight text-balance">
        {title}
      </h1>
      {children ? <div className="text-dim mt-2 text-[15px] text-pretty">{children}</div> : null}
    </>
  );
}
