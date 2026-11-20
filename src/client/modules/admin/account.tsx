import { useMutation } from "@tanstack/react-query";
import { LogOut, UserRoundX } from "lucide-react";

import { isAdmin } from "@/shared/roles";

import { api, errorMessage } from "../../lib/api";
import { signOut, useCurrentUser } from "../../lib/session";
import { InstallApp } from "../../pwa/install";
import { Page, Section } from "../../shell/page";
import { Avatar, Button, Card, confirmAction, FormError } from "../../ui";
import { usePeople } from "./data";
import { DeviceList } from "./devices";
import { Meta } from "./meta";
import { LAST_OFFICE_TEXT, roleAndTitle, signOutFailure } from "./people";

/**
 * Deletes the account, then lets go of this device. The server has already
 * signed every device out: if signing this one out fails on the way (the
 * network dropped), the welcome screen is opened all the same.
 */
async function deleteAccount() {
  await api("/api/me", { method: "DELETE" });
  try {
    await signOut();
  } catch {
    window.location.assign("/bienvenue");
  }
}

/** Who is signed in on this device, their other devices, the way out, and deleting the account. */
export function AccountScreen() {
  const me = useCurrentUser();
  const { role, title } = roleAndTitle(me);
  // signOut() changes nothing until the server has ended the session: on a
  // failure the device is still signed in, and the screen says so.
  const leave = useMutation({ mutationFn: () => signOut() });

  const remove = useMutation({ mutationFn: deleteAccount });
  // The last active office account cannot be deleted (the server refuses it
  // too): it is said before anything is asked, with what to do instead.
  const office = isAdmin(me.role);
  const people = usePeople({ enabled: office });
  const lastOffice =
    office &&
    people.data !== undefined &&
    !people.data.some((person) => person.id !== me.id && person.role === "admin" && person.active);
  const askToRemove = async () => {
    const ok = await confirmAction({
      title: "Supprimer votre compte?",
      text: "C'est immédiat et définitif. Vos appareils sont déconnectés, et votre numéro, vos liens et vos accès aux chantiers sont effacés. Les rapports, les photos et les documents que vous avez ajoutés restent à l'entreprise, avec votre nom.",
      confirmLabel: "Supprimer mon compte",
      danger: true,
    });
    if (ok) remove.mutate();
  };

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

      <Section title="Supprimer mon compte" className="mt-10">
        <Card className="p-4">
          {lastOffice ? (
            <p className="text-dim text-[15px] text-pretty">{LAST_OFFICE_TEXT}</p>
          ) : (
            <>
              <p className="text-dim text-[15px] text-pretty">
                Vous n&apos;utilisez plus l&apos;application? Supprimez votre compte. Ce que vous
                avez ajouté aux chantiers reste à l&apos;entreprise, avec votre nom. Pour revenir,
                il faudra un nouveau compte.
              </p>
              <Button
                variant="secondary"
                block
                className="text-bad mt-3"
                onClick={askToRemove}
                loading={remove.isPending || remove.isSuccess}
              >
                <UserRoundX aria-hidden /> Supprimer mon compte
              </Button>
              {remove.isError ? (
                <div className="mt-3">
                  <FormError>{errorMessage(remove.error)}</FormError>
                </div>
              ) : null}
            </>
          )}
        </Card>
      </Section>

      <p className="text-dim mt-10 text-center text-xs font-medium tracking-wide">EAD Chantier</p>
    </Page>
  );
}
