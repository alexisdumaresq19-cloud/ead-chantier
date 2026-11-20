import { forbidden } from "../http";

// What the demonstration account may change on its projects. It is a
// foreman, so that its visitor sees the whole app, and anyone the office
// handed the code to can reach it: it adds (photos, documents, reports) and
// changes what it added itself, never what someone of the team wrote, and
// never the plans. The routes that touch the team refuse it too
// (src/server/people/links.ts).

type Visitor = { id: string; demo: boolean };

export const DEMO_OWN_ONLY =
  "Le compte de démonstration modifie seulement ce qu'il a ajouté lui-même.";
export const DEMO_PLANS = "Le compte de démonstration consulte les plans sans les modifier.";

/** Refuses the demonstration account a change to what someone else made. */
export function refuseDemoUnlessAuthor(user: Visitor, authorId: string | null) {
  if (user.demo && authorId !== user.id) throw forbidden(DEMO_OWN_ONLY);
}

/** Refuses the demonstration account any change to the plans. */
export function refuseDemoOnPlans(user: Visitor) {
  if (user.demo) throw forbidden(DEMO_PLANS);
}
