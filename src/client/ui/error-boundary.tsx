import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "./button";

/** Keeps a crash in one screen from leaving a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="bg-canvas flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <h1 className="font-display text-2xl font-bold">Une erreur est survenue</h1>
        <p className="text-dim mt-2 max-w-sm">
          Rechargez la page. Sans réseau, certaines pages jamais ouvertes sur cet appareil ne
          peuvent pas s&apos;afficher.
        </p>
        <div className="mt-6 flex gap-2">
          <Button variant="secondary" onClick={() => window.location.assign("/")}>
            Retour aux projets
          </Button>
          <Button onClick={() => window.location.reload()}>Recharger</Button>
        </div>
      </div>
    );
  }
}
