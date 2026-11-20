import { useMutation } from "@tanstack/react-query";
import { Monitor, Smartphone, Tablet } from "lucide-react";

import type { Device } from "@/shared/api";

import { api, errorMessage } from "../../lib/api";
import { formatAgo } from "../../lib/format";
import { queryClient } from "../../lib/query";
import { Badge, Button, Card, confirmAction, QueryState, Skeleton, toast } from "../../ui";
import { adminKeys, useDevices } from "./data";

const deviceIcon = (label: string | null) =>
  /Ordinateur|Mac/.test(label ?? "")
    ? Monitor
    : /iPad|Tablette/.test(label ?? "")
      ? Tablet
      : Smartphone;

/** "Utilisé aujourd'hui", "Utilisé le 1 septembre 2026". */
function lastUse(device: Device): string {
  const ago = formatAgo(device.lastSeenAt);
  return /^\d/.test(ago) ? `Utilisé le ${ago}` : `Utilisé ${ago}`;
}

/**
 * The devices signed in as someone ("me" for one's own), each with a way to
 * sign it out, in a card. The device in hand is only marked: leaving it is
 * "Se déconnecter", on the account screen.
 */
export function DeviceList({
  userId,
  empty,
}: {
  userId: string;
  /** What to say when no device is signed in. */
  empty: string;
}) {
  const devices = useDevices(userId);
  const disconnect = useMutation({
    mutationFn: (device: Device) => api(`/api/sessions/${device.id}`, { method: "DELETE" }),
    onSuccess: () => toast.success("Appareil déconnecté"),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.devices(userId) }),
        queryClient.invalidateQueries({ queryKey: adminKeys.people }),
      ]),
  });

  const ask = async (device: Device) => {
    const ok = await confirmAction({
      title: "Déconnecter cet appareil?",
      text: `${device.label ?? "Cet appareil"} ne pourra plus ouvrir l'application. Pour y revenir, il faudra un nouveau lien du bureau ou le code QR d'un chantier.`,
      confirmLabel: "Déconnecter",
      danger: true,
    });
    if (ok) disconnect.mutate(device);
  };

  return (
    <QueryState query={devices} loading={<Skeleton className="h-[4.5rem]" />}>
      {(list) =>
        list.length === 0 ? (
          <Card className="p-4">
            <p className="text-dim text-[15px] text-pretty">{empty}</p>
          </Card>
        ) : (
          <Card className="px-4 py-1">
            <ul className="divide-line divide-y">
              {list.map((device) => {
                const Icon = deviceIcon(device.label);
                return (
                  <li key={device.id} className="flex items-start gap-3 py-3">
                    <span className="bg-canvas text-dim flex size-10 shrink-0 items-center justify-center rounded-xl">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    {/* Where the name leaves no room beside it, the button goes under it. */}
                    <div className="flex min-h-10 min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
                          {device.label ?? "Appareil"}
                          {device.current ? <Badge tone="blue">Cet appareil</Badge> : null}
                        </p>
                        <p className="text-dim text-sm">{lastUse(device)}</p>
                      </div>
                      {device.current ? null : (
                        <Button
                          variant="secondary"
                          onClick={() => ask(device)}
                          loading={disconnect.isPending && disconnect.variables?.id === device.id}
                        >
                          Déconnecter
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )
      }
    </QueryState>
  );
}
