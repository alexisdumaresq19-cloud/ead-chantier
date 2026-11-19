import { Page } from "../../shell/page";

const soon = (title: string) =>
  function Screen() {
    return (
      <Page title={title}>
        <p className="text-dim">À venir.</p>
      </Page>
    );
  };

export const NewProjectScreen = soon("Nouveau projet");
export const ProjectSettingsScreen = soon("Réglages du projet");
export const ProjectTeamScreen = soon("Équipe du projet");
export const TeamScreen = soon("Équipe");
export const AccountScreen = soon("Mon compte");
