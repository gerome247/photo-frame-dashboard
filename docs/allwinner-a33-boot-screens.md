# PF1007L: change the boot logo and the boot animation

This procedure replaces the three images that the PF1007L shows when it starts.
It was done on one unit with this firmware:
`YHK.F-null-A33-1001-D1024-PF1007L-321-OS-AIMOR.0.20260113`.

You must have root ADB. See [allwinner-a33-pf1007l.md](allwinner-a33-pf1007l.md) or
[allwinner-a33-sdcard-adb-wifi.md](allwinner-a33-sdcard-adb-wifi.md).

## 1. The three boot stages

| Stage | File | Format | Partition |
| --- | --- | --- | --- |
| 1. Bootloader logo | `/bootloader/bootlogo.bmp` | BMP, 24-bit, 800 × 1280, 3,072,054 bytes | `bootloader` (p2), FAT16, mounted read-write |
| 2. Early logo | `/system/media/initlogo.rle` | Raw pixels, BGRA, 800 × 1280, 4,096,000 bytes | `system` (p7), ext4, read-only |
| 3. Boot animation | `/system/media/bootanimation.zip` | Zip of PNG frames, no compression | `system` (p7), ext4, read-only |

The panel is a portrait panel. Thus, the files for stages 1 and 2 are portrait (800 × 1280).
Turn a landscape image 90° clockwise to make them. The animation (stage 3) is landscape.

`initlogo.rle` has the extension `.rle`, but the file is not run-length encoded.
It holds 1,024,000 pixels of 4 bytes each, in the sequence blue, green, red, alpha.

The stock files have these MD5 values:

| File | MD5 |
| --- | --- |
| `bootlogo.bmp` | `f98a6aeb517759869ad503aaf9660c71` |
| `initlogo.rle` | `789725e758999e3833b0eaa41e67faf6` |
| `bootanimation.zip` | `894ac12f84feefb7e1202ed5648c2810` |

## 2. Back up the stock files

Do this before you change a file. Keep the copies private.

```sh
mkdir -p backups/boot-screens
adb exec-out 'cat /bootloader/bootlogo.bmp'          > backups/boot-screens/bootlogo.bmp
adb exec-out 'cat /system/media/initlogo.rle'        > backups/boot-screens/initlogo.rle
adb exec-out 'cat /system/media/bootanimation.zip'   > backups/boot-screens/bootanimation.zip
adb shell 'md5sum /bootloader/bootlogo.bmp /system/media/initlogo.rle /system/media/bootanimation.zip'
md5sum backups/boot-screens/*
```

The MD5 values of the copies must be the same as the values on the frame.

Also back up the whole `bootloader` partition. Its FAT is not consistent with the partition size
(see section 4), so a file copy alone may not be enough to undo a bad write:

```sh
adb exec-out 'dd if=/dev/block/mmcblk0p2 bs=65536 2>/dev/null' > backups/boot-screens/bootloader-p2.img
adb shell 'md5sum /dev/block/mmcblk0p2'
md5sum backups/boot-screens/bootloader-p2.img
```

Check that `mmcblk0p2` is the bootloader partition on your unit first (`ls -l /dev/block/by-name`).
The two MD5 values must match.

## 3. Make the logo files

You need Python 3 with Pillow. Start with a landscape image of 1280 × 800 pixels.

```sh
python3 - <<'PY'
from PIL import Image
im = Image.open('logo-1280x800.png').convert('RGB')
assert im.size == (1280, 800)
p = im.transpose(Image.Transpose.ROTATE_270)          # 90° clockwise, now 800 × 1280
p.save('bootlogo.bmp')
open('initlogo.rle', 'wb').write(p.convert('RGBA').tobytes('raw', 'BGRA'))
PY
ls -l bootlogo.bmp initlogo.rle
```

`bootlogo.bmp` must be 3,072,054 bytes. `initlogo.rle` must be 4,096,000 bytes.
If a size is different, stop.

