# PF1007L January firmware, larger eMMC: macOS (Intel) unit report

This USB-C-only PF1007L on January `20260113` firmware reached root ADB over USB with
[Route U](allwinner-a33-mainline-uboot.md), then ran the Home HQ kiosk as its Home app on
WebView 106. It needed two changes to the repository's Route U build, both already written up
elsewhere but not in the default build:

- the **warm-up SPL** from [PR #74](https://github.com/wesbos/photo-frame-dashboard/pull/74)
  (now merged into the repository build; see [section 4 of the U-Boot guide](allwinner-a33-mainline-uboot.md#4-expose-the-emmc-read-only-and-back-it-up)).
  Without it, every `sunxi-fel uboot` stopped with `usb_bulk_send() ERROR -7` right after the
  SPL, including on a cold start;
- the **no-HS patch** ([`pf1007l-v2025.10-no-mmc-hs.patch`](patches/pf1007l-v2025.10-no-mmc-hs.patch),
  4-bit, 26 MHz, legacy timing), together with the
  [START STOP correction](patches/pf1007l-v2025.10-start-stop.patch). Without it, `ums` showed
  only the SD card, never the eMMC.

Observed on 2026-10-13 and 2026-10-14 from an Intel Mac (macOS 12.7.6, x86_64), Docker
Desktop 20.10.17, Android platform-tools 37.0.1. Compared against repository main at
[`a1ebdc9`](https://github.com/wesbos/photo-frame-dashboard/commit/a1ebdc92f34715b5072d26847d966f821b82631f)
and PR #74 at `dc770cb`. One unit; check each value on your own.

## Unit report

```text
About model / firmware: PF1007L
  YHK.F-null-A33-1001-D1024-PF1007L-321-OS-AIMOR.0.20260113
AiMOR version: not recorded
Ports: USB-C only (no DC jack)
Cable and port that gave USB data: USB-A to USB-C, directly into a USB-A port on the Mac
T3 USB IDs seen / adb devices output: 1f3a:1000 "Android", 480 Mb/s; adb devices empty
T3b network ADB result (port 5555): skipped (owner kept the frame offline)
T4 sunxi-fel version output: AWUSBFEX soc=00001667(A33) 00000001 ver=0001 44 08 scratchpad=00007e00
T5 check-dump stage / chunks: skipped (Route U)
eMMC size in sectors: 30,777,344
Boot partition start sector: 172032
Boot image SHA-256 (sector 172032, 31,028 sectors):
  d71c313ddaa4693948acb20af7740ccb56c88bf9376746a47fce2d00c14fc6a4
Route used and result: Route U with the warm-up SPL from PR #74 (now merged), the no-HS patch and the
  START STOP correction. Root ADB over USB (1f3a:1002, uid=0)
Host OS: macOS 12.7.6, Intel (x86_64)
First failed step and its exact output: section 4, sunxi-fel uboot:
  usb_bulk_send() ERROR -7: Operation timed out (after "Executing the SPL... done.")
```

## What happened, in order

| Attempt | Build | Result |
| --- | --- | --- |
| 1, 2 (power cycle between) | Repository build at `a1ebdc9` (8-bit eMMC) | `Executing the SPL... done.`, then `usb_bulk_send() ERROR -7` while uploading U-Boot. The frame stayed at `1f3a:efe8` but no longer answered `sunxi-fel version` |
| 3 | PR #74 (`dc770cb`): `sunxi-fel spl sunxi-spl-warmup.bin`, then the normal `uboot` command | Warm-up SPL returned to FEL (`sunxi-fel version` answered). U-Boot uploaded and started. `ums` showed **UMS disk 0 only**, the SD card (read-only). No eMMC disk |
| 4 | PR #74 + no-HS patch + START STOP correction | Warm-up, then U-Boot. **UMS disk 1** appeared: 15,758,000,128 bytes, `Media Read-Only: Yes` |

The `ERROR -7` matches the post-SPL row in the
[U-Boot settings table](pf1007l-start-here.md#u-boot-settings-that-fixed-ums-problems) (#103).
On this unit it was the DRAM cold-start problem from #6: the warm-up SPL fixed it on every
later power cycle (three). This does not show that #103 has the same cause.

The missing eMMC matches #99 (January, the eMMC never initialises). #99's builds kept the
high-speed host capabilities; removing them is what made the eMMC appear here.

The 12 Mb/s link speed in FEL is normal; stock Android ran at 480 Mb/s on the same port.

## Build details

The no-HS build was made by hand, because `build-uboot.sh` stops on a source tree with changes
other than its own patch. Do not edit that check. Steps:

1. Copy the PR #74 source tree (`diagnostics/u-boot`, at `e50b1e87` with the PR's patch
   applied) to a separate directory.
2. `git apply docs/patches/pf1007l-v2025.10-no-mmc-hs.patch`.
3. `git apply --unidiff-zero docs/patches/pf1007l-v2025.10-start-stop.patch`. That patch has no
   context lines, so `git apply` refuses it without `--unidiff-zero`; `patch --fuzz=0 -p1`, as in
   the other reports, also works.
4. Run the same `docker run` commands as `build-uboot.sh` (main and warm-up builds, `mkimage`),
   then its SPL-end check.

| Build | SPL code ends at |
| --- | --- |
| Repository build at `a1ebdc9` | `0x456a` |
| PR #74, main / warm-up | `0x458a` / `0x45ba` |
| PR #74 + no-HS + START STOP, main / warm-up | `0x458a` / `0x45ba` |

These match the values in the U-Boot guide and in PR #74.

Docker Desktop's shared folders hung once, on a `cp` to `/out`, after the Mac slept overnight.
Restarting Docker Desktop fixed it.

`sunxi-fel` needs `libfdt`. On this macOS 12 host, Homebrew's `dtc` formula started building
Python 3.15 from source. Building only `libfdt` from `dtc` v1.7.2 was quicker:
`make -C dtc NO_PYTHON=1 NO_YAML=1 WARNINGS=-Wall libfdt/libfdt.a`, then pass
`LIBFDT_CFLAGS=-I<dtc>/libfdt LIBFDT_LIBS=<dtc>/libfdt/libfdt.a` to the `sunxi-fel` make.
Apple clang rejects dtc's default `-Wsuggest-attribute=format`, hence `WARNINGS=-Wall`.

## Backup, write and verify

- `fel-card-macos.py` refused the Mac's built-in SD slot, which macOS reports as `Internal`
  with protocol `Secure Digital`. A USB card reader passed the external/USB check.
- `emmc-macos.py backup-resume` completed on the first run: 15 segments, each read twice from
  the disk and once from the file. No dropouts, direct USB-A port, no hub.
- `boot-patch.py` reported ramdisk `[192004, 203060)` and header `[172032, 172034)`, the same
  ranges as the other January units. Only `init.sun8i.usb.rc` changed, 1 of 49 ramdisk files.
- The guarded write used the warm-up SPL, then the no-HS U-Boot with the four payloads and
  `write-boot.scr`, in one `sunxi-fel` call. The 11 MB of payloads uploaded at about 300 kB/s.
- `emmc-macos.py verify-resume` passed: the eMMC equalled the backup plus exactly the planned
  ranges. After `write-boot.scr`, the eMMC was exported alone, so it came back as "UMS disk 0"
  under a new disk number. Recheck the size before every command.
- First boot: `1f3a:1002`, `adb -d shell id` → `uid=0(root)`, fingerprint
  `AEEZO/astar_m86_8723cs/astar-m86_8723cs:6.0.1/MOB30R/20260113:eng/test-keys`,
  `persist.sys.usb.config=mass_storage`.

## After root

- **The frame was online without the owner knowing.** It had joined Wi-Fi saved during setup,
  and `netstat` showed an established connection to the vendor server on TCP 7806. `svc wifi
  disable` did not stick the first time: AiMOR restarted after `am force-stop` and Wi-Fi came
  back. A second `svc wifi disable` held. Check `netstat` before assuming a frame is offline.
- T8 as documented: Rootless Launcher, then `pm disable` for `com.efercro.os.aimor`,
  `com.yhk.qeota` and `com.DeviceTest`. `enabled="2"` reached `package-restrictions.xml` within
  seconds. After the power cycle: no vendor processes, no 7806 connection, Wi-Fi state kept.
- WebView 106 by the section 6 procedure. Before the reboot, Package Manager still reported 44;
  after it, `106.0.5249.126` with no WebView `dlopen` errors.
- The clock and time zone (America/Chicago) were set by the network once Wi-Fi was on.
  `wm density` was already 160.
- The kiosk, set as Home, shows a Home Assistant instance over plain HTTP on the LAN, so no CA
  roots were needed. The stock LatinIME keyboard worked for the login page.
- **The kiosk build at `a1ebdc9` got stuck at boot**: it retried with `ERR_INTERNET_DISCONNECTED`
  every 5 s, then stopped retrying, and showed "Connect to Wi-Fi?". Opening Wi-Fi settings from
  there left no way back, because the frame has no navigation bar. The kiosk from main at
  `033b5ac`, with `35a09e5` and #101, fixed it: the log shows `Wi-Fi connected, retrying now`
  about 18 s after boot, and the dashboard loads with no input.
- Navigation buttons: `settings put secure enabled_accessibility_services
  com.wesbos.homehq/com.wesbos.homehq.NavigationService`, `accessibility_enabled 1`, and the
  README's `WRITE_SECURE_SETTINGS` grant. The Back and Dashboard buttons appeared in Settings.
- Memory with the Home Assistant dashboard open: about 514 MiB of 1,003 MiB free.
