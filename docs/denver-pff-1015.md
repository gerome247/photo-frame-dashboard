# Denver PFF-1015 10.1" Frameo frame (RK3126, Android 6.0.1, 512 MB RAM)

Record of one unit, 2026-10-14, Linux host (NixOS). Observations are kept separate from guesses.
Unique identifiers (serial, MAC, IP) are left out; they live in the ignored `backups/` folder.

**Short version:** ADB from Frameo's beta settings, shipped root `su`, and the same vendor
(Harmony / ZhiHeXing) and partition layout as the [Rollei Smart Frame 107](rollei-smartframe-107.md).
It differs in two ways that matter: it has only **512 MB of RAM**, and the firmware runs Rockchip's
**low-RAM mode, which kills every app the moment you switch away from it**, unless the app is listed
in `/system/etc/lowmem_package_filter.xml`. Frameo is listed; the kiosk is not. Until it was added,
Home HQ died whenever Settings opened, and its floating Back/Dashboard buttons died with it.

## Observations (read-only unless noted)

### Identity

| | |
| --- | --- |
| About screen | Denver, Frameo v1.13.3 |
| Brand / model | `ro.product.brand=denver`, model and device `PFF-1015`, manufacturer `Harmony` |
| Firmware | `F608D_V10_ZhiHeXing-PFF-1015-V1.0.1202302221059.release-keys`, built 2023-02-22 |
| Fingerprint | `rockchip/rk312x/rk312x:6.0.1/MXC89K/user.liubc.20230222.105805:user/release-keys` |
| SoC | Rockchip RK3126 (`ro.board.platform=rk312x`, `ro.hardware=rk30board`), 32-bit (`armeabi-v7a`) |
| Kernel | Linux 3.10.0, built 2023-02-22 |
| Android | 6.0.1, API 23, `user` build, `ro.debuggable=0`, `ro.secure=1`, `ro.config.low_ram=true` |
| SELinux | Permissive (`androidboot.selinux=permissive` on the kernel command line) |
| Display | 1280x800, 160 dpi |
| RAM / storage | **512 MB** (`MemTotal: 504780 kB`), 128 MB zram; 15.7 GB eMMC (`mmcblk0`, 30,777,344 sectors) |
| WebView | `com.android.webview` 44.0.2403.119, too old for the dashboard |
| Wi-Fi | Onboard radio works, driver module `ssv6158` |
| SystemUI | `com.android.systemui` is **disabled**: no status or navigation bar |
| Frameo | `net.frameo.frame` v1.13.3, the HOME app, `/system/priv-app/Frameo.apk` |

### USB, ADB and root

- **ADB:** Frameo → Settings → Beta program → ADB access. USB `2207:0006`, product `PFF-1015`. The
  cable used was not recorded.
- `adb devices` showed `device` (authorized) straight away, with no prompt, and there is no
  `/data/misc/adb/adb_keys` or `/adb_keys`. As on the Rollei, `adbd` appears not to check keys
  (one computer tested).
- No network ADB: nothing listens on 5555; `service.adb.tcp.port` and `persist.adb.tcp.port` are empty.
- **Root:** `/system/xbin/su` (SuperSU, `daemonsu` alongside). `adb shell su -c id` returns
  `uid=0(root)` with no prompt.
- `adb shell "su 0 sh -c \"...\""` hung; `adb shell "su -c '...'"` and pushing a script work.
- **`pidof` prints every PID on the system, whatever its argument.** `kill -9 $(pidof <pkg>)` as root
  killed every process and soft-restarted Android (no kernel reboot; a clean reboot recovered).
  Get a PID from `ps` instead and check it is one number.

### Partition table (eMMC `mmcblk0`, 512-byte sectors)

