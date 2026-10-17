# Tibuta 10.1" Frameo frame (`TID10`, RK3126, Android 6.0.1, firmware `TID10_Tibuta_Frameo1.29`)

Record of one unit, set up on macOS (Apple silicon) on 2026-10-14. Observations are kept separate
from guesses. Unique identifiers (serial, MAC) are left out.

**Result:** ADB over USB from Frameo's own settings, shipped root, a verified backup of everything
before `userdata`, and the [YIAISIGN 10X1](yiaisign-10x1.md) route applied step by step: launcher,
Firefox, Home HQ kiosk, vendor apps disabled, 512 MB swap, Let's Encrypt roots and the navigation
bar. The kiosk shows an HTTPS (Let's Encrypt) site.

**Cable:** ADB only works with a **USB-A to USB-C** data cable. The frame has a single USB-C
port. With a USB-C to USB-C cable the frame did not appear on the Mac's USB bus at all (nothing in
`ioreg -p IOUSB`), so `adb devices` stayed empty. No udev or driver setup is involved on macOS.

## How it relates to the known RK3126 frames

Same platform build and partition layout as the YIAISIGN `10X1` and the Uhale 102KZ, but with the
Frameo app as the home app and a different Wi-Fi chip.

| | This frame | YIAISIGN 10X1 | BIUFRAME (Synergy 10X1) |
| --- | --- | --- | --- |
| Model / manufacturer | `TID10` / `incar` | `10X1` / `incar` | `10X1` / `Synergy` |
| Build fingerprint | `…/user.fyl.20170927.202757:userdebug/test-keys` | same as this frame | `…/user.thzy.20240919.143320:user/release-keys` |
| Partition layout | userdata at sector 2,846,720 | same as this frame | userdata at 3,891,200 |
| Home app | Frameo (`net.frameo.frame`) | Biu Frame (`com.shenju.biuframe`) | Biu Frame |
| How ADB is enabled | Frameo Settings → ADB access | On out of the box | On out of the box |
| Stock WebView | 107.0.5304.36 (`com.google.android.webview`) | 44 | 44 |
| Wi-Fi chip | AIC8800 (`aic8800_fdrv` module) | Realtek SDIO, built in | SSV6020C (`ssv6x5x`) |
| Touch | `gslX680` | `gslX680` | Hynitron `cst2xxse` |
| `qemu.hw.mainkeys=0` | Navigation bar window present after reboot | Brings it back | Brings it back |

## Identity

| | |
| --- | --- |
| Box / About screen brand | Tibuta (sold as a Frameo frame) |
| `ro.product.model` / `brand` / `manufacturer` | `TID10` / `Tibuta` / `incar` |
| `ro.product.name` / `device` / `board.platform` | `TID10` / `rk312x` / `rk312x` |
| Build fingerprint | `rockchip/rk312x/rk312x:6.0.1/MXC89K/user.fyl.20170927.202757:userdebug/test-keys` |
| Display ID | `TID10_Tibuta_Frameo1.29_2025121916_V1` (kernel built 2025-12-19) |
| Android | 6.0.1, security patch 2016-11-01, kernel 3.10.0, SELinux permissive |
| `ro.secure` / `ro.debuggable` | `1` / `0` (`adb root` unavailable; use `su`) |
| USB, Android running | `2207:0011`, manufacturer string `incar`, product string `TID10` |
| eMMC | 61,071,360 sectors of 512 bytes (about 29 GB) |
| RAM | 1 GB |
| Display | 1280 × 800, 160 dpi |
| Stock boot image | 10,616,832 bytes. SHA-1 `35a301d5f8d10554e9b9121a0ef49f8bda9f63be`, the value `/system/bin/install-recovery.sh` expects (`MTD:boot:10616832:35a301d5…`), so the backup holds the stock image. Differs from the YIAISIGN boot image |

## Getting ADB and root

1. On the frame: Frameo Settings → ADB access, set to USB.
2. Connect a **USB-A to USB-C** data cable from the Mac to the frame's USB-C port. USB-C to USB-C
   does not work.
3. `adb devices -l`: `device usb:… product:TID10 model:TID10 device:rk312x`. No authorization
   prompt was needed on this unit (the host may already have been authorized; not re-tested with
   a fresh key).
4. `adb shell su -c id` → `uid=0(root)`. SuperSU's `su` is in `/system/xbin`, no manager app,
   no prompt. **Any app can get root.**

`adbd` did not listen on port 5555 over Wi-Fi: a scan of the LAN found the frame's address with
5555 closed, and `adb connect <ip>:5555` was refused.

## Partition layout

Identical to the [YIAISIGN table](yiaisign-10x1.md#partition-layout): `boot` at 90,112,
`recovery` at 118,784, `system` at 618,496, `userdata` (`mmcblk0p13`) at 2,846,720.

## Backup

Same commands as the [YIAISIGN backup](yiaisign-10x1.md#backup), with `N=2846720` read from
`mmcblk0p13/start`. Checks that passed: length exactly 1,457,520,640 bytes; the gzip readback has
the same SHA-256 as the stream; `uboot`, `boot`, `recovery` and 16 MiB of `system` data re-read
from the frame match the backup; the boot image starts with `ANDROID!` and its SHA-1 matches the
stock value above.

## Setup

The [YIAISIGN snippet](yiaisign-10x1.md#setup), with these differences:

- **Identity check:** stop unless `ro.build.display.id` is `TID10_Tibuta_Frameo1.29_2025121916_V1`.
- **Skip `step_webview`.** The stock WebView is already 107, newer than the 106 the guide installs.
  `cmd_verify` checks `com.android.webview` for version 106, so it fails here on that line only;
  the other checks were run by hand.
- **Vendor packages present:** `net.frameo.frame`, `com.adups.fota`, `com.DeviceTest`,
  `com.android.rk` (RkExplorer). `android.rockchip.update.service`, `com.cghs.stresstest` and
  `com.android.rk.mediafloat` are absent.

  ```sh
  VENDOR_DISABLE=(net.frameo.frame com.adups.fota com.DeviceTest com.android.rk)
  VENDOR_HIDE=(com.adups.fota)
  ```

- **Install the launcher and the kiosk before disabling Frameo**, which is the only home app.
- `daemonsu` was stopped (`su -c 'stop daemonsu'`) before the `/system` writes, as on the
  YIAISIGN.

After the reboot: swap `524280` kB, a `NavigationBar` window present, both ISRG roots in
`/system/etc/security/cacerts/` with mode 0644, no Frameo/Adups/DeviceTest/RkExplorer processes,
no `Failed to load library` in logcat.

## Kiosk

Built from [`dashboard/kiosk`](../dashboard/kiosk/README.md) with JDK 17 and build-tools 35.0.0
(`BUILD_TOOLS=$ANDROID_HOME/build-tools/35.0.0`); build-tools 34 was not installed. Installed with
`adb install`. The URL is set with [`scripts/set-kiosk-url.sh`](../scripts/set-kiosk-url.sh):

```sh
scripts/set-kiosk-url.sh https://example.com/   # save and open
scripts/set-kiosk-url.sh                        # print the saved URL
```

Android 6 has no `cmd package set-home-activity`, so after `--ez home true` the Home chooser was
opened and Home HQ picked on the frame. The kiosk used about 63 MB (PSS) showing a static site.

## Not tested

- Whether a fresh host key gets the authorization prompt.
- The motion sensor, if the frame has one; loader mode; stock recovery.
- Wi-Fi after a full power cycle with Frameo disabled (it stayed connected across the reboot).
