# Frame Home button

A small native Android app for frames with no usable Home button. Tested on one
VESWWE DP100 running Android 8.1; it requires Android 8.0/API 26 or later.

It draws a draggable floating house above ordinary apps. A tap launches the
default HOME activity. It does not inject keys, use accessibility services,
invoke root, or request internet permission. A foreground service keeps the
button available; a boot receiver restores it and its saved position after reboot.
Open **Frame Home** from the launcher to show or hide the button.

## Build

Requires JDK 17 and Android SDK build-tools 34.0.0 plus platform android-34.
Set `JAVA_HOME` to the JDK. By default, the SDK is expected in
`diagnostics/android-sdk`; override with `FRAME_HOME_SDK`.

```sh
bash scripts/home-button/build.sh
```

Output defaults to ignored `diagnostics/home-button/frame-home.apk`, with its
signing key beside it. `FRAME_HOME_OUTPUT` overrides this location. Keep that
key private and preserve it for updates. Do not commit the key or built APK.
The build script only builds and verifies the APK; it never touches the frame.

## Install and enable

Identify the device, verify a backup and get the owner's approval before making
device changes, following the repository's rules.

```sh
adb -d install diagnostics/home-button/frame-home.apk
adb -d shell appops set com.photoframe.homebutton SYSTEM_ALERT_WINDOW allow
adb -d shell am start -n com.photoframe.homebutton/.HomeSettingsActivity
```

Tap **Show Home button** in the app. Its service is deliberately not exported;
an ADB `am start-foreground-service` command cannot start it directly. Opening
the app also clears the newly installed package's stopped state before the boot
receiver is needed. Verify the button works from another app, and verify boot
startup on the particular frame: vendor builds can restrict boot broadcasts.

The overlay can cover a small portion of the app below it; drag it aside.
Android may hide overlays on sensitive system screens. It is a Home shortcut,
not a replacement for Back or Recents.

## Undo

Tap **Hide Home button** in Frame Home to hide it and disable boot startup, or
remove the app entirely:

```sh
adb -d uninstall com.photoframe.homebutton
```

Uninstalling removes its service, overlay permission and saved position. No
system APK or boot partition is modified.
