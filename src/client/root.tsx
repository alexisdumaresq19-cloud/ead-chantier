"use client";

import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useEffect, useSyncExternalStore } from "react";
import { Toaster } from "sonner";

import { SIGNED_OUT_EVENT } from "./lib/api";
import {
  CACHE_MAX_AGE,
  CACHE_VERSION,
  dehydrateOptions,
  persister,
  queryClient,
} from "./lib/query";
import { handleSignedOut } from "./lib/session";
import { PwaHost } from "./pwa/host";
import { registerPwa } from "./pwa/register";
import { AppRoutes } from "./routes";
import { Splash } from "./shell/splash";
import { ConfirmHost } from "./ui/confirm";
import { ErrorBoundary } from "./ui/error-boundary";

// The whole app lives in the browser: the server sends this one shell for
// every address, and the screens are drawn here from the address bar.

const never = () => () => {};

export function AppRoot() {
  // The server cannot know which screen is asked for (it always renders "/"),
  // so it renders the splash and the browser takes over once mounted.
  const mounted = useSyncExternalStore(
    never,
    () => true,
    () => false,
  );

  useEffect(() => {
    window.addEventListener(SIGNED_OUT_EVENT, handleSignedOut);
    registerPwa();
    // Loaded apart from the first screen: it is only needed once photos wait.
    void import("./modules/photos/outbox").then((outbox) => outbox.startPhotoOutbox());
    return () => window.removeEventListener(SIGNED_OUT_EVENT, handleSignedOut);
  }, []);

  if (!mounted) return <Splash />;
  return (
    <ErrorBoundary>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: CACHE_MAX_AGE,
          buster: CACHE_VERSION,
          dehydrateOptions,
        }}
      >
        <AppRoutes />
        <ConfirmHost />
        <PwaHost />
        <Toaster
          position="top-center"
          richColors
          toastOptions={{ style: { fontFamily: "var(--font-sans)" } }}
        />
      </PersistQueryClientProvider>
    </ErrorBoundary>
  );
}
