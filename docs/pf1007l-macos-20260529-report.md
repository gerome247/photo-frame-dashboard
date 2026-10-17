# PF1007 / AiMOR May 2026 firmware: macOS unit report

This USB-C-only PF1007 reached root ADB and a working Android home screen using
[Route U](allwinner-a33-mainline-uboot.md). A local U-Boot START STOP handler correction
kept USB storage connected. Before flashing, we also strengthened error handling
in the generated boot write and restore scripts; that was a safety improvement,
not an independently demonstrated cause of the original failure.

Observed on 2026-10-11 with macOS 26.5.1, Apple silicon, and Android platform-tools
37.0.1. Compared against repository main at
[`9dd323e`](https://github.com/wesbos/photo-frame-dashboard/commit/9dd323e7974f1d4cc10935044386101f9c18e6d0),
plus issues and open PRs. **The local U-Boot and write-script changes described
below are not included in that revision's build scripts.** This records one
successful experiment; it does not extend the April-only tools or make another
unit's flash offsets safe to reuse. An access-only attempt on a
[second unit](#second-unit-larger-emmc-2026-10-13-access-only-no-backup) is at the end.

## Unit report

```text
About model / firmware: PF1007; Android model property AEEZO
  YHK.F-null-A33-1001-D1024-PF1007L-V10-1680.0.20260529
AiMOR version: 6.0.78 (code 78)
Ports: USB-C only, microSD/TF slot, power button, reset pinhole; no DC jack
Cable and port that gave stable USB data:
  Nintendo-branded USB-A to USB-C cable into a multiport hub's USB-A data port;
  hub connected to the Mac, with a MacBook charger feeding the hub's PD input
T3 USB IDs / ADB: stock 1f3a:1000, "Android"; adb devices empty
T3b network ADB (5555): not tested; owner chose to keep AiMOR offline
T4 FEL: 1f3a:efe8; AWUSBFEX soc=00001667(A33) 00000001 ver=0001 44 08
  scratchpad=00007e00 00000000 00000000
T5 SD-only check-dump: skipped; USB Route U used
eMMC size: 30,535,680 sectors of 512 bytes = 15,634,268,160 bytes
Boot partition start: sector 172032
Boot image SHA-256, first 31,028 sectors (15,886,336 bytes):
  6c118dc1aa583797884c33cd3ac3796c72b2bd3a3f1fcafd1bf0982ae5f29e2c
Route / result: full read-only UMS backup, locally guarded boot-ramdisk patch;
  then USB 1f3a:1002 and adb -d shell id -> uid=0(root), without su
Host OS: macOS 26.5.1 (25F80), arm64
First mismatch: T1 firmware differs from the guide's January 2026 build
First backup error after UMS disappeared:
  subprocess.CalledProcessError: Command '['diskutil', 'info', '-plist', 'disk5']'
  returned non-zero exit status 1.
```

The rear label's FCC ID was `2AW9M-PF1007`. Android was 6.0.1, SDK 23,
`armeabi-v7a`. The case was not opened: PCB markings, physical chip markings,
and USB-C resistor wiring were not inspected. FEL positively identified A33.

The owner supplied this [Amazon.ca purchase listing, ASIN B0H4W1YPHH](https://www.amazon.ca/dp/B0H4W1YPHH).
It is a purchase reference for the tested PF1007 running **AiMOR 6.0.78**, not a
hardware compatibility check. AiMOR is the frame's software; the listing alone
does not establish its manufacturer or guarantee that later stock uses the same board.
Use the recorded firmware, USB/FEL identity and storage checks when identifying another unit.

### Same firmware and boot image, different stock ADB state

[Issue #8](https://github.com/wesbos/photo-frame-dashboard/issues/8) reports the
same complete vendor firmware string and boot-image hash, but stock USB root ADB
was already enabled and its eMMC had 30,777,344 sectors. This unit had 30,535,680
sectors and exposed only mass storage before the patch.

The boot patch did not change `/system/build.prop`. That file contains
`persist.sys.usb.config=mass_storage` and `ro.adb.secure=0` on this unit. The
original ramdisk contained `ro.secure=0`, `ro.debuggable=1`, and `/sbin/adbd`.
A matching boot hash covers the boot image, not `/system`, persistent properties,
or the rest of the firmware. Test actual USB ADB on each unit before choosing a
patch route; a firmware date or boot hash alone cannot establish whether ADB is on.

[Issue #16](https://github.com/wesbos/photo-frame-dashboard/issues/16) now reports
another stock-ADB-off unit with this May firmware and boot hash, but the larger eMMC.
Its build.prop sector did not match PR #6's original sector. A matching boot image
therefore does not justify copying a build.prop-sector patch from another frame.

Network ADB was deliberately not tested here. This result does **not** establish
that port 5555 was closed or that a flash write was the only possible route.

## Cable, power, and USB observations

The supplied A-to-C cable powered the frame, but did not expose the frame to the
Mac in these tests. A different Nintendo-branded A-to-C cable carried both data
and enough power through the powered hub. Its exact part number was not retained;
this does not establish that every Nintendo cable supports data.

Direct C-to-C power from the Mac did not reliably complete boot. A C-to-C cable
through a hub did enumerate the stock Android device on an earlier attempt, but
the connection/power arrangement was unreliable. A-to-C was the stable final path.
This qualifies the blanket statement that C-to-C can never give data: behavior
varied with the hub and cable arrangement. Input voltage/current and CC wiring
were not measured, so the electrical cause remains undetermined.

Distinguish these USB entries when checking the connection:

| Entry | What it established in this session |
| --- | --- |
| `1d5c:5100`, Fresco Logic "Generic Billboard Device" | The hub enumerated; it was not the frame |
| `1f3a:1000`, "Android" | The frame's USB data path worked; stock ADB was still absent |
| `1f3a:efe8`, sometimes "Unnamed Device", 12 Mb/s | FEL; the dark screen and lower link speed were expected |
| "UMS disk 0/1", exact size, read-only | RAM U-Boot exposed storage; identify the eMMC separately from the card |
| `1f3a:1002` and an ADB `device` entry | The patched USB interface exposed working ADB |

On macOS, `ioreg -p IOUSB -w 0` gave a useful USB tree even when
`system_profiler SPUSBDataType` returned no useful listing. Check the hub's USB 2.0
path as well as its USB 3.0 path. Neither a lit screen nor a billboard entry proves
that the frame's data connection is present.
Newer reports [#19](https://github.com/wesbos/photo-frame-dashboard/issues/19) and
[#24](https://github.com/wesbos/photo-frame-dashboard/issues/24) also found
`system_profiler SPUSBHostDataType` useful; that alternative was not needed in this session.

Holding the reset pinhole while reconnecting power booted AiMOR normally. About
five taps opened the test-app password prompt, and tapping the kernel name did
not expose usable developer settings. The AOSP keyboard settings were reachable,
but did not provide a route to full Android Settings or ADB. No test-app password
was discovered. These failures describe this unit, not every PF1007.

A 32 GB Patriot LX microSDHC card worked. The existing FAT32 partition began at
sector 8192 (4 MiB); the official FEL stub was placed at **byte offset 8192 (8 KiB)**
in the unused boot gap using the guarded macOS card tool. These are different
units. The card remained inserted for FEL/U-Boot and was removed before Android
boot. A dark screen with the FEL card inserted was not proof of inadequate power.
Route U's FEL stub does not read files from FAT32; Route S's SD dump/write scripts
do. The 32 GB/FAT32 recommendation avoids Route S's filesystem limits, rather than
proving that larger cards cannot enter FEL. Keep the card tool's layout checks.

## UMS disappeared after about 30 seconds

The original Route U build initially exposed both read-only disks, then the frame's
USB gadget disappeared. The owner left the cable and hub untouched; both hub
halves remained in the Mac's USB tree. The backup failed before copying data.

[PR #6](https://github.com/wesbos/photo-frame-dashboard/pull/6) describes floating
serial input aborting UMS on another unit. We tested null console input first,
without changing this build's clocks, DRAM configuration, or MMC settings:

| Build | Result |
| --- | --- |
| Route U U-Boot v2025.10 with the published read-only patch | Both disks present at 20.7 s; absent at 30.8 s |
| Same base plus `CONFIG_SYS_DEVICE_NULLDEV=y` and guarded `setenv stdin nulldev` | Present at 20.7 s; absent at 30.7 s |
| Null-console build plus the START STOP correction below | Both disks present for all 19 samples through 184.1 s; subsequently completed two full eMMC reads |

Null input alone did not solve this failure. Between the second and third builds,
the only storage-driver change was in `do_start_stop()` in
[`drivers/usb/gadget/f_mass_storage.c` at U-Boot v2025.10](https://github.com/u-boot/u-boot/blob/e50b1e8715011def8aff1588081a2649a2c6cd47/drivers/usb/gadget/f_mass_storage.c).
The original handler sets `common->eject = 1` for every accepted START STOP UNIT
request. The correction sets it only for an unload request:

```diff
- common->eject = 1;
+ /* Only an unload request ejects; start and idle-stop keep UMS active. */
+ if ((common->cmnd[4] & 0x03) == 0x02)
+     common->eject = 1;
```

The normal start/stop behavior also matches the
[Linux mass-storage handler](https://github.com/torvalds/linux/blob/master/drivers/usb/gadget/function/f_mass_storage.c).
A host test extracted the real U-Boot function and compiled it with minimal type
definitions. Literal command-byte cases gave these results:

| Command byte 4 | Request | Expected eject | Original | Corrected |
| --- | --- | --- | --- | --- |
| `0x00` | Stop, no unload | No | Failed | Passed |
| `0x01` | Start | No | Failed | Passed |
| `0x02` | Unload | Yes | Passed | Passed |
| `0x03` | Load/start | No | Failed | Passed |

The stable rebuild retained both read-only protections: the UMS write callback
refused host writes, and each LUN reported write-protect. The console guard also
remained in the build. This blocks host writes through UMS; the native U-Boot
`mmc write` command remains available to the reviewed flash script.
No USB/SCSI trace was captured, so the precise host request
that triggered the earlier disconnect was not observed. The controlled rebuild
and completed reads support this mechanism on this Mac; they do not diagnose every
disconnect. In particular, the later resets reported in
[PR #13](https://github.com/wesbos/photo-frame-dashboard/pull/13) were not tested here.

### Reproduce the RAM-only build

The following is a **host build**, not a device-loading or flashing command.
Start in the repository root with Docker running. The original build script obtains
the pinned U-Boot source and applies `scripts/a33-uboot/pf1007l-uboot.patch`.
Inspect that source's diff before adding a local correction; stop if it already has
other experimental board changes. Use a separate output directory:

Save this as a script and run it with `bash`. Pasted into an interactive shell, `set -eu`
closes the terminal on the first error.

```sh
set -eu
scripts/a33-uboot/build-uboot.sh
task_src="$PWD/diagnostics/u-boot"
task_out="$PWD/diagnostics/a33-uboot-start-stop-rebuild"
test "$(git -C "$task_src" rev-parse HEAD)" = e50b1e8715011def8aff1588081a2649a2c6cd47
git -C "$task_src" apply --reverse --check "$PWD/scripts/a33-uboot/pf1007l-uboot.patch"
mkdir -p "$task_out"
cat > "$task_out/ums-readonly.cmd" <<'CMD'
# RAM-only diagnostic: ignore floating serial input. No saveenv or flash writes.
if setenv stdin nulldev; then
# Expose storage over USB as READ-ONLY disks (writes are patched out of this build).
# LUN 0 is the SD card (mmc 0), LUN 1 the eMMC (mmc 1). Identify them by size on the host.
ums 0 mmc 0,1 || ums 0 mmc 1 || ums 0 mmc 0
else
  echo "STOP: could not disable serial input"
  while true; do sleep 1; done
fi
CMD
docker run --rm -v "$task_src":/src:ro -v "$task_out":/out \
  -v "$PWD/docs/patches":/patches:ro pf1007l-uboot-build bash -eu -c '
export CROSS_COMPILE=arm-linux-gnueabihf-
cp -a /src /tmp/src
cd /tmp/src
patch --dry-run --fuzz=0 -p1 < /patches/pf1007l-v2025.10-start-stop.patch
patch --fuzz=0 -p1 < /patches/pf1007l-v2025.10-start-stop.patch
make O=/build pf1007l_backup_defconfig > /dev/null
scripts/config --file /build/.config --enable SYS_DEVICE_NULLDEV
make O=/build olddefconfig > /dev/null
make O=/build -j"$(nproc)" > /out/build.log 2>&1
cp /build/u-boot-sunxi-with-spl.bin /build/.config /out/
cp drivers/usb/gadget/f_mass_storage.c /out/f_mass_storage.c
mkimage -C none -A arm -T script -d /out/ums-readonly.cmd /out/ums-readonly.scr
'
```

If any step fails, stop; do not load leftover outputs from a previous build. The
source mount is read-only, and the extra patch is applied inside the disposable
container. The [exact source patch](patches/pf1007l-v2025.10-start-stop.patch) is
included as documentation; the production build script still does not apply it.
The documented container steps were rebuilt during this report's review against
the retained pinned source; configuration and handler checks passed. No further
RAM load or frame write was performed for that documentation check.
The script's fallback can expose the **card alone** if eMMC is unavailable. Never
assume that a single "UMS disk 0" is eMMC.

Before an owner-approved RAM load, check the generated `.config` and SPL using
the same end-of-code check in `build-uboot.sh` (must not exceed `0x5e00` in the
first `0x6000` bytes). This session's SPL ended at `0x456a`:

| Setting | This tested build |
| --- | --- |
| U-Boot source | v2025.10, `e50b1e8715011def8aff1588081a2649a2c6cd47` |
| DRAM | `CONFIG_DRAM_CLK=456`, `CONFIG_DRAM_ZQ=15291` |
| CPU / PMIC | 1008 MHz, original Route U PMIC configuration; no low-power/PMIC changes |
| MMC | `CONFIG_MMC_SUNXI_SLOT_EXTRA=2`; original 8-bit eMMC configuration retained |
| Console / boot | `CONFIG_SYS_DEVICE_NULLDEV=y`, `CONFIG_BOOTDELAY=-2` |
| USB / checks | `CONFIG_USB_MUSB_GADGET=y`, `CONFIG_CMD_USB_MASS_STORAGE=y`, `CONFIG_CRC32_VERIFY=y` |
| Read-only protections | `ums_write_sector` refuses `blk_dwrite`; `initially_ro = 1` for LUNs |

Also record the sunxi-tools source revision and the exact FEL stub used. Here they
were `d7bbd172a5da601a08f94479de308c6fb714a19a` and the 8192-byte
`bin/fel-sdboot.sunxi` with SHA-256
`2ccec08a026840571f3804671ba72afae840db27112a43f2b1f122075bc808bc`.
The hardware-tested `u-boot-sunxi-with-spl.bin` had SHA-256
`13a64bae7a449169fed27f361bbe8d6edd062204505a089a6dc98e9d7351472f`.
That identifies this session's artifact; it is not a compatibility check for another
board. Build tools and embedded timestamps can change rebuilt binary hashes.

### Distinguish other UMS failure reports

The new reports are useful comparisons, not proof that their fixes belong in this build:

| Report | Distinguishing evidence |
| --- | --- |
| [#16](https://github.com/wesbos/photo-frame-dashboard/issues/16) | May firmware, larger eMMC; lower-power build and a direct port completed its backup; power cause inferred, not measured |
| [#17](https://github.com/wesbos/photo-frame-dashboard/issues/17) | April firmware; idle UMS loss around 41 s, SD-only dump passed |
| [#18](https://github.com/wesbos/photo-frame-dashboard/issues/18) | January firmware, larger eMMC; MMC read failures reproduced without USB traffic, clean reads after lowering MMC clock |
| [#19](https://github.com/wesbos/photo-frame-dashboard/issues/19) | Returns to FEL around 45–50 s; a reset differs from loss of UMS alone |
| [#24](https://github.com/wesbos/photo-frame-dashboard/issues/24) | May 19 firmware; console evidence of MMC read errors, different ramdisk slot, powered-hub and read-retry experiments |

For another unit, record whether idle UMS survives, whether reads trigger the loss,
whether the hub remains, and whether FEL returns. #24 records a method for retaining
a U-Boot console log in SRAM across a reset. Its watchdog, SRAM-address, MMC and PMIC
changes were **not** tested here; inspect their source and board assumptions rather
than combining all the workarounds at once.

### A missing disk number needs a fresh identity check

`disk5` disappearing was initially a loss of the UMS gadget, not just an unnoticed
replug. After reloading RAM U-Boot, recheck the USB tree and disk list. After the
write script exposed **only** eMMC with `ums 0 mmc 1`, it became "UMS disk 0" and
macOS assigned `disk4`, despite being the same 15,634,268,160-byte eMMC.

Before every raw read, retain the script's guards: exact byte count, external USB,
expected "UMS disk N" media name, and read-only status. Do not substitute a disk
number until those checks match. If macOS asks to initialize the disk, choose Ignore.

## Full backup and verified May-firmware boot patch

The corrected U-Boot completed the entire 15,634,268,160-byte exposed eMMC user-area
backup, an independent second device read, and gzip readback. The reads ran at
13.1 and 13.3 MB/s; the script's `0xCC` filler check passed. The compressed file was
373,583,703 bytes. A further host SHA-256 of the full local image matched the two
device reads. The whole-disk hash and dump remain private.

This covered the complete UMS disk, including userdata and partition tails, rather
than just boot/system. It did not capture separate eMMC hardware boot areas or
RPMB. A full restoration was not performed.

The `sudo` backup produced administrator-owned files with private permissions.
Returning ownership of just the `.img`, `.img.gz`, and `.sha256` files to the owner
allowed the non-administrator tools to inspect them without making the dumps
world-readable. A Terminal authentication did not give the separate agent process
passwordless sudo; the owner ran the raw-device backup and verification commands.

The original boot hash differed from the January guide's `d71c313d…` value. The
May image was inspected and patched **from this unit's verified backup**. The
owner reviewed the new firmware, exact write ranges, and undo files before
explicitly approving the experimental write. No image/hash guard was weakened.

Only `init.sun8i.usb.rc` changed in the ramdisk: its mass-storage action enabled
`mass_storage,adb`, selected product ID `1002`, and started `adbd`. The kernel and
all other CPIO entries remained byte-identical. Header changes were confined to
ramdisk size and the legacy SHA-1 image ID. The original and new image IDs and
ramdisk slot fit were checked independently.

The inspected header was legacy `ANDROID!`, page size 2048, with no second stage.
The kernel was 10,221,784 bytes; the original gzip ramdisk was 5,659,951 bytes,
and the patched gzip was 5,632,339 bytes. The padded ramdisk slot was 5,660,672
bytes at image-relative byte offset 10,225,664. Preserve the kernel and every
other CPIO record's contents, metadata, ordering and archive tail. The legacy
image ID is SHA-1 over each kernel/ramdisk/second-stage payload followed by its
little-endian 32-bit length, not SHA-1 of the whole boot partition.

The new action was:

```text
on property:sys.usb.config=mass_storage
    write /sys/class/android_usb/android0/enable 0
    write /sys/class/android_usb/android0/idVendor 1f3a
    write /sys/class/android_usb/android0/idProduct 1002
    write /sys/class/android_usb/android0/functions mass_storage,adb
    write /sys/class/android_usb/android0/enable 1
    start adbd
    setprop sys.usb.state ${sys.usb.config}
```

`boot-patch.py` requires the exact original action once and independently re-parses
the result. A different action, header format, second stage, partition layout, or
non-fitting ramdisk is a stop condition, not a reason to weaken its checks.

For this inspected image, the planned writes were:

| Region | Sector range, end exclusive | Bytes |
| --- | --- | --- |
| Ramdisk slot | `[192004, 203060)` | 5,660,672 |
| Header, including SHA-1 ID in the second sector | `[172032, 172034)` | 1,024 |

The total was 5,661,696 bytes. These are observations, not reusable offsets for an
unidentified frame.

### Stronger generated write-script guards

The generator in the checked repository revision checks payload CRCs and original
flash bytes, but does not make the header write conditional on a successful ramdisk
write and readback. Before loading the payloads, we strengthened the generated
apply **and** restore scripts locally to:

1. Require null console input, successful MMC selection, and successful preflight reads.
2. Verify all four payload CRCs and compare current flash with the expected original
   bytes for apply, or patched bytes for restore.
3. Require a successful ramdisk write, re-read it, and compare it with the intended
   payload **before** attempting the header write.
4. Require a successful header write, re-read, and byte comparison.
5. Return to read-only UMS for independent host verification.

A host control-flow harness ran each actual generated `.cmd` through seven cases:
success, console setup failure, preflight read failure, CRC failure, ramdisk write
failure, ramdisk readback failure, and ramdisk mismatch. All seven passed for each
locally hardened script. This simulated command outcomes on the host; failures
were not injected into the frame, and restore was not run on hardware. These
checks do not make a multi-sector write atomic or promise automatic recovery from
an interrupted partial write.

The harness used Bash command stubs to test ordering; it did not exercise U-Boot's
hush parser or real CRC/MMC operations, and did not inject header-write failures.
Hardware full-device readback is a separate and necessary check.

For another agent generating its own scripts, the control flow must be nested as
follows. This is pseudocode, not a paste-ready flash command:

```text
if null-console setup, MMC selection, both preflight reads,
   all four payload CRCs, and both expected-flash comparisons succeed:
    if ramdisk write AND ramdisk readback AND full-slot comparison succeed:
        if header write AND header readback AND header comparison succeed:
            report success
        else: report STOP (header operation failed)
    else: report STOP (do not attempt header write)
else: report STOP (do not write)
return to read-only UMS for an independent host comparison
```

For apply, the expected flash is original and the destination payload is new.
For restore, expected flash is new and the destination payload is original.
Derive each sector, count, byte length and CRC from **this device's** private
payloads and `plan.json`; never substitute the values from this report. A partial
write may match neither complete state, so the mirrored restore guard can refuse
it. Stop and investigate rather than forcing the restore or rerunning apply.

The successful session used this non-overlapping RAM map:

| Purpose | Address |
| --- | --- |
| Original header / ramdisk | `0x50000000` / `0x51000000` |
| New header / ramdisk | `0x52000000` / `0x53000000` |
| Readback header / ramdisk | `0x54000000` / `0x55000000` |
| U-Boot script | `0x43100000` |
| FEL-loaded U-Boot start | `0x4a000000` |

Validate available DRAM and every interval, including readback buffers, before
reusing that map. The header buffers here were 1024 bytes and ramdisk buffers
5,660,672 bytes; another image can exceed those assumptions.

Editing a `.cmd` file does **not** update the `.scr` image loaded by FEL. Rebuild
both executable scripts after every command change (`mkimage -A arm -T script
-C none`, or the generator's legacy-script encoder). Validate their image-header
and data CRCs and extract the embedded text to check it equals the reviewed `.cmd`.
Load the four checked payloads and the selected `.scr` in the same `sunxi-fel
uboot ... write ...` invocation used by Route U, so transfers complete before
U-Boot starts. Reaching "Starting U-Boot" or a successful host exit is not proof
that the flash guard accepted the write.

After applying, the owner ran the full-device verifier. It re-read all exposed
eMMC bytes at 13.4 MB/s and reported:

```text
Verified: the eMMC equals the backup plus exactly the planned boot patch.
```

## Android home screen and evidence after reboot

With power disconnected, the FEL card was removed, then the same working cable
and hub were reconnected. AiMOR booted; USB enumerated as `1f3a:1002` and the ADB
shell returned `uid=0(root)` without `su` or a debug-menu password.

After this ramdisk patch, `persist.sys.usb.config` and `sys.usb.config` still read
`mass_storage`: the action itself enabled the additional USB function. Those
property strings alone therefore do not determine whether ADB is available.
Check `adb devices -l` and `adb -d shell id`.

`adb -d shell` opens an interactive root shell. Type `exit` or press Control+D to
return to the Mac's terminal; this does not send Home or Back to the frame.

The documented, SHA-256-checked F-Droid Rootless Launcher 3.9.1 APK passed Android
build-tools signature verification and its minimum SDK 21 was compatible with
this frame's SDK 23. It was installed and confirmed visible before disabling
`com.efercro.os.aimor`, `com.yhk.qeota`, and `com.DeviceTest`. Their private package
restriction entries were checked for `enabled="2"` before reboot.

After two reboots, root ADB and the disabled states persisted; the vendor processes
were absent and Rootless was the foreground Home activity. Wi-Fi was switched off.
That initial setup stopped at the owner's requested Android home screen; later
WebView/demo checks are recorded separately below. No certificate installation or
network-ADB test was performed on this unit.

**A black screenshot did not establish a black physical screen.** Boot captures
from `adb exec-out screencap -p` were black while Android reported the launcher
visible. A Home action produced a normal capture on one boot. Setting the guide's
`animator_duration_scale=0` did not eliminate the black capture on another boot;
the owner nevertheless confirmed the physical screen showed the date, upward
arrow, and search bar. No physical launcher startup failure or animation-setting
fix was established. Ask the owner what the panel shows before diagnosing this
as a boot, power, or launcher failure.

### Later WebView and USB dashboard verification

The retained post-root records were updated later on 2026-10-11. Stock WebView
was `com.android.webview` 44.0.2403.119 at `/system/app/webview/webview.apk`.
WebView 106.0.5249.126 was subsequently tested using the existing
[replacement procedure](allwinner-a33-pf1007l.md#6-upgrade-webview-before-using-the-kiosk),
with independent system-backup reads, gzip verification, an original-tree archive,
and a retained rollback tree. Staged and installed replacement files matched.
The replacement included `lib/arm/libwebviewchromium.so`,
`libchromium_android_linker.so` and `libcrashpad_handler_trampoline.so`; an APK
version string alone would not establish that those libraries loaded.

After reboot, a real kiosk test reported Chrome/106.0.5249.126 in the user agent
and passed module-script, optional-chaining, grid and canvas checks at 1280 × 800.
A later production dashboard build rendered over `adb -d reverse tcp:4173 tcp:4173`
using a Mac-local server. Calendar and Photos touch interactions and the resulting
screenshots were checked. Wi-Fi stayed off. Images and fonts used a host-side
allowlisted proxy for `picsum.photos`, `fonts.googleapis.com` and `fonts.gstatic.com`;
USB reverse alone cannot provide the offline frame with arbitrary internet assets.
The reverse mapping must be re-established after an ADB disconnect or reboot;
it is a host-session setup, not a persistent Android network configuration.

These checks required the Mac server and USB connection. They do not establish
standalone network operation, kiosk-as-Home persistence after reboot, certificate
installation, or a measured performance improvement. Rootless was restored after
the WebView runtime check. The frame clock initially read 1970 and was corrected
for the demo; a correct dashboard date is not evidence of working NTP while offline.

## Handoff checklist for another agent

1. Recheck main and open reports. Record the full vendor firmware string, AiMOR
   version, ports, positive SoC identification when available, host OS and exact
   failing output. Record untested routes as **skipped**, not failed.
2. Establish power and data separately. Check stock `adb devices -l` first;
   target one device with `adb -d` or `adb -s <target>`. `adb -d` requires exactly
   one USB ADB device. Inspect stock network ADB and PR #20 only within the owner's
   chosen network scope; its April result is not May validation.
3. For FEL/Route U, pin source and record build configuration, source diff,
   SPL bounds, executable-script hashes and USB behavior over time. A dark FEL
   screen is expected. Do not diagnose every UMS loss from its elapsed time alone.
4. Identify the raw disk afresh and take independent matching full user-area reads.
   Keep their hashes, compressed readback, partition analysis and dumps private.
   Record which hardware boot areas were not captured and whether restore was tested.
5. Parse this unit's MBR/EBRs with bounds and loop checks before choosing boot.
   The generator is not a general malformed-partition-table validator. The vendor
   UDISK entry here extended past disk end; it was neither repaired nor over-read.
   Inspect the legacy boot image and preserve all bytes outside the planned patch.
   State the exact start and length used for a public boot hash; another build's
   padded image can differ from this report's 31,028-sector range. Do not confuse
   an image hash, a whole-partition hash, and the private whole-eMMC hash.
6. Build a per-unit plan and original undo payloads. Review the actual generated
   apply/restore text, the corresponding executable `.scr`, RAM bounds, all CRCs,
   preflight comparisons, and write/readback ordering. Show the owner the exact
   ranges, total bytes, experimental status and recovery limitations before approval.
7. After the approved action, re-read the **entire exposed eMMC** and compare with
   the original backup plus only the planned payloads. Preserve the original backup.
   If the unchanged original matches instead, the guard refused; if neither complete
   state matches, stop. A transfer log or a disk reappearing is insufficient.
8. Remove the FEL card with power off, boot normally, and confirm USB ADB, `id`,
   the expected fingerprint and `sys.boot_completed=1`. Install and physically
   confirm a compatible Home app before disabling the actual vendor packages.
   Read package restrictions before reboot; check disabled states, foreground Home,
   root UID and vendor processes again afterwards. Keep APKs installed for undo;
   `pm enable --user 0 <package>` reverses the package disable.
9. On this Android 6 image there is no SystemUI navigation bar. Use
   `adb -d shell input keyevent KEYCODE_HOME` or `KEYCODE_BACK` when needed;
   `exit` leaves the interactive shell. Compare screenshots with the owner's panel
   observation before diagnosing a display failure. Record WebView/kiosk/network
   tests separately from successful root and Home startup.

## Second unit (larger eMMC), 2026-10-13: access only, no backup

This is a **different unit** from the successful 2026-10-11 report below. It had
the same About-screen firmware, but the larger eMMC. These observations cover
identification, FEL and read-only UMS access only. They do not establish a completed
backup or a successful flash operation in this session.

```text
About model / firmware: PF1007;
  YHK.F-null-A33-1001-D1024-PF1007L-V10-1680.0.20260529
AiMOR version: 6.0.78
Ports (DC jack, or USB-C only): USB-C and microSD/TF;
  DC-jack presence not retained in this session's record
Cable and port that gave USB data: direct Mac connection;
  dock connection did not work in this session;
  exact cable connector type not confirmed in the retained record
T3 USB IDs seen / adb devices output: 1f3a:1000; adb devices empty
T3b network ADB result (port 5555): connection refused at the confirmed frame IP
T4 sunxi-fel version output: AWUSBFEX; soc=00001667(A33)
T5 check-dump stage / chunks: skipped; Route U read-only access attempted
eMMC size in sectors: 30,777,344 (15,758,000,128 bytes)
Boot partition start sector: not established during this access attempt
Boot image SHA-256: not established during this access attempt
Route used and result: Route U RAM-only loader; 1f3a:1010,
  UMS disk 1, WritableMedia=false; backup did not start successfully
Host OS: macOS, Apple silicon MacBook Pro;
  exact macOS version not retained in this session's record
First failed access step after FEL: Executing SPL completed, then
  usb_bulk_send ERROR -7 before Starting U-Boot
```

### Built-in SDXC reader versus an external USB reader

The recovery card was in the MacBook's built-in SDXC reader. `diskutil list
external physical` did not show it. The full `diskutil list` and `diskutil info`
identified removable Secure Digital media with `Internal=true` and an exact size
of 125,671,833,600 bytes. This does not make an internal system disk safe to use.

The repository's `fel-card-macos.py` requires an external USB disk, so it does not
accept this built-in-reader case. A locally reviewed card-preparation script
explicitly recognised that reader while retaining the exact-size, removable-media,
MBR/partition-start, independent prefix-read, exclusive backup and write-readback
checks. The owner reported completion, and subsequent A33 FEL detection confirmed
that the card booted the frame into FEL. This is not a hardware test of the
repository script with a built-in reader. No alternative card-writing script is
published here; use an external USB reader with the existing script rather than
removing its guards.

### SPL failures and delayed UMS enumeration

Several loader attempts stopped with `usb_bulk_send ERROR -7` after SPL, before
the main U-Boot transfer. Later RAM-only diagnostic checkpoints returned to FEL
both before and after DRAM initialisation. A separate 537,792-byte DRAM
transfer/readback matched. These checks demonstrated that those particular runs
could return to FEL and round-trip RAM; they did not prove the cause of earlier
timeouts or validate flash writes.

With the START STOP correction and null-console configuration already present,
the read-only loader eventually exposed `UMS disk 1`, 15,758,000,128 bytes,
`WritableMedia=false`. On one later successful load, immediate USB and disk checks
were empty, then the disks appeared on a subsequent check **without another power
cycle**. The exact elapsed time was not recorded. A single empty check immediately
after `Starting U-Boot` was therefore insufficient to declare that load failed.

### Unmount refusal and later disconnect

The attempted backup stopped before its first read because `storagekitd` dissented
from the normal `diskutil unmountDisk`. A locally guarded retry path would have
rechecked disk identity before and after a forced unmount. In the observed retry,
`diskutil info` failed before that forced-unmount step, and fresh USB/disk checks
showed that the frame had disappeared. The backup did not complete.

The START STOP handler correction was already in the loaded source, so this is
not evidence that adding it fixes this disconnect. Power, USB, U-Boot and macOS
causes were not distinguished. No successful forced-unmount procedure or backup
is claimed. If a disk disappears, stop and re-establish its exact size, USB identity,
media name and read-only state rather than reusing its previous disk number or
weakening the backup guards.

## Related reports

- [#8](https://github.com/wesbos/photo-frame-dashboard/issues/8): same May firmware
  and boot hash, larger eMMC, stock ADB already on; this report adds the differing state.
- [#6](https://github.com/wesbos/photo-frame-dashboard/pull/6): another U-Boot base
  and serial-input workaround. Null input alone did not resolve our 30-second loss.
- [#13](https://github.com/wesbos/photo-frame-dashboard/pull/13): April firmware,
  larger eMMC, Linux backup and build.prop-sector route; its resets remain a separate observation.
- [#14](https://github.com/wesbos/photo-frame-dashboard/pull/14): standalone Mac/SD-only
  setup for April firmware. Its April boot-hash guard was not tested against this May image.
- [#20](https://github.com/wesbos/photo-frame-dashboard/pull/20): temporary Wi-Fi root
  ADB through AiMOR on April firmware, ending at reboot. Not tested on this offline unit.
  Inspected open head `abd7936bfd2f398f284d1a45032189c90ac00034`; inspect newer revisions before use.
- [#24](https://github.com/wesbos/photo-frame-dashboard/issues/24): another May build
  with different ramdisk offsets and MMC/power evidence; the broader UMS comparison is above.