## 4. Write the bootloader logo

WARNING: DO NOT MAKE A NEW FILE ON `/bootloader`. DO NOT MAKE A FILE ON IT LARGER.
THE FAT BOOT SECTOR GIVES 262,144 SECTORS (128 MIB). THE PARTITION HAS 65,536 SECTORS (32 MIB).
A NEW CLUSTER CAN BE PAST THE END OF THE PARTITION. THE WRITE THEN FAILS AND CAN DAMAGE THE FAT.

This size difference was seen on one unit only. Other units can have a correct FAT.
Do the procedure below on all units. To see the values on your unit, do these commands:

```sh
adb shell cat /sys/class/block/mmcblk0p2/size
adb shell df /bootloader
```

The first value is the partition size in 512-byte sectors (65,536 = 32 MiB).
`df` shows the size that the FAT gives. On the unit above, `df` showed 127.7M.
If `df` shows more than the partition size, your unit has the same problem.

The procedure writes the new file into the clusters of the existing file.
The size does not change, so the file system allocates no new clusters.

1. Push the file and compare it:

   ```sh
   adb push bootlogo.bmp /data/local/tmp/bootlogo.bmp
   adb shell md5sum /data/local/tmp/bootlogo.bmp
   md5sum bootlogo.bmp
   ```

2. Write it in place. Replace `<old-md5>` with the MD5 of the current file on the frame:

   ```sh
   adb shell 'set -e
   [ "$(md5sum /bootloader/bootlogo.bmp | cut -d" " -f1)" = <old-md5> ]
   [ "$(stat -c %s /data/local/tmp/bootlogo.bmp)" = 3072054 ]
   /sbin/busybox dd if=/data/local/tmp/bootlogo.bmp of=/bootloader/bootlogo.bmp bs=65536 conv=notrunc,fsync
   sync; echo 3 > /proc/sys/vm/drop_caches
   md5sum /bootloader/bootlogo.bmp; df /bootloader
   rm /data/local/tmp/bootlogo.bmp'
   ```

3. The new MD5 must be the MD5 of your `bootlogo.bmp`. The used space shown by `df` must not change.

## 5. Make the boot animation

### 5.1 Format

The zip holds `desc.txt` and one folder of PNG frames for each part.

```
<width> <height> <fps>
p <count> <pause> <folder>
```

- `width` and `height` are the size of the frames. Android puts the frames in the center
  of the 1280 × 800 screen. The rest of the screen is black.
- `fps` is one value for all parts.
- `count` is the number of times the part plays. `0` plays the part again and again until the
  boot is complete.
- `pause` is the number of frames to wait after the part.
- The frames play in the sequence of their file names. Use names such as `000.png`, `001.png`.

Examples:

| `desc.txt` | Effect |
| --- | --- |
| `1280 800 20` / `p 1 0 part0` / `p 0 0 part1` | Plays `part0` one time, then loops `part1` |
| `677 800 10` / `p 0 0 part0` | Loops `part0` at 10 frames per second |

The zip must use no compression (stored entries). Android cannot read compressed entries.

### 5.2 Memory limit

CAUTION: ANDROID 6 KEEPS EVERY FRAME OF A LOOPING PART IN GPU MEMORY.

Each frame becomes a texture. Android increases the size of the texture to the next power of two
in each direction. Each pixel uses 4 bytes. The frame has 1 GiB of RAM in total.

| Frame size | Texture size | Memory for each frame |
| --- | --- | --- |
| 1280 × 800 | 2048 × 1024 | 8 MiB |
| 677 × 800 | 1024 × 1024 | 4 MiB |
| 512 × 512 | 512 × 512 | 1 MiB |

Keep the total for a looping part at 100 MiB or less.
For example, 24 frames of 677 × 800 use 96 MiB. 56 frames of 1280 × 800 use 448 MiB.
To use less memory, make the frames smaller, use fewer frames, or use a lower `fps`.
A part with `count` 1 is not kept in memory.

