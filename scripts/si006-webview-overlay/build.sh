#!/usr/bin/env bash
# Resource-only Android 6 provider overlay. Builds locally; never writes to a device.
# Build the kiosk first to create ~/.android/debug.keystore, or set OVERLAY_KEYSTORE.
set -euo pipefail
cd "$(dirname "$0")"
: "${ANDROID_HOME:?Set ANDROID_HOME to an SDK with build-tools 34.0.0 and platform 34}"
BT="$ANDROID_HOME/build-tools/34.0.0"
KS="${OVERLAY_KEYSTORE:-$HOME/.android/debug.keystore}"
[ -f "$KS" ] || { echo "Build the kiosk first to create the debug keystore." >&2; exit 1; }
mkdir -p build
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/unsigned.apk -I "$ANDROID_HOME/platforms/android-34/android.jar" \
  --manifest AndroidManifest.xml build/res.zip
"$BT/zipalign" -f 4 build/unsigned.apk build/aligned.apk
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --out build/si006-webview-overlay.apk build/aligned.apk
"$BT/apksigner" verify build/si006-webview-overlay.apk
echo "Built scripts/si006-webview-overlay/build/si006-webview-overlay.apk"
