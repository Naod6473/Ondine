# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io),
certificate by [SignPath Foundation](https://signpath.org) — **requested, not yet
in place** (see "Current status" below).

## Current status

- **Authenticode (Windows) signing: not active yet.** Ondine has applied to the
  SignPath Foundation program. The release pipeline
  ([.github/workflows/release.yml](.github/workflows/release.yml)) does not contain
  a SignPath signing step today, so the installer and `Ondine.exe` published so far
  are **not** Authenticode-signed, and Windows SmartScreen may warn before running
  them ("More info" → "Run anyway").
- **Update signing: active.** Every installer built by release.yml is signed with
  the Tauri updater key (minisign, secrets `TAURI_SIGNING_PRIVATE_KEY` /
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). Ondine only installs an update whose
  signature matches the public key embedded in the app
  (`src-tauri/tauri.conf.json`, `plugins.updater.pubkey`). This protects automatic
  updates; it does not remove the SmartScreen warning on a first install.

This file will be updated when the SignPath step is added to release.yml.

## What is signed

Once SignPath signing is in place: only the Windows installer
(`Ondine_<version>_x64-setup.exe`) and the program it installs (`Ondine.exe`),
built by GitHub Actions from this repository's source code
([.github/workflows/release.yml](.github/workflows/release.yml)). Nothing built
outside this pipeline, and no third-party binaries, are signed.

Today: only the update signature (minisign) described above.

## Team roles

| Role | Members |
|---|---|
| Committers and reviewers | [Naod6473](https://github.com/Naod6473) |
| Approvers | [Naod6473](https://github.com/Naod6473) |

Every release signing request is approved by hand. All members use multi-factor
authentication on GitHub and SignPath. Pull requests from outside contributors are
reviewed before they are merged.

## Privacy

This program will not transfer any information to other networked systems unless
specifically requested by the user or the person installing or operating it, except
for the update check described in the [privacy policy](PRIVACY.md).
