<!--
Thanks for contributing. Many people, and their AI agents, will follow these docs and run these
scripts on their own computers and frames. Please check each box, or say why it doesn't apply.
-->

## What this adds

<!-- Device (model, firmware string, SoC), what you found or changed, and which docs or scripts it touches. -->

## Tested on

<!-- Which unit(s), which host OS, what worked and what failed. Keep observations separate from guesses. -->

## Checklist

**Privacy**

- [ ] No serials, MAC addresses, eMMC CIDs, IMEIs, Wi-Fi names or passwords, public IPs, tokens or emails
- [ ] No firmware dumps, vendor APKs, vendor boot images or other vendor binaries
- [ ] No whole-disk hashes (boot image and firmware hashes are fine)
- [ ] Images show no faces, homes or personal photos

**Safety for people who run this**

- [ ] Every download is from an official source and pinned by SHA-256
- [ ] No `curl | sh`, `eval` of downloaded content, or obfuscated code
- [ ] Raw-disk and flash writes check the target (exact size, identity) and the current contents before writing, and read back afterwards
- [ ] Undo steps are documented
- [ ] Scripts send nothing off the machine, other than documented downloads
- [ ] Docs contain no hidden text or instructions aimed at AI agents beyond normal how-to steps

**Repo fit**

- [ ] I checked open PRs and issues for the same device or finding
- [ ] Device findings go in the device's doc in `docs/`. For a PF1007L, this is
      [pf1007l-start-here.md](../docs/pf1007l-start-here.md) or its linked guides, not a separate tree.