From `mtdparts` on the kernel command line; eMMC sector = loader sector + 8192. Identical to the
[Rollei 107](rollei-smartframe-107.md#partition-table-emmc-mmcblk0-512-byte-sectors) except for the size of `userdata`.

| Partition | Name | Start | Size (sectors) |
| --- | --- | --- | --- |
| p1 | uboot | 16384 | 8192 |
| p2 | misc | 24576 | 8192 |
| p3 | resource | 32768 | 32768 |
| p4 | kernel | 65536 | 24576 |
| p5 | boot | 90112 | 24576 |
| p6 | recovery | 114688 | 65536 |
| p7 | backup | 180224 | 131072 |
| p8 | cache | 311296 | 262144 |
| p9 | metadata | 573440 | 32768 |
| p10 | kpanic | 606208 | 8192 |
| p11 | system | 614400 | 2097152 |
| p12 | radical_update | 2711552 | 131072 |
| p13 | userdata | 2842624 | 27934720 |

### Backup (verified)

This is a **partial backup**: `userdata` was excluded, so it does not meet the repo's
complete-device backup rule, and restore is untested. It covers every partition this record
writes to.

eMMC sectors 0-2,842,624 (everything before `userdata`), 1,455,423,488 bytes, 349.5 MB gzipped,
streamed with `adb exec-out "su -c 'dd if=/dev/block/mmcblk0 bs=512 count=2842624'"` in 202 s. The
raw stream SHA-256 equals the gzip readback; no 512-byte sector is all `0xCC`; independent re-reads of
the loader area, `uboot`, `misc`, `resource`, `kernel`, `boot`, `recovery`, `backup`, `kpanic`, all of
`system` and `radical_update` match the backup.

| Image | SHA-256 (whole partition) |
| --- | --- |
| `boot` (p5) | `4c9f70e2211ca1e14209f0507f01de994742b6c7cbeb95b335cb0c76d4722860` |
| `recovery` (p6) | `8e297516f5d9b104ed11f56ad2b5d95a916886595a761450cceef97e9b292894` |
| `kernel` (p4) | `f20e0d54e2f2f251ad5282fb040326391e75ce5969f120ffb49b270ffbae5e52` |

Restore would need Rockchip loader mode and `rkdeveloptool`; not tried.

## Low-RAM mode kills every app you leave

Seen first as: Home HQ's floating Back/Dashboard buttons never appeared in Wi-Fi settings, and the
two-finger menu did nothing there (it only works inside Home HQ).

What the logs show: 2-3 ms after an app's `onPause`, ActivityManager kills it:

```text
I am_on_paused_called: [0,com.wesbos.homehq.MainActivity]
I am_kill : [0,2371,com.wesbos.homehq,0,user request after error]
```

There is no crash. The stock Gallery is killed the same way. When the kiosk process dies, Android 6
leaves its accessibility service on the enabled list but does not bind it again, so the buttons
stay gone even after the kiosk restarts.

Why, from the firmware's decompiled `services.odex`: Rockchip patched
`ActivityStack.completePauseLocked`. When `ro.config.low_ram=true` (or `ro.target.product=vr`) and
`sys.cts_gts.status` is not `true`, switching to a different task kills the paused app with
`killAppAtUsersRequest`, unless its activity name contains an entry from the `<prev>` list in
`/system/etc/lowmem_package_filter.xml`, or the next app matches a `<next>` entry. ActivityManager reads
the file once, at boot. On this unit `<prev>` holds `net.frameo.frame`, `com.android.settings`,
`com.android.launcher` and a few others.

**Fix applied (one `/system` write, original kept as `.bak`):** add the kiosk, and a launcher if you use
one, to `<prev>` and `<empty>` next to Frameo's entries, then reboot:

```xml
<prev package="com.wesbos.homehq"/>
<prev package="amirz.rootless.nexuslauncher"/>
...
<empty package="com.wesbos.homehq"/>
<empty package="amirz.rootless.nexuslauncher"/>
```

Verified after a reboot: Home HQ stays alive when Settings opens, and the Back/Dashboard buttons show
over Settings. Undo: copy `lowmem_package_filter.xml.bak` back (`mount -o remount,rw /system` first),
then reboot.

Not used: `setprop sys.cts_gts.status true` at every boot also stops the killing, but it turns off all
of Rockchip's low-RAM tweaks, which seemed unwise with 512 MB.

Not checked: whether other low-RAM RK3126 frames ship the same patch. To check, run
`adb shell getprop ro.config.low_ram`, then switch away from any app and look for
`user request after error` in `adb logcat -b events -d`.

## Changes made to the frame (2026-10-14)

All made after the verified backup, one at a time, each with its undo recorded first. The BIUFRAME
script's `check` refuses this unit (fingerprint, model, Wi-Fi driver), so its steps were run by hand
from [biuframe-setup-guide.md](biuframe-setup-guide.md), adjusted as noted.

| Change | How | Undo |
| --- | --- | --- |
| Updaters and test apps off | `pm disable` `com.adups.fota`, `com.adups.fota.sysoper`, `android.rockchip.update.service`, `com.cghs.stresstest`, `com.DeviceTest`, `com.android.rk`, `com.android.rk.mediafloat`; `pm hide` `com.adups.fota`, `com.cghs.stresstest` | `pm unhide`, then `pm enable` each |
| WebView 44 → 106.0.5249.126 | BIUFRAME `step_webview`: same pinned LineageOS APK, `lib/arm/*.so` extracted, `oat/` removed, `webview.apk.bak` kept | Copy `webview.apk.bak` back, `rm -rf lib`, reboot |
| Let's Encrypt roots | BIUFRAME `step_certs`: `6187b673.0`, `8794b4e3.0` | Delete both |
| zram 128 → **256 MB** (not 512: half the RAM of the BIUFRAME) | `scripts/biuframe-su.d-50zram` with `268435456`, run from a line appended to `/system/bin/install-recovery.sh` (`.bak` kept) | Copy the `.bak` back, `rm -r /system/su.d`, reboot |
| Rootless Pixel Launcher 3.9.1, Home HQ kiosk | `adb install`; Home HQ made the Home app (`--ez home true`, then **Home HQ → Always** in the chooser) | `adb uninstall` |
| Home HQ navigation buttons | `pm grant com.wesbos.homehq android.permission.WRITE_SECURE_SETTINGS`; `settings put secure enabled_accessibility_services com.wesbos.homehq/com.wesbos.homehq.NavigationService`; `settings put secure accessibility_enabled 1` | Turn it off in Accessibility settings, `pm revoke` |
| Low-RAM whitelist | See [above](#low-ram-mode-kills-every-app-you-leave) | `.bak` |
| Frameo off | `su -c 'pm disable net.frameo.frame'`, after the owner checked by hand that the kiosk's buttons and two-finger menu reach Android Settings → Apps | `su -c 'pm enable net.frameo.frame'` (its data is untouched) |

Skipped: Firefox (512 MB RAM), and the navigation-bar `build.prop` line (SystemUI is disabled on this
firmware, so it would do nothing).

Verified after reboots:
- `versionName=106.0.5249.126`, with `RelroFileCreator` loading `/system/app/webview/lib/arm/libwebviewchromium.so`.
- Swap is `262136` kB, and no updater or test-app processes are running.
- `boot` and `recovery` are unchanged against the backup.
- The frame boots into Home HQ, and the dashboard loads over HTTPS once Wi-Fi is up.

Disabling Frameo, two things to know:

- **Wait before rebooting.** Android writes package state to
  `/data/system/users/0/package-restrictions.xml` about 10 s after `pm disable`. A reboot within those
  seconds brought Frameo back (`enabled=0`). Check for `<pkg name="net.frameo.frame" enabled="2"` in that
  file before you reboot.
- **The Home chooser comes back.** The "Always" choice was saved against a set of Home apps that
  included Frameo; with Frameo disabled the set changed, and the next boot showed the chooser again.
  Pick Home HQ → Always once more. After that, the frame booted straight into the dashboard.

USB ADB keeps working with Frameo disabled (`persist.sys.usb.config=adb`).

`install-recovery.sh` logs `recovery: Installing new recovery image: failed` on every boot. That is
the stock `applypatch` check using an `MTD:` path that does not exist on eMMC; the `recovery`
partition is unchanged.

There is no battery-backed clock: each boot starts at 2021-05-15 until network time arrives.

## Status against the README phase map

| Phase | State |
| --- | --- |
| 1 Identify | Done. Not a BIUFRAME; same vendor and partition layout as the Rollei 107. |
| 2 ADB | Done: Frameo beta setting, USB. |
| 3 Loader mode | Not needed. Not tested. |
| 4 Back up | Done and verified. Restore untested. |
| 5 Root | Shipped `su` works. |
| 6 Make it useful | Done: Home HQ is the Home app and the frame boots into the dashboard. Frameo is disabled. |
| 7 Networking | Onboard Wi-Fi works. |
| 8 Vendor updates | Done: Adups FOTA and the Rockchip updater are disabled. |
| 9 Security hand-off | Same as the [Rollei 107](rollei-smartframe-107.md#security-notes-for-the-owner): root for any app, no ADB key check, Android 6 from 2016. |
