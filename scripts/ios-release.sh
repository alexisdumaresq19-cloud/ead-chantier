#!/bin/bash
# Builds the iPhone app for the App Store and uploads it to App Store
# Connect, where it appears in TestFlight once Apple has processed it. It
# submits nothing for review and publishes nothing: that is done by hand, in
# App Store Connect, only when the owner says so.
#
# Signing is automatic: Xcode creates or renews the certificate and the
# profile with the App Store Connect API key (-allowProvisioningUpdates).
# Everything secret or personal comes from the environment, never from the
# repository (docs/ios/MAC.md, step 2):
#   ASC_KEY_PATH    the AuthKey_XXXXXXXXXX.p8 file, outside the repository
#   ASC_KEY_ID      its Key ID
#   ASC_ISSUER_ID   the Issuer ID of the account's keys
#   ASC_TEAM_ID     the Team ID
# The build number is the date and time (UTC), so each upload is higher than
# the last: YYYYMMDD.HHMM, e.g. 20261120.1945.
#   scripts/ios-release.sh
set -euo pipefail
# shellcheck source=scripts/ios-common.sh
. "$(dirname "$0")/ios-common.sh"
require_mac
cd "$ROOT"

"$ROOT/scripts/ios-doctor.sh" --envoi || die "le Mac n'est pas prêt pour un envoi." \
  "Réglez les points «${NB}À FAIRE${NB}» ci-dessus, puis relancez."

# What is uploaded is exactly a commit: anyone can rebuild it later.
if [ -n "$(git status --porcelain)" ]; then
  git status --short >&2
  die "des fichiers ont changé sans être enregistrés dans git." \
    "Faites un commit (ou annulez ces changements), puis relancez."
fi

"$ROOT/scripts/ios-sync.sh"
# The sync writes only files git ignores; anything else is a surprise.
[ -z "$(git status --porcelain)" ] || die "npx cap sync a modifié des fichiers suivis par git." \
  "Lisez git diff, faites un commit si c'est voulu, puis relancez."

STAMP="$(date -u +%Y%m%d%H%M)"
BUILD_NUMBER="${STAMP:0:8}.$((10#${STAMP:8:4}))"
VERSION="$(marketing_version)"
APP_ID="$(bundle_id)"
COMMIT="$(git rev-parse --short HEAD)"
ARCHIVE="$BUILD_DIR/release/EAD-$VERSION-$BUILD_NUMBER.xcarchive"
OPTIONS="$BUILD_DIR/release/ExportOptions.plist"
LOG="$BUILD_DIR/release/xcodebuild.log"
mkdir -p "$BUILD_DIR/release"
# The export options name the Team ID: never left behind, even in an ignored folder.
trap 'rm -f "$OPTIONS"' EXIT

AUTH=(
  -allowProvisioningUpdates
  -authenticationKeyPath "$ASC_KEY_PATH"
  -authenticationKeyID "$ASC_KEY_ID"
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"
)

step "Archive de la version $VERSION ($BUILD_NUMBER), commit $COMMIT"
if ! xcodebuild -project "$PROJECT" -scheme App -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE" \
  -derivedDataPath "$BUILD_DIR/release/derived" \
  "${AUTH[@]}" \
  DEVELOPMENT_TEAM="$ASC_TEAM_ID" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  archive >"$LOG" 2>&1; then
  grep -E 'error:|fatal' "$LOG" | sort -u | head -n 30 >&2 || true
  die "l'archive a échoué." "Le journal complet${NB}: $LOG" \
    "docs/ios/MAC.md, «${NB}Dépannage${NB}», décrit les erreurs les plus probables."
fi
echo "Archive${NB}: $ARCHIVE"

cat >"$OPTIONS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>destination</key>
	<string>upload</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>teamID</key>
	<string>$ASC_TEAM_ID</string>
	<key>manageAppVersionAndBuildNumber</key>
	<false/>
	<key>uploadSymbols</key>
	<true/>
</dict>
</plist>
PLIST

step "Envoi vers App Store Connect"
if ! xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$OPTIONS" \
  -exportPath "$BUILD_DIR/release/export" \
  "${AUTH[@]}" >>"$LOG" 2>&1; then
  grep -E 'error:|fatal|ITMS-' "$LOG" | sort -u | head -n 30 >&2 || true
  die "l'envoi a échoué." "Le journal complet${NB}: $LOG" \
    "docs/ios/MAC.md, «${NB}Dépannage${NB}», décrit les erreurs les plus probables."
fi

cat <<DONE

Envoyée${NB}: EAD $VERSION, build $BUILD_NUMBER ($APP_ID, commit $COMMIT).
Apple la traite maintenant, en général de 5 à 30 minutes. Elle apparaît
ensuite dans App Store Connect > Apps > EAD > TestFlight, et un courriel
arrive quand elle est prête à tester.
DONE
