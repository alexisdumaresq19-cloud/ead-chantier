#!/bin/bash
# Checks that this Mac can build the iPhone app: macOS, Xcode (a version
# Apple still accepts for uploads), its command line tools, its license and
# first-launch components, an iPhone simulator, Node.js 22 or later, git and
# the project's modules. With --envoi it also checks what an upload to App
# Store Connect needs: the four ASC_* variables (from the environment or
# ~/.appstoreconnect/ead.env) and the key file, kept outside the repository. Prints a summary in French; fails if anything is
# missing, each line saying what to do.
#   scripts/ios-doctor.sh            before a build in the Simulator
#   scripts/ios-doctor.sh --envoi    before scripts/ios-release.sh
set -euo pipefail
# shellcheck source=scripts/ios-common.sh
. "$(dirname "$0")/ios-common.sh"
cd "$ROOT"

# The oldest Xcode whose builds App Store Connect accepts: since April 2026,
# apps must be built with Xcode 26 (iOS 26 SDK) or later. Apple raises it
# about once a year: https://developer.apple.com/news/upcoming-requirements/
# (read on 2026-11-20: "built with Xcode 26 or later", since April 28, 2026).
MIN_XCODE=26
MIN_NODE=22

UPLOAD=""
case "${1:-}" in
  "") ;;
  --envoi) UPLOAD=1 ;;
  *) die "option inconnue${NB}: $1" "Usage${NB}: scripts/ios-doctor.sh [--envoi]" ;;
esac

PROBLEMS=0
ok() { printf '  OK       %s\n' "$1"; }
todo() {
  PROBLEMS=$((PROBLEMS + 1))
  printf '  À FAIRE  %s\n' "$1"
  shift
  for line in "$@"; do printf '           %s\n' "$line"; done
}

printf "Vérification du Mac pour l'app iPhone EAD\n\n"

# macOS
if [ "$(uname -s)" = "Darwin" ]; then
  ok "macOS $(sw_vers -productVersion)"
else
  todo "Ce script vérifie un Mac. Cette machine n'en est pas un." \
    "Xcode et le simulateur n'existent que sur macOS."
  printf '\n%s point(s) à régler.\n' "$PROBLEMS"
  exit 1
fi

# Xcode itself, chosen as the active developer folder.
developer_dir="$(xcode-select -p 2>/dev/null || true)"
if [ -z "$developer_dir" ] || ! command -v xcodebuild >/dev/null 2>&1; then
  todo "Xcode est introuvable." "Installez Xcode depuis l'App Store du Mac, ouvrez-le une fois, puis relancez."
elif printf '%s' "$developer_dir" | grep -q CommandLineTools; then
  todo "Seuls les outils en ligne de commande sont actifs, sans Xcode." \
    "Installez Xcode depuis l'App Store du Mac, puis${NB}: sudo xcode-select -s /Applications/Xcode.app" \
      "$SUDO_HINT"
else
  xcode_line="$(xcodebuild -version 2>/dev/null | head -n 1 || true)"
  xcode_version="$(printf '%s' "$xcode_line" | sed -n 's/^Xcode \([0-9][0-9.]*\)$/\1/p')"
  xcode_major="${xcode_version%%.*}"
  if [ -z "$xcode_major" ]; then
    todo "Xcode ne répond pas (xcodebuild -version)." \
      "Ouvrez Xcode une fois pour finir son installation, puis relancez."
  elif [ "$xcode_major" -lt "$MIN_XCODE" ]; then
    todo "Xcode $xcode_version est trop ancien${NB}: Apple refuse les envois faits avant Xcode $MIN_XCODE." \
      "Mettez Xcode à jour dans l'App Store du Mac."
  else
    ok "Xcode $xcode_version ($developer_dir)"
  fi

  if xcodebuild -license check >/dev/null 2>&1; then
    ok "Licence d'Xcode acceptée"
  else
    todo "La licence d'Xcode n'est pas acceptée." "Lancez${NB}: sudo xcodebuild -license accept" "$SUDO_HINT"
  fi

  if xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then
    ok "Composants du premier lancement d'Xcode installés"
  else
    todo "Les composants du premier lancement d'Xcode manquent." "Lancez${NB}: sudo xcodebuild -runFirstLaunch" "$SUDO_HINT"
  fi

  if xcrun --find simctl >/dev/null 2>&1; then
    ok "Outils en ligne de commande d'Xcode (xcrun, simctl)"
  else
    todo "Les outils en ligne de commande d'Xcode ne répondent pas." \
      "Lancez${NB}: sudo xcode-select -s /Applications/Xcode.app" "$SUDO_HINT"
  fi

  runtime="$(xcrun simctl list runtimes 2>/dev/null | grep '^iOS ' | grep -v unavailable | tail -n 1 || true)"
  if [ -z "$runtime" ]; then
    todo "Aucun simulateur iOS n'est installé." \
      "Lancez${NB}: xcodebuild -downloadPlatform iOS (plusieurs Go, prévoir du temps)."
  elif ! xcrun simctl list devices available 2>/dev/null | grep -q 'iPhone'; then
    todo "Aucun iPhone dans les simulateurs." \
      "Dans Xcode${NB}: Window > Devices and Simulators > Simulators > +, choisir un iPhone."
  else
    ok "Simulateur ${runtime%% (*}"
  fi