### 5.3 Build the zip

Put the frames in `part0/`. Then:

```sh
python3 - <<'PY'
import os, zipfile
with zipfile.ZipFile('bootanimation.zip', 'w', zipfile.ZIP_STORED) as z:
    z.writestr('desc.txt', '677 800 10\np 0 0 part0\n')
    for f in sorted(os.listdir('part0')):
        z.write(os.path.join('part0', f), 'part0/' + f)
PY
unzip -v bootanimation.zip | grep -c Stored
```

Change the `desc.txt` line to match your frames. The count of `Stored` entries must be the count of
files in the zip.

To make frames from an animated GIF or WebP, use Pillow. Read each frame with `seek()`.
Pillow does not give the frame durations of some WebP files. Read them from the `ANMF` chunks of
the file (24-bit value at byte 12 of each chunk, in milliseconds). Repeat frames to match the
durations at your `fps`.

## 6. Write the files in `/system`

This step replaces `initlogo.rle` and `bootanimation.zip`. It keeps the stock files on the frame.

1. Push the files and compare them:

   ```sh
   adb push initlogo.rle /data/local/tmp/initlogo.rle
   adb push bootanimation.zip /data/local/tmp/bootanimation.zip
   adb shell 'md5sum /data/local/tmp/initlogo.rle /data/local/tmp/bootanimation.zip'
   md5sum initlogo.rle bootanimation.zip
   ```

2. Replace the files:

   ```sh
   adb shell 'set -e
   [ ! -e /system/stock-bootscreen ]
   mount -o remount,rw /system
   mkdir /system/stock-bootscreen
   mv /system/media/initlogo.rle /system/stock-bootscreen/initlogo.rle
   mv /system/media/bootanimation.zip /system/stock-bootscreen/bootanimation.zip
   cp /data/local/tmp/initlogo.rle /system/media/initlogo.rle
   cp /data/local/tmp/bootanimation.zip /system/media/bootanimation.zip
   chown root:root /system/media/initlogo.rle /system/media/bootanimation.zip
   chmod 0644 /system/media/initlogo.rle /system/media/bootanimation.zip
   sync; mount -o remount,ro /system; echo 3 > /proc/sys/vm/drop_caches
   md5sum /system/media/initlogo.rle /system/media/bootanimation.zip /system/stock-bootscreen/*
   mount | grep " /system "
   rm /data/local/tmp/initlogo.rle /data/local/tmp/bootanimation.zip'
   ```

   The command stops if `/system/stock-bootscreen` already exists. For a second change, move the
   current files to a different name in that folder.

3. Make sure that:
   - The MD5 values in `/system/media` are the values of your new files.
   - The MD5 values in `/system/stock-bootscreen` are the stock values in section 1.
   - `/system` shows `ro`.

## 7. Test

1. Reboot the frame:

   ```sh
   adb reboot
   ```

2. Watch the screen: the bootloader logo, then the early logo, then the animation.
3. After the boot, read the log:

   ```sh
   adb shell 'logcat -d | grep -i bootanimation'
   ```

   `couldn't find audio_conf.txt` is normal. It means that no boot sound is set.

## 8. Undo

- Bootloader logo: do section 4 with the backup `bootlogo.bmp` from section 2.
- Early logo and animation:

  ```sh
  adb shell 'set -e; mount -o remount,rw /system
  cp /system/stock-bootscreen/initlogo.rle /system/media/initlogo.rle
  cp /system/stock-bootscreen/bootanimation.zip /system/media/bootanimation.zip
  chown root:root /system/media/initlogo.rle /system/media/bootanimation.zip
  chmod 0644 /system/media/initlogo.rle /system/media/bootanimation.zip
  sync; mount -o remount,ro /system
  md5sum /system/media/initlogo.rle /system/media/bootanimation.zip'
  ```

  The MD5 values must be the stock values in section 1.
