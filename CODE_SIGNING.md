# Code signing

## Current status

- **Authenticode (Windows) signing: none.** The installer
  (`Ondine_<version>_x64-setup.exe`) and `Ondine.exe` are not signed with a
  code-signing certificate, so Windows SmartScreen may warn before running them
  ("More info" → "Run anyway"). They are built only by GitHub Actions from this
  repository's public source code
  ([.github/workflows/release.yml](.github/workflows/release.yml)).
- **Update signing: active.** Every installer built by release.yml is signed with
  the Tauri updater key (minisign, secrets `TAURI_SIGNING_PRIVATE_KEY` /
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). Ondine only installs an update whose
  signature matches the public key embedded in the app
  (`src-tauri/tauri.conf.json`, `plugins.updater.pubkey`). This protects automatic
  updates; it does not remove the SmartScreen warning on a first install.

## Team roles

| Role | Members |
|---|---|
| Committers and reviewers | [Naod6473](https://github.com/Naod6473) |
| Release approvers | [Naod6473](https://github.com/Naod6473) |

Releases are started by hand from GitHub Actions. All members use multi-factor
authentication on GitHub. Pull requests from outside contributors are reviewed
before they are merged.

## Privacy

This program will not transfer any information to other networked systems unless
specifically requested by the user or the person installing or operating it, except
for the update check described in the [privacy policy](PRIVACY.md).
