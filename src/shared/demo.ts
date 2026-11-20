// What the demonstration account may change, as the screens decide it before
// offering a control. It mirrors the server's rule
// (src/server/access-code/rules.ts: refuseDemoUnlessAuthor, refuseDemoOnPlans),
// which decides again on every request: a control offered here and refused
// there is the one thing Apple's reviewer must never meet. For every other
// account both answer yes, and the screens keep their own checks (the
// project's canChange, a report's canDelete).

type Visitor = { id: string; demo?: boolean };

/** Whether this person may change or remove a record that `authorId` added. */
export const mayChangeAddedBy = (me: Visitor, authorId: string | null) =>
  !me.demo || authorId === me.id;

/** Whether this person may change the plans at all: import, publish, rename, move, archive, folders. */
export const mayEditPlans = (me: Visitor) => !me.demo;
