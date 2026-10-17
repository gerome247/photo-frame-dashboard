# SI006 Android 6 WebView provider overlay

Tested only on the SI006 / `sp7731g_1h10` build described in
[the device notes](../../docs/si006-uhale.md). This resource-only APK changes
`android:string/config_webViewPackageName` from the factory's Google package
name to `com.android.webview`. It does not contain a browser engine.

Build the kiosk first to create the debug signing key, then:

```sh
ANDROID_HOME=/path/to/android-sdk bash scripts/si006-webview-overlay/build.sh
```

The build script never installs anything. Install the compatible standalone
`com.android.webview` APK first. With a verified firmware backup, the overlay
was tested with the device's `idmap --path`, installed as a trusted overlay at
`/system/vendor/overlay/si006-webview-overlay.apk`, and activated by reboot.
See the device notes for the exact APK source, resource mapping, permissions,
readback checks, and successful WebViewFactory log.

Rollback: remove this overlay APK from `/system/vendor/overlay`, restore the
system partition to read-only, and reboot. The original WebView and framework
resources are retained. Only then uninstall the additional WebView if desired.
Do not uninstall the selected provider before removing the overlay.
