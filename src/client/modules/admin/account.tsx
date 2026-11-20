import { useMutation } from "@tanstack/react-query";
import { LogOut } from "lucide-react";

import { ROLE_LABELS } from "@/shared/roles";

import { api, errorMessage } from "../../lib/api";
import { useOnline } from "../../lib/online";
import { signOut, useCurrentUser } from "../../lib/session";
import { InstallApp } from "../../pwa/install";
import { Page, Section } from "../../shell/page";
import { Avatar, Button, Card, toast } from "../../ui";
import { DeviceList } from "./devices";
import { confirmCalmly } from "./second-tap";
import { forgetSiteCodes } from "./site-code";

/** Who is signed in on this device, their other devices, and the way out. */
export function AccountScreen() {
  const me = useCurrentUser();
  const online = useOnline();
  const leave = useMutation({
    mutationFn: async () => {
      // signOut() carries on even when the server could not be reached. The
      // session is ended here first, so a device never looks signed out
      // while its session lives on.
      await api("/api/logout", { method: "POST" });
      forgetSiteCodes();
      await signOut();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const askToLeave = async () => {
    const ok = await confirmCalmly({
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
          <p className="text-dim mt-1 text-[15px]">
            {[ROLE_LABELS[me.role], me.title].filter(Boolean).join(" · ")}
          </p>
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
        <Card className="p-4">
          <DeviceList userId="me" empty="Aucun appareil connecté." />
        </Card>
        <p className="text-dim mt-2 px-1 text-sm text-pretty">
          Chaque appareil reste connecté, sans mot de passe. Déconnectez un appareil perdu ou que
          vous n&apos;utilisez plus.
        </p>
      </Section>

      <div className="mt-8">
        <Button
          variant="secondary"
          size="lg"
          block
          onClick={askToLeave}
          loading={leave.isPending || leave.isSuccess}
          disabled={!online}
        >
          <LogOut aria-hidden /> Se déconnecter
        </Button>
        {online ? null : (
          <p className="text-dim mt-2 text-center text-sm">
            Il faut du réseau pour se déconnecter.
          </p>
        )}
      </div>

      <p className="text-dim mt-10 text-center text-xs font-medium tracking-wide">EAD Chantier</p>
    </Page>
  );
}
