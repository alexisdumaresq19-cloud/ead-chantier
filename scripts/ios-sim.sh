#!/bin/bash
# Builds the iPhone app for the Simulator (debug, unsigned), starts an
# iPhone simulator, installs the app, opens it, optionally at another
# address of the site than its home (debug builds only, through the
# EAD_START_PATH launch variable read by EADViewController.swift), waits for
# the page, and saves a screenshot.
#   scripts/ios-sim.sh                                      the home screen
#   scripts/ios-sim.sh /diagnostic ios/App/build/diag.png  an address, a screenshot
# Settings (optional): EAD_SIM_DEVICE="iPhone 17" chooses the simulator,
# EAD_SIM_WAIT=12 the seconds to wait before the screenshot (8 by default).
set -euo pipefail
# shellcheck source=scripts/ios-common.sh
. "$(dirname "$0")/ios-common.sh"
require_mac
cd "$ROOT"

START_PATH="${1:-}"
SHOT="${2:-}"
WAIT="${EAD_SIM_WAIT:-8}"
if [ -n "$START_PATH" ] && [ "${START_PATH#/}" = "$START_PATH" ]; then
  die "l'adresse doit commencer par /, par exemple /diagnostic." \
    "Usage${NB}: scripts/ios-sim.sh [/adresse] [capture.png]"
fi
if [ -n "$SHOT" ]; then
  case "$SHOT" in
    *.png) ;;
    *) die "la capture doit être un fichier .png${NB}: $SHOT" ;;
  esac
  mkdir -p "$(dirname "$SHOT")"
fi
case "$WAIT" in
  '' | *[!0-9]*) die "EAD_SIM_WAIT doit être un nombre de secondes${NB}: $WAIT" ;;
esac

APP_ID="$(bundle_id)"

"$ROOT/scripts/ios-sync.sh"

# The simulator: the one named by EAD_SIM_DEVICE, else the first iPhone of
# the newest iOS installed. Lines look like
#   -- iOS 26.1 --
#       iPhone 17 Pro (5A1F…-…) (Shutdown)
step "Simulateur"
devices="$(xcrun simctl list devices available)"
if [ -n "${EAD_SIM_DEVICE:-}" ]; then
  line="$(printf '%s\n' "$devices" | grep -F "    $EAD_SIM_DEVICE (" | tail -n 1 || true)"
  [ -n "$line" ] || die "aucun simulateur nommé «${NB}$EAD_SIM_DEVICE${NB}»." \
    "Les noms disponibles${NB}: xcrun simctl list devices available"
else
  line="$(printf '%s\n' "$devices" | awk '
    /^-- iOS / { group = ""; ios = 1; next }
    /^-- / { ios = 0; next }
    ios && /^ +iPhone/ && group == "" { group = $0 }
    ios && group != "" { last = group }
    END { print last }')"
  [ -n "$line" ] || die "aucun simulateur d'iPhone." "Lancez scripts/ios-doctor.sh${NB}: il dit quoi installer."
fi
UDID="$(printf '%s' "$line" | sed -n 's/.*(\([0-9A-F-]\{36\}\)).*/\1/p')"
NAME="$(printf '%s' "$line" | sed 's/^ *//; s/ (.*$//')"
[ -n "$UDID" ] || die "identifiant du simulateur illisible dans${NB}: $line"
printf '%s (%s)\n' "$NAME" "$UDID"

step "Compilation pour le simulateur"
mkdir -p "$BUILD_DIR"
LOG="$BUILD_DIR/sim-build.log"
if ! xcodebuild -project "$PROJECT" -scheme App -configuration Debug \
  -sdk iphonesimulator -destination "id=$UDID" \
  -derivedDataPath "$BUILD_DIR/sim" \
  CODE_SIGNING_ALLOWED=NO \
  build >"$LOG" 2>&1; then
  grep -E 'error:|fatal' "$LOG" | sort -u | head -n 30 >&2 || true
  die "la compilation a échoué." "Le journal complet${NB}: $LOG" \
    "docs/ios/MAC.md, «${NB}Dépannage${NB}», décrit les erreurs les plus probables."
fi
APP="$BUILD_DIR/sim/Build/Products/Debug-iphonesimulator/App.app"
[ -d "$APP" ] || die "l'app compilée est introuvable${NB}: $APP"
echo "Compilée${NB}: $APP"

step "Démarrage du simulateur"
if ! xcrun simctl list devices | grep -F "($UDID) (Booted)" >/dev/null; then
  xcrun simctl boot "$UDID"
fi
open -a Simulator
xcrun simctl bootstatus "$UDID" -b >/dev/null
# A clean status bar for the screenshot.
xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 \
  --cellularBars 4 --wifiBars 3 >/dev/null 2>&1 || true

step "Installation et ouverture"
xcrun simctl terminate "$UDID" "$APP_ID" >/dev/null 2>&1 || true
xcrun simctl install "$UDID" "$APP"
if [ -n "$START_PATH" ]; then
  SIMCTL_CHILD_EAD_START_PATH="$START_PATH" xcrun simctl launch "$UDID" "$APP_ID" >/dev/null
  echo "Ouverte à l'adresse $START_PATH"
else
  xcrun simctl launch "$UDID" "$APP_ID" >/dev/null
  echo "Ouverte"
fi

if [ -n "$SHOT" ]; then
  echo "Attente de $WAIT secondes pour la page…"
  sleep "$WAIT"
  xcrun simctl io "$UDID" screenshot "$SHOT" >/dev/null
  printf '\nCapture enregistrée%s: %s\n' "$NB" "$SHOT"
fi
