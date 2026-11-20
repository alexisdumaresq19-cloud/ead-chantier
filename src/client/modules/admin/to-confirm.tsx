import { useMutation } from "@tanstack/react-query";
import { Phone, ShieldAlert, ShieldCheck, UserX } from "lucide-react";

import { api, errorMessage } from "../../lib/api";
import { Avatar, Button, Card, confirmAction, toast } from "../../ui";
import { refreshPeople, type TeamMember } from "./data";
import { accessEndText, formatPhone, scannedText, telHref, UNREVIEWED_RULE } from "./people";

// Workers who came in with the site's QR code, for the foreman (or the
// office) to confirm or refuse, before the rest of the team.

type Decision = "confirm" | "refuse";

export function ToConfirm({ projectId, people }: { projectId: string; people: TeamMember[] }) {
  const review = useMutation({
    mutationFn: ({ member, decision }: { member: TeamMember; decision: Decision }) =>
      api<{ deactivated: boolean }>(`/api/projects/${projectId}/members/${member.id}/review`, {
        method: "POST",
        body: { decision },
      }),
    onSuccess: ({ deactivated }, { member, decision }) =>
      toast.success(
        decision === "confirm"
          ? `Accès confirmé pour ${member.name}`
          : deactivated
            ? `${member.name} n'a plus accès à l'application`
            : `${member.name} ne fait plus partie du projet`,
      ),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: refreshPeople,
  });

  const refuse = async (member: TeamMember) => {
    const ok = await confirmAction({
      title: `Refuser ${member.name}?`,
      text: "Cette personne quitte le projet. Si elle n'est sur aucun autre projet, son accès est coupé et son téléphone est déconnecté sur-le-champ. Si elle a gardé le code QR, créez un nouveau code.",
      confirmLabel: "Refuser",
      danger: true,
    });
    if (ok) review.mutate({ member, decision: "refuse" });
  };

  const busy = (member: TeamMember, decision: Decision) =>
    review.isPending &&
    review.variables.member.id === member.id &&
    review.variables.decision === decision;

  return (
    <section className="mb-8" aria-labelledby="to-confirm">
      <h2
        id="to-confirm"
        className="font-display text-dim mb-3 text-sm font-bold tracking-wider uppercase"
      >
        À confirmer ({people.length})
      </h2>
      <p className="bg-warn-tint text-warn mb-3 flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[15px] text-pretty">
        <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
        <span>
          {people.length > 1
            ? "Ces personnes sont entrées avec le code QR du chantier. Confirmez celles que vous connaissez."
            : "Cette personne est entrée avec le code QR du chantier. Confirmez-la si vous la connaissez."}{" "}
          {UNREVIEWED_RULE}
        </span>
      </p>
      <Card className="overflow-hidden">
        <ul className="divide-line divide-y">
          {people.map((member) => {
            const tel = member.phone ? telHref(member.phone) : null;
            return (
              <li
                key={member.id}
                className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:px-4"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Avatar name={member.name} />
                  <div className="min-w-0">
                    <p className="font-semibold wrap-anywhere">{member.name}</p>
                    {member.phone ? (
                      tel ? (
                        <a
                          href={tel}
                          // A thumb-sized target around a line of text.
                          className="text-ead-dark -my-2.5 inline-flex items-center gap-1.5 py-2.5 text-sm font-semibold"
                        >
                          <Phone className="size-4" aria-hidden />
                          {formatPhone(member.phone)}
                        </a>
                      ) : (
                        <p className="text-dim text-sm wrap-anywhere">{member.phone}</p>
                      )
                    ) : null}
                    {member.scannedAt ? (
                      <p className="text-dim text-sm">
                        {scannedText(member.scannedAt)} · {accessEndText(member.scannedAt)}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
                  <Button
                    variant="secondary"
                    onClick={() => refuse(member)}
                    loading={busy(member, "refuse")}
                    disabled={review.isPending}
                    aria-label={`Refuser ${member.name}`}
                  >
                    <UserX aria-hidden /> Refuser
                  </Button>
                  <Button
                    onClick={() => review.mutate({ member, decision: "confirm" })}
                    loading={busy(member, "confirm")}
                    disabled={review.isPending}
                    aria-label={`Confirmer ${member.name}`}
                  >
                    <ShieldCheck aria-hidden /> Confirmer
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
