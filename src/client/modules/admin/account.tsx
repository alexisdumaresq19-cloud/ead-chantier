import { useMutation } from "@tanstack/react-query";
import { LogOut } from "lucide-react";

import { signOut, useCurrentUser } from "../../lib/session";
import { InstallApp } from "../../pwa/install";
import { Page, Section } from "../../shell/page";
import { Avatar, Button, Card, confirmAction, FormError } from "../../ui";
import { DeviceList } from "./devices";
import { Meta } from "./meta";
import { roleAndTitle, signOutFailure } from "./people";

/** Who is signed in on this device, their other devices, and the way out. */
export function AccountScreen() {
  const me = useCurrentUser();
  const { role, title } = roleAndTitle(me);
  // signOut() changes nothing until the server has ended the session: on a
  // failure the device is still signed in, and the screen says so.
  const leave = useMutation({ mutationFn: () => signOut() });

  const askToLeave = async () => {
    const ok = await confirmAction({
      title: "Se déconnecter de cet appareil?",
      text: "Pour revenir, il faudra un nouveau lien du bureau ou le code QR d'un chantier.",
      confirmLabel: "Se déconnecter",
      danger: true,
    });
    if (ok) leave.mutate();
  };

  return (
    <Page title="Mon compte" narrow>
      <Card className="flex items-center gap-4 p-4">
        <Avatar name={me.name} className="size-14 text-lg" />
        <div className="min-w-0">
          <p className="font-display text-xl leading-tight font-bold wrap-anywhere">{me.name}</p>
          <Meta items={[role, title]} className="text-dim mt-1 text-[15px]" />
        </div>
      </Card>
      <p className="text-dim mt-2 px-1 text-sm">
        Une erreur dans votre nom? Le bureau peut la corriger.
      </p>

      {/* The install card decides by itself whether it has something to say. */}
      <div className="mt-8 empty:hidden">
        <InstallApp />
      </div>

      <Section title="Mes appareils">
        <DeviceList userId="me" empty="Aucun appareil connecté." />
        <p className="text-dim mt-2 px-1 text-sm text-pretty">
          Chaque appareil reste connecté, sans mot de passe. Déconnectez un appareil perdu ou que
          vous n&apos;utilisez plus.
        </p>
      </Section>

      <div className="mt-8 space-y-3">
        <Button
          variant="secondary"
          size="lg"
          block
          onClick={askToLeave}
          // Once the server has said yes, the page is on its way to the welcome screen.
          loading={leave.isPending || leave.isSuccess}
        >
          <LogOut aria-hidden /> Se déconnecter
        </Button>
        {leave.isError ? <FormError>{signOutFailure(leave.error)}</FormError> : null}
      </div>

      <p className="text-dim mt-10 text-center text-xs font-medium tracking-wide">EAD Chantier</p>
    </Page>
  );
}
