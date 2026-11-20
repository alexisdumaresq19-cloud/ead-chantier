#!/bin/bash
# Prepares the Xcode project (ios/) for a build: copies the pages the app
# carries itself (ios-shell/ into ios-shell/dist), then lets Capacitor write
# its settings and plugin list into ios/ ("npx cap sync ios"). Run it after
# any change to capacitor.config.ts, ios-shell/ or the @capacitor packages.
# The other ios-*.sh scripts run it themselves. Works on Linux too.
#   scripts/ios-sync.sh
set -euo pipefail
# shellcheck source=scripts/ios-common.sh
. "$(dirname "$0")/ios-common.sh"
cd "$ROOT"

command -v node >/dev/null 2>&1 || die "Node.js est introuvable." \
  "Lancez scripts/ios-doctor.sh${NB}: il dit quoi installer."
[ -x node_modules/.bin/cap ] || die "les modules du projet ne sont pas installés." \
  "Lancez npm ci à la racine du projet, puis relancez ce script."

# The version the web view announces must be the one the App Store shows.
version="$(sed -n 's/^const version = "\([^"]*\)";$/\1/p' capacitor.config.ts)"
project_version="$(marketing_version)"
# shellcheck disable=SC2016 # the text of the file, not an expansion
grep -qF 'appendUserAgent: `EADApp/${version}`,' capacitor.config.ts && [ -n "$version" ] || die \
  "capacitor.config.ts a changé de forme (const version, appendUserAgent)." \
  "Remettez const version = \"x.y.z\"; et appendUserAgent: \`EADApp/\${version}\`,"
[ "$version" = "$project_version" ] || die \
  "la version de capacitor.config.ts ($version) n'est pas celle du projet Xcode ($project_version)." \
  "Mettez la même dans les deux${NB}: const version dans capacitor.config.ts," \
  "MARKETING_VERSION dans ios/App/App.xcodeproj/project.pbxproj (Debug et Release)."

step "Pages de l'app (ios-shell)"
node ios-shell/build.mjs

step "Projet Xcode (npx cap sync ios)"
npx cap sync ios

for file in ios/App/App/capacitor.config.json ios/App/App/public/offline.html ios/App/CapApp-SPM/Package.swift; do
  [ -f "$file" ] || die "$file manque après la synchronisation." \
    "Lisez les messages de npx cap sync ci-dessus."
done
printf '\nProjet prêt%s: version %s, identifiant %s.\n' "$NB" "$version" "$(bundle_id)"
