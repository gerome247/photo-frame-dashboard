# Uhale 114KZ access and kiosk report

One Uhale 114KZ tested on macOS on 2026-10-14. **Wi-Fi ADB with a host key in the
boot ramdisk, shipped `su`, and a dashboard that starts automatically after reboot
are working.** This is a record of one unit, not a flashing guide.

This is an Allwinner A33 frame, unlike the Rockchip [Uhale 102KZ](uhale-102kz.md).
It also differs from the battery-powered [Uhale A33 report](uhale-a33-astar-d7.md):
this unit has no battery and could not maintain a usable USB ADB connection.
Match your own model, firmware and partition layout before using any boot tools.
Follow the [backup and write rules](../README.md#rules-we-learned-the-hard-way).

## Confirmed identity

| Field | Observed value |
| --- | --- |
| Model | Uhale `114KZ` |
| SoC | Allwinner A33 |
| Android / SDK | Android 6.0.1 / API 23 |
| Firmware | `114119_HK9365_uhale_SWM0810_uhale_photo_V5.1.1_20260114` |
| Build fingerprint | `Allwinner/astar_xr819/astar-xr819:6.0.1/MOB30R/20231010:eng/test-keys` |
| eMMC | 61,341,696 sectors of 512 bytes (31,406,948,352 bytes) |
| Stock boot SHA-256 | `0ec91674b75d8dd1f302ff690c3beae58b005bafde75a76970fbf36e37546fa8` |
| Display | 1280 x 800, density 160 |
| Vendor app | Uhale, `com.zeasn.frame` |
| SELinux | Permissive |
| Stock WebView | 44.0.2403.119 |

## USB configuration and power problem

The stock `persist.sys.usb.config` is `adb,mtp`, but `init.sun8i.usb.rc` has no
action for that function order. It does have an `mtp,adb` action. A boot ramdisk
patch copied that action with an `adb,mtp` trigger to start `adbd`.

That change alone did not provide usable USB ADB: the frame became unstable with
a USB data connection during startup. The configuration contains
`pmu_usbcur_pc=500`, and this unit has no battery. **The working explanation is a
500 mA USB power limit causing brown-outs when a PC enumerates the frame.** This
is a diagnosis from the behavior and configuration, not a measured power trace
or proof that USB ADB is impossible on every 114KZ.

The successful setup uses the stock power adapter or a charge-only cable and
ADB over Wi-Fi.

## Boot patch and Wi-Fi ADB

Before any write, the full eMMC was backed up and verified by a full independent
re-read over U-Boot USB mass storage, using the repo's read-only
[Route U](allwinner-a33-mainline-uboot.md) build from `scripts/a33-uboot/`. The first USB-action-only patch was tried
and reverted; the restored boot range matched the original backup.

The working boot ramdisk has three changes:

1. An `adb,mtp` action in `init.sun8i.usb.rc`, copied from the stock `mtp,adb`
   action, including `start adbd`.
2. `service.adb.tcp.port=5555` appended to `default.prop`.
3. The host's public ADB key installed as `/adb_keys`.

Without the preinstalled key, connections stayed `unauthorized` and no usable
authorization dialog appeared. With it, `adb connect <frame-ip>:5555` works and
reconnects after reboot. A connection from a different, unregistered key was not
tested, so rejection of other hosts remains unverified.

This report doesn't record which write path was used for the boot writes. Use a guarded
on-device U-Boot script, never a writable USB disk. The patched boot partition was read back and compared with the intended image.
The local extension of `scripts/a33-uboot/boot-patch.py` used to build it is not
included in this report; the repository version should not be assumed to support
these changes. No patched image or host key is published here.

## UID 0 does not provide all root capabilities

`adb shell su 0 id` reports UID 0, using the shipped `su`. However, this shell
lacks `CAP_SYS_ADMIN`, and remounting `/system` read-write fails. Do not assume
that the BIUFRAME's normal `su` and remount procedure works on this firmware.

System maintenance instead used a temporary init service in the boot ramdisk.
After installing WebView and certificates, the regular Wi-Fi ADB boot image was
restored. Both the temporary boot write and the restoration were verified by
byte-for-byte readback of the boot partition. After reboot, `/system` was
read-only and the temporary maintenance script was absent.

## Working dashboard setup

- Installed Rootless Launcher 3.9.1 and Home HQ 1.1.
- Replaced WebView 44 with 106.0.5249.126 and its ARM libraries. Pinned sources and hashes for
  the WebView, launcher and certificates are in [si006-uhale.md](si006-uhale.md). The complete
  original APK and oat tree was retained for restoration.
- Added ISRG Root X1, GTS Root R1 and GTS Root R4 to the system certificate store.
- Disabled FOTA (`com.adups.fota`) and Uhale (`com.zeasn.frame`) for user 0.
- Selected Home HQ as the default Home. Disabling Uhale changed the Home
  candidates, so Home HQ had to be selected as "Always" again afterward.
- Enabled Home HQ's floating Back / Dashboard controls; this firmware has no
  visible status or navigation bars.

The owner confirmed with actual fingers that the two-finger hold opens the Home
HQ menu and can reach Android Settings. The launcher entry and floating Dashboard
button were also checked. This establishes a way out of the kiosk before
relying on the vendor app being disabled.

After the final reboot, without interaction:

- Home HQ started and displayed the demo dashboard.
- Wi-Fi ADB reconnected.
- HTTPS images and fonts loaded; all five images were checked in WebView.
- Uhale remained disabled with no running process.
- The navigation accessibility service was bound.
- Startup Wi-Fi delays recovered through the kiosk's automatic retry.
- WebView remote debugging was off and the temporary debugging forward removed.

## Diagnostic caveat and recovery

On this unit, `uiautomator dump` threw an exception during cleanup and temporarily
disconnected the navigation accessibility service. Toggling
`accessibility_enabled` off and on rebound it; navigation was then checked again
without `uiautomator`. Prefer `screencap` and `dumpsys` for further inspection.

Keep the original full backup and both the stock and working boot images private.
Restoring WebView requires the complete saved APK/oat tree, not just the APK.
Because ordinary `su` cannot remount `/system` here, restoration needs an
appropriately verified init maintenance image or offline maintenance through
FEL. Exact restore offsets must come from the owner's own partition table and
backup; this report does not supply a generic write command.
