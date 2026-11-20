# shellcheck shell=bash
# What the scripts/ios-*.sh scripts share: where things are, how to stop with
# a message the owner can act on. Sourced, never run. Written for the bash
# 3.2 that macOS ships (no associative arrays, no ${x,,}, no mapfile).
# shellcheck disable=SC2034 # the variables are read by the scripts that source this file

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$ROOT/ios/App/App.xcodeproj"
PBXPROJ="$PROJECT/project.pbxproj"
# What the scripts build lands here (ignored by git).
BUILD_DIR="$ROOT/ios/App/build"
# French typography: a non-breaking space before a colon.
NB=$'\302\240'

# Stops with a message that says what to do, on stderr, in French.
die() {
  printf '\n%s\n' "ARRÊT${NB}: $1" >&2
  shift
  for line in "$@"; do printf '  %s\n' "$line" >&2; done
  exit 1
}

# Said with every command the doctor suggests that needs the Mac's password:
# sudo cannot ask for it through Claude Code, which has no terminal.
SUDO_HINT="Commande avec sudo${NB}: le propriétaire la colle dans une autre fenêtre de Terminal (Commande + N) et tape le mot de passe du Mac."

# The App Store Connect key's settings (ASC_KEY_PATH, ASC_KEY_ID,
# ASC_ISSUER_ID, ASC_TEAM_ID) live in this file outside the repository, and
# ~/.zshrc reads it. The scripts read it too, because a command run by Claude
# Code does not see what was added to ~/.zshrc after its session started.
ASC_ENV_FILE="${ASC_ENV_FILE:-$HOME/.appstoreconnect/ead.env}"
load_asc_env() {
  if [ -f "$ASC_ENV_FILE" ]; then
    # shellcheck source=/dev/null
    . "$ASC_ENV_FILE"
  fi
}

step() { printf '\n== %s\n' "$1"; }

require_mac() {
  [ "$(uname -s)" = "Darwin" ] || die "ce script se lance sur un Mac, avec Xcode." \
    "Sur une autre machine, seul scripts/ios-sync.sh fonctionne."
}

# The value of a one-line string setting in capacitor.config.ts.
config_value() {
  sed -n "s/^ *$1: \"\\([^\"]*\\)\",\$/\\1/p" "$ROOT/capacitor.config.ts" | head -n 1
}

# The bundle identifier: capacitor.config.ts (appId), which ios-set-id.sh
# keeps equal to the Xcode project's.
bundle_id() {
  local id
  id="$(config_value appId)"
  [ -n "$id" ] || die "identifiant de l'app introuvable dans capacitor.config.ts (appId)." \
    "Remettez la ligne appId: \"…\", dans ce fichier."
  printf '%s' "$id"
}

# The version the App Store shows (MARKETING_VERSION of the Xcode project).
marketing_version() {
  sed -n 's/^[[:space:]]*MARKETING_VERSION = \([^;]*\);$/\1/p' "$PBXPROJ" | sort -u
}
