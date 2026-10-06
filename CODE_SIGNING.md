# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io),
certificate by [SignPath Foundation](https://signpath.org).

## What is signed

Only the Windows installer (`Ondine_<version>_x64-setup.exe`) and the program it
installs (`Ondine.exe`), built by GitHub Actions from this repository's source code
([.github/workflows/release.yml](.github/workflows/release.yml)). Nothing built
outside this pipeline, and no third-party binaries, are signed.

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
