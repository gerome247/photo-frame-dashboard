# PF1007L / AiMOR May 2026 (`20260519`) firmware: macOS Route S dump + Route U patch

This PF1007L reached root ADB over USB on macOS (Apple silicon) without Windows or WSL.
Route U's `ums` backup never worked on this unit, even with the
[U-Boot fixes](pf1007l-start-here.md#u-boot-settings-that-fixed-ums-problems) from
[#24](https://github.com/wesbos/photo-frame-dashboard/issues/24). So the eMMC was dumped
with [Route S](allwinner-a33-sdcard-adb-wifi.md) (read-only, eMMC at 12 MHz), and the boot
partition was then patched with [Route U](allwinner-a33-mainline-uboot.md)'s
`boot-patch.py` over FEL.

**This combination has been tested on one unit only.** It is a record of one experiment, not a
supported route. It does not make another unit's offsets safe to reuse, and Route S's
`build-write.sh` hash guard was not edited or used. Run T1 to T6 of the
[start-here guide](pf1007l-start-here.md) on your own unit first, and compare your boot hash.

## Unit report

```text
About model / firmware: YHK.F-null-A33-1001-D1024-PF1007L-FL-AIMOR-OS.0.20260519
Ports: USB-C only
Cable and port that gave USB data: USB-A to USB-C cable only (USB-C to USB-C: nothing);
  monitor USB hub and a direct Mac port behaved the same
T3 USB IDs / ADB: no stock ADB
T4 sunxi-fel version: A33 (FEL works)
Route U ums: see "Route U ums failure" below
T5 check-dump: stage finished, emmc_dev ok, all 32 chunks ok, sectors 0-4194303 without gaps
eMMC size: 15,758,000,128 bytes (30,777,344 sectors), MBR with 15 partitions
Partitions (start sector): p6 boot 172032 (size 65536), p7 system 237568, p1 UDISK 4366336
Boot image SHA-256, sector 172032:
  31,028 sectors: 9a6e2456952f3dc2b99e64ea021321397bdc824364b5c8b42f503f847261630a (matches #24)
  29,292 sectors: 71807e93aa8875afcfba70112fbec075c33737b06fd22ae7807bc757a834dc64
                  (matches a comment in #24)
Route / result: Route S dump, Route U boot-patch over FEL;
  then USB 1f3a:1002, adb -d shell id -> uid=0(root)
Host OS: macOS 26, Apple silicon
First failed step: Route U ums (disk appears, frame resets into FEL a few seconds later)
```

## Route U ums failure

- Stock Route U build: U-Boot started, but no USB disk ever enumerated (as in
  [#36](https://github.com/wesbos/photo-frame-dashboard/issues/36)).
- With the #24 changes (eMMC 4-bit at 26 MHz, `ums_read_sector` retries up to 8): the eMMC disk
  appeared (15,758,000,128 bytes, MBR with 15 partitions), then the frame reset into FEL a few
  seconds later. This repeated every time, on a monitor USB hub and on a direct Mac port.

## Route S U-Boot build on macOS (Docker)

Clean `v2025.10` checkout (commit `e50b1e8715011def8aff1588081a2649a2c6cd47`) in
`diagnostics/u-boot-sdboot`. One local change, for the
[May dump fix from #24](pf1007l-start-here.md#u-boot-settings-that-fixed-ums-problems):
in `arch/arm/dts/sun8i-a33-sinlinx-sina33.dts`, add after `&mmc2 {`:

```dts
	max-frequency = <12000000>;
```

Build from the repository root:

```sh
docker run --rm -v "$PWD":/repo -w /repo ubuntu:24.04 bash -c '
  apt-get update -qq &&
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq gcc-arm-linux-gnueabihf bison flex swig \
    libssl-dev libgnutls28-dev python3-dev python3-setuptools python3-pyelftools bc \
    device-tree-compiler make gcc git >/dev/null
  git config --global --add safe.directory "*"
  bash scripts/a33-sdboot/build.sh /repo/diagnostics/u-boot-sdboot'
```

Clock-skew warnings from the bind mount are harmless. The output `u-boot-sunxi-with-spl.bin`
was 489,016 bytes.

## Writing the SD card on macOS

Card: 62.5 GB, MBR, one FAT32 partition **starting at sector 8192**. It worked although T5 asks
for 32 GB or smaller. macOS Disk Utility starts the partition at sector 2048, which is too close
to the U-Boot area: do not reformat the card with Disk Utility.

Use the repository's guarded path for this step — `scripts/a33-sdboot/build-macos.sh`, then
`card-macos.py prepare` (see the [SD card guide](allwinner-a33-sdcard-adb-wifi.md)):

```sh
diskutil list external physical
diskutil info diskN | grep 'Disk Size'   # <exact-bytes> is the number of bytes shown
sudo python3 -I scripts/a33-sdboot/card-macos.py prepare diskN <exact-bytes>
```

It formats the card with the FAT partition at sector 8192 (not Disk Utility's 2048, which is too
close to the U-Boot area), verifies the card by exact byte size, keeps a backup of what it
overwrites, writes U-Boot at 8 KiB, and reads the write back. This unit's 12 MHz build differs
from the repository build, so what actually ran is recorded below.

**Record of what this unit actually ran** (a copy of the contributor's manual `dd`; it has no
exact-size or confirmation guard, so do not copy it — use `card-macos.py` above):

```sh
mkdir -p backups
# 1. Back up the first 1 MiB of the card
sudo dd if=/dev/rdiskN of=backups/sd-card-head-before-routeS.bin bs=4096 count=256

# 2. Pad the image to a 4 KiB multiple with the card's own bytes, then write it
IMG=diagnostics/u-boot-sdboot/u-boot-sunxi-with-spl.bin
SZ=$(stat -f%z $IMG); BLK=$(( (SZ+4095)/4096 ))
sudo dd if=/dev/rdiskN of=/tmp/region.bin bs=4096 skip=2 count=$BLK
cp $IMG /tmp/padded.bin && dd if=/tmp/region.bin bs=1 skip=$SZ >> /tmp/padded.bin
sudo dd if=/tmp/padded.bin of=/dev/rdiskN bs=4096 seek=2 conv=notrunc

# 3. Read back; both hashes must match
sudo dd if=/dev/rdiskN bs=4096 skip=2 count=$BLK | shasum -a 256
shasum -a 256 /tmp/padded.bin
```

Then remount the card and copy `a33.scr` to the FAT root, as in the
[SD card guide](allwinner-a33-sdcard-adb-wifi.md).

## Dump

The dump took about 70 minutes at 12 MHz. The screen stays dark the whole time.
`check-dump.py` passed (see the unit report). The boot hash above comes from the dump chunks.

Afterwards the card's FEL stub (used by Route U) was restored by writing the saved 1 MiB head back
with `dd` and verifying its hash. `sunxi-fel version` showed A33 again.

## Boot patch with Route U tools and the Route S dump

```sh
# zsh does not expand hex brace ranges like emmc-{00..1f}; the glob sorts correctly
cat backups/pf1007-emmc/emmc-*.bin > backups/a33-emmc-first2g.img   # 2,147,483,648 bytes
python3 -I scripts/a33-uboot/boot-patch.py backups/a33-emmc-first2g.img 172032
```

`boot-patch.py` reads only the MBR/EBR chain and the boot partition, so the first 2 GiB are
enough for it. As a backup this is **partial** (everything past 2 GiB was not captured), so this
unit's backup does not meet the repo's complete-device backup rule; the Route S dump covers every
sector the patch wrote. It reported a ramdisk slot of 4,853,760 bytes at +10,143,744, write ranges
ramdisk `[191844, 201324)` and header `[172032, 172034)`, and all checks passed. These values are
for this unit; let the script compute yours.

Loaded with the repository's command and the read-only Route U build (the write script uses
`mmc write` directly, not `ums`):

```sh
sunxi-fel -v uboot u-boot-sunxi-with-spl.bin \
  write 0x50000000 orig-header.bin write 0x51000000 orig-ramdisk.bin \
  write 0x52000000 new-header.bin write 0x53000000 new-ramdisk.bin \
  write 0x43100000 write-boot.scr
```

The trailing `ums` showed the same appear-then-reset loop; that was harmless here. After removing
the card, Android booted normally (boot logo "love is sharing"), USB showed `1f3a:1002`, and
`adb -d shell id` returned `uid=0(root)`.

### Limitation: verification

`emmc-macos.py verify` and `verify-original` need a full image and working `ums`. Neither was
available, so the write was verified only by the boot result. The undo path is `restore-boot.scr`
with the same payloads.

## After root

Vendor ports 7806 and 10546-10550 were blocked at the router before the frame went online. Then:

```sh
adb -d shell pm disable com.efercro.os.aimor
adb -d shell pm disable com.yhk.qeota
adb -d shell pm disable com.DeviceTest
adb -d shell 'mount -o remount,rw /system && chmod 4750 /system/xbin/su && mount -o remount,ro /system'
```

The `chmod` tightens `su` from world-executable to group-only (root:shell). The original mode was
not recorded before the change; the undo is `chmod 6755` (the shipped setuid mode) or `chmod 755`
with root-only ownership if you want no shell `su` at all. A post-root readback of the boot
partition (`dd` it back over ADB and compare hashes) would also close the verification gap above;
it was not done on this unit.

## macOS notes

- On macOS 26, `system_profiler SPUSBDataType` returns nothing. Use `SPUSBHostDataType`.
- Files created with `sudo dd` are owned by root. `sudo chown $USER` them before scripts use them.

## Related reports

- [#24](https://github.com/wesbos/photo-frame-dashboard/issues/24): same May `20260519` boot
  image; source of the 4-bit/26 MHz, read-retry and 12 MHz Route S changes.
- [#36](https://github.com/wesbos/photo-frame-dashboard/issues/36): `ums` never enumerates on
  `20260519`, matching this unit before the #24 changes.
- [May `20260529` macOS report](pf1007l-macos-20260529-report.md): Route U with a START STOP fix
  on a different May build.
