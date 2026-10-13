#!/usr/bin/env bash
# Builds kiosk/build/homehq.apk without Gradle. Needs JDK 17 + Android build-tools 34 + platform 34:
#   brew install --cask android-commandlinetools
#   sdkmanager --sdk_root=$ANDROID_HOME "build-tools;34.0.0" "platforms;android-34"
# Install on the tablet: adb install -r kiosk/build/homehq.apk
set -euo pipefail
cd "$(dirname "$0")"

ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
BT="$ANDROID_HOME/build-tools/34.0.0"
JAR="$ANDROID_HOME/platforms/android-34/android.jar"
KS="$HOME/.android/debug.keystore"

rm -rf build && mkdir -p build/gen build/classes

# Kiosk start URL: url from ../local.config.json plus ?key= from ../.dash-key (both gitignored),
# written to a generated class so neither ends up in the source tree.
URL=$(node -p "try { require('../local.config.json').url || '' } catch { '' }" 2>/dev/null || true)
URL=${URL:-https://home-dashboard.wesbos.workers.dev/}
if [ -f ../.dash-key ]; then URL="$URL?key=$(tr -d '\n' < ../.dash-key)"; fi
mkdir -p build/gen/com/wesbos/homehq
printf 'package com.wesbos.homehq;\n\nfinal class Config {\n  static final String DEFAULT_URL = "%s";\n}\n' "$URL" \
  > build/gen/com/wesbos/homehq/Config.java

# KIOSK_HOME=1 also registers the kiosk as a Home app, so it starts on boot on devices whose
# BOOT_COMPLETED goes only to whitelisted apps (e.g. the PF1007 photo frame). Pick it as Home once.
MANIFEST=AndroidManifest.xml
if [ "${KIOSK_HOME:-0}" = 1 ]; then
  sed 's|<category android:name="android.intent.category.LAUNCHER" />|&\n        <category android:name="android.intent.category.HOME" />|' \
    AndroidManifest.xml > build/AndroidManifest.xml
  MANIFEST=build/AndroidManifest.xml
fi

"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/base.apk -I "$JAR" --manifest "$MANIFEST" build/res.zip \
  --java build/gen --min-sdk-version 22 --target-sdk-version 23 --version-code 1 --version-name 1.0

javac -nowarn -source 8 -target 8 -classpath "$JAR" -d build/classes \
  src/com/wesbos/homehq/*.java build/gen/com/wesbos/homehq/*.java 2>&1 | grep -v "^warning\|^Note\|bootstrap" || true

"$BT/d8" --min-api 22 --lib "$JAR" --output build $(find build/classes -name '*.class')
(cd build && zip -qj base.apk classes.dex)
"$BT/zipalign" -f 4 build/base.apk build/aligned.apk

if [ ! -f "$KS" ]; then
  mkdir -p "$(dirname "$KS")"
  keytool -genkeypair -keystore "$KS" -storepass android -keypass android -alias androiddebugkey \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android --out build/homehq.apk build/aligned.apk
echo "Built kiosk/build/homehq.apk"
