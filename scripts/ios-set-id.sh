#!/bin/bash
# Changes the iPhone app's bundle identifier (today ca.allendumaresq.ead)
# everywhere the repository names it: capacitor.config.ts, the Xcode project,
# .env.example, the tests and the guides. Only before the first upload: once
# a build is in App Store Connect, the app's identifier is fixed for good.
# Refuses on a tree with uncommitted changes, so the change is one clear commit.
#   scripts/ios-set-id.sh ca.example.nouveau
set -euo pipefail
# shellcheck source=scripts/ios-common.sh
. "$(dirname "$0")/ios-common.sh"
cd "$ROOT"

NEW="${1:-}"
[ -n "$NEW" ] || die "il manque le nouvel identifiant." "Usage${NB}: scripts/ios-set-id.sh ca.exemple.app"
printf '%s' "$NEW" | grep -Eq '^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)+$' || die \
  "«${NB}$NEW${NB}» n'est pas un identifiant valide." \
  "Lettres, chiffres et traits d'union, en parties séparées par des points, par exemple ca.exemple.app"

OLD="$(bundle_id)"
[ "$OLD" != "$NEW" ] || die "l'identifiant est déjà $NEW."

if [ -n "$(git status --porcelain)" ]; then
  git status --short >&2
  die "des fichiers ont changé sans être enregistrés dans git." \
    "Faites un commit (ou annulez ces changements), puis relancez."
fi

FILES="$(git grep -l -I -F -e "$OLD" || true)"
[ -n "$FILES" ] || die "aucun fichier ne nomme $OLD."

step "Remplacement de $OLD par $NEW"
printf '%s\n' "$FILES" | while IFS= read -r file; do
  OLD="$OLD" NEW="$NEW" perl -pi -e 's/\Q$ENV{OLD}\E/$ENV{NEW}/g' "$file"
  echo "  $file"
done

[ -z "$(git grep -l -I -F -e "$OLD" || true)" ] || die "$OLD est encore nommé quelque part${NB}: git grep -F $OLD"
[ "$(bundle_id)" = "$NEW" ] || die "capacitor.config.ts n'a pas pris le nouvel identifiant."

cat <<DONE

Identifiant changé${NB}: $NEW. Il reste à
  1. lancer npm test, puis scripts/ios-sync.sh;
  2. faire un commit de ces fichiers;
  3. sur Vercel, mettre IOS_APP_ID à TEAMID.$NEW (si la variable existe déjà);
  4. créer l'identifiant et l'app dans les sites d'Apple avec $NEW (docs/ios/MAC.md).
DONE
