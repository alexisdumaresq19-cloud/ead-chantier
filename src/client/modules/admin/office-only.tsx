import { Lock } from "lucide-react";

import { Page } from "../../shell/page";
import { ButtonLink, EmptyState } from "../../ui";

/** What an office screen shows to someone who is not of the office. */
export function OfficeOnly({ title }: { title: string }) {
  return (
    <Page title={title}>
      <EmptyState
        icon={Lock}
        title="Réservé au bureau"
        text="Cette page sert au bureau. Pour une demande, appelez le bureau ou votre contremaître."
        action={<ButtonLink href="/">Voir les projets</ButtonLink>}
      />
    </Page>
  );
}
