#!/usr/bin/env bash
# Build only. Never installs an APK or changes a connected frame.
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TASK_SRC="$TASK_ROOT/scripts/home-button"
TASK_SDK="${FRAME_HOME_SDK:-$TASK_ROOT/diagnostics/android-sdk}"
TASK_OUT="${FRAME_HOME_OUTPUT:-$TASK_ROOT/diagnostics/home-button}"
TASK_JAVA="${JAVA_HOME:?Set JAVA_HOME to a JDK 17 installation}"
TASK_BT="$TASK_SDK/build-tools/34.0.0"
TASK_JAR="$TASK_SDK/platforms/android-34/android.jar"
mkdir -p "$TASK_OUT"
TASK_CLASSES="$(mktemp -d "$TASK_OUT/classes.XXXXXX")"
"$TASK_BT/aapt2" compile --dir "$TASK_SRC/res" -o "$TASK_OUT/resources.zip"
"$TASK_BT/aapt2" link -o "$TASK_OUT/base.apk" -I "$TASK_JAR" \
  --manifest "$TASK_SRC/AndroidManifest.xml" --version-code 1 --version-name 1.0 "$TASK_OUT/resources.zip"
"$TASK_JAVA/bin/javac" --release 8 -classpath "$TASK_JAR" -d "$TASK_CLASSES" \
  "$TASK_SRC"/src/com/photoframe/homebutton/*.java
"$TASK_JAVA/bin/java" -cp "$TASK_BT/lib/d8.jar" com.android.tools.r8.D8 \
  --min-api 26 --lib "$TASK_JAR" --output "$TASK_OUT" \
  "$TASK_CLASSES"/com/photoframe/homebutton/*.class
(cd "$TASK_OUT" && zip -qj base.apk classes.dex)
"$TASK_BT/zipalign" -f 4 "$TASK_OUT/base.apk" "$TASK_OUT/aligned.apk"
if [[ ! -f "$TASK_OUT/signing.p12" ]]; then
  "$TASK_JAVA/bin/keytool" -genkeypair -keystore "$TASK_OUT/signing.p12" \
    -storepass android -keypass android -alias framehome -keyalg RSA -keysize 2048 \
    -validity 10000 -dname 'CN=Photo Frame Development' >/dev/null 2>&1
fi
"$TASK_BT/apksigner" sign --ks "$TASK_OUT/signing.p12" --ks-pass pass:android \
  --v3-signing-enabled false --v4-signing-enabled false \
  --key-pass pass:android --out "$TASK_OUT/frame-home.apk" "$TASK_OUT/aligned.apk"
"$TASK_BT/apksigner" verify --min-sdk-version 27 --max-sdk-version 27 "$TASK_OUT/frame-home.apk"
shasum -a 256 "$TASK_OUT/frame-home.apk"