fi

# Node.js, for the site's tools and Capacitor.
if command -v node >/dev/null 2>&1; then
  node_version="$(node -v | sed 's/^v//')"
  if [ "${node_version%%.*}" -ge "$MIN_NODE" ]; then
    ok "Node.js $node_version"
  else
    todo "Node.js $node_version est trop ancien (il faut $MIN_NODE ou plus)." \
      "Installez la version LTS depuis https://nodejs.org (paquet pour macOS), puis relancez."
  fi
else
  todo "Node.js est introuvable." "Installez la version LTS depuis https://nodejs.org (paquet pour macOS), puis relancez."
fi

if command -v git >/dev/null 2>&1; then
  ok "git $(git --version | sed 's/^git version //')"
else
  todo "git est introuvable." "Il vient avec les outils d'Xcode${NB}: xcode-select --install"
fi

if [ -x node_modules/.bin/cap ]; then
  ok "Modules du projet installés"
else
  todo "Les modules du projet ne sont pas installés." "Lancez${NB}: npm ci"
fi

if [ -n "$UPLOAD" ]; then
  printf '\nEnvoi vers App Store Connect\n\n'

  load_asc_env
  if [ -f "$ASC_ENV_FILE" ]; then
    env_mode="$(stat -f '%Lp' "$ASC_ENV_FILE" 2>/dev/null || true)"
    if [ "$env_mode" = "600" ] || [ "$env_mode" = "400" ]; then
      ok "Réglages de la clé dans $ASC_ENV_FILE"
    else
      todo "Le fichier $ASC_ENV_FILE est lisible par d'autres comptes du Mac." \
        "Lancez${NB}: chmod 600 \"$ASC_ENV_FILE\""
    fi
  fi

  check_var() {
    local name="$1" pattern="$2" hint="$3" value
    eval "value=\"\${$name:-}\""
    if [ -z "$value" ]; then
      todo "La variable $name n'est pas définie." "$hint" \
        "Ajoutez la ligne export $name=… dans $ASC_ENV_FILE (docs/ios/MAC.md, étape 4.3), puis relancez."
    elif ! printf '%s' "$value" | grep -Eq "$pattern"; then
      todo "La variable $name n'a pas la bonne forme." "$hint"
    else
      ok "$name"
    fi
  }
  check_var ASC_KEY_ID '^[A-Z0-9]{10}$' \
    "Key ID de la clé d'API (10 caractères), App Store Connect > Utilisateurs et accès > Intégrations."
  check_var ASC_ISSUER_ID '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' \
    "Issuer ID, affiché au-dessus de la liste des clés, même page."
  check_var ASC_TEAM_ID '^[A-Z0-9]{10}$' \
    "Team ID (10 caractères), developer.apple.com > Account > Membership details."
  check_var ASC_KEY_PATH '\.p8$' \
    "Chemin complet du fichier AuthKey_….p8, par exemple ~/.appstoreconnect/private_keys/AuthKey_XXXXXXXXXX.p8"

  key="${ASC_KEY_PATH:-}"
  if [ -n "$key" ]; then
    if [ ! -f "$key" ]; then
      todo "Le fichier de clé $key n'existe pas." \
        "Placez le fichier .p8 téléchargé dans ~/.appstoreconnect/private_keys/ (docs/ios/MAC.md, étape 4.3)."
    else
      key_dir="$(cd "$(dirname "$key")" && pwd -P)"
      case "$key_dir/" in
        "$(pwd -P)/"*)
          todo "La clé est dans le dépôt, où elle ne doit jamais être." \
            "Déplacez-la dans ~/.appstoreconnect/private_keys/ et corrigez ASC_KEY_PATH." ;;
        *)
          mode="$(stat -f '%Lp' "$key" 2>/dev/null || true)"
          if [ "$mode" = "600" ] || [ "$mode" = "400" ]; then
            ok "Clé d'API hors du dépôt, lisible par vous seul"
          else
            todo "La clé est lisible par d'autres comptes du Mac." "Lancez${NB}: chmod 600 \"$key\""
          fi ;;
      esac
    fi
  fi

  if [ -n "$(git ls-files '*.p8' '*.p12' '*.mobileprovision' 2>/dev/null)" ]; then
    todo "Un fichier de clé ou de profil est suivi par git." \
      "Retirez-le du dépôt (git rm --cached) et prévenez le propriétaire${NB}: la clé doit être révoquée."
  else
    ok "Aucune clé dans le dépôt"
  fi
fi

printf '\n'
if [ "$PROBLEMS" -eq 0 ]; then
  printf 'Tout est prêt.\n'
else
  printf "%s point(s) à régler, dans l'ordre ci-dessus. Relancez ensuite ce script.\n" "$PROBLEMS"
  exit 1
fi
