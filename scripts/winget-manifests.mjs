#!/usr/bin/env node
// Prépare les manifestes winget d'une version d'Ondine. Ne soumet RIEN :
// pour proposer le paquet à Microsoft, voir packaging/winget/README.md.
//
//   node scripts/winget-manifests.mjs 1.0.1
//
// 1. Télécharge l'installateur NSIS de la release GitHub v<version>
//    (Ondine_<version>_x64-setup.exe) et calcule son SHA-256 : winget
//    refuse un installateur dont l'empreinte ne correspond pas.
// 2. Lit la date et les nouveautés de cette version dans CHANGELOG.md
//    (moitié anglaise pour en-US, française pour fr-FR).
// 3. Écrit les 4 manifestes (schéma 1.10.0) dans
//    packaging/winget/manifests/n/Naod6473/Ondine/<version>/ : version,
//    installer, defaultLocale (en-US) et locale (fr-FR).
//
// Sans dépendance (Node 18 ou plus récent). Derrière un proxy : lancer avec
// NODE_USE_ENV_PROXY=1 (Node 22.21 / 24 ou plus récent) pour suivre HTTPS_PROXY.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ID = "Naod6473.Ondine";
const REPO = "https://github.com/Naod6473/Ondine";
const SCHEMA = "1.10.0";

// ── Ce qui ne change pas d'une version à l'autre ─────────────────────────────

const COMMON = {
  Publisher: "Naod6473",
  PublisherUrl: "https://github.com/Naod6473",
  PublisherSupportUrl: `${REPO}/issues`,
  PrivacyUrl: `${REPO}/blob/main/PRIVACY.md`,
  Author: "Naod6473",
  PackageName: "Ondine",
  PackageUrl: REPO,
  License: "MIT",
  LicenseUrl: `${REPO}/blob/main/LICENSE`,
  Copyright: "Copyright (c) 2026 Naod6473",
};

const TEXT = {
  "en-US": {
    ShortDescription:
      "A little island at the top of your Windows screen: music, clipboard, timer, calendar, notes, AI agents and IT tools, without switching windows.",
    Description:
      "Ondine lives at the top of your screen, like an iPhone's Dynamic Island. Move the mouse up: a pill appears, with Ondine, a little water drop that reacts to what happens. Click: the island opens onto your tools (music, clipboard, screenshots, timer, calendar, notes, AI agents, network tools…), without switching windows. Free, open source (MIT), no telemetry, in English and French.",
    Tags: ["dynamic-island", "productivity", "pomodoro", "clipboard", "notes", "calendar", "launcher", "screenshot", "ai-agents", "claude", "it-tools", "tauri"],
  },
  "fr-FR": {
    ShortDescription:
      "Une petite île en haut de l'écran de Windows : musique, presse-papiers, minuteur, agenda, notes, agents IA et outils IT, sans changer de fenêtre.",
    Description:
      "Ondine vit en haut de l'écran, comme l'île dynamique d'un iPhone. Approchez la souris : une pilule apparaît, avec Ondine, la petite goutte qui réagit à ce qui se passe. Cliquez : l'île s'ouvre sur vos outils (musique, presse-papiers, captures, minuteur, agenda, notes, agents IA, outils réseau…), sans changer de fenêtre. Gratuite, open source (MIT), sans télémétrie, en français et en anglais.",
    Tags: ["ile-dynamique", "productivite", "pomodoro", "presse-papiers", "notes", "agenda", "lanceur", "capture-ecran", "agents-ia", "claude", "outils-it", "tauri"],
  },
};

// ── CHANGELOG.md ─────────────────────────────────────────────────────────────
// Même lecture que src/core/changelog.ts : « ## 1.0.1 · 2026-10-07 », puis des
// puces « - français · English » (une puce peut tenir sur plusieurs lignes).

function changelogSection(text, version) {
  const head = /^##\s+\[?v?(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)\]?\s*(?:[·—–-]\s*(.*))?$/;
  let section = null;
  // La puce en cours : elle continue seulement sur une ligne EN RETRAIT. Une
  // ligne vide, un paragraphe hors puce ou un titre (« ### Corrections ») la
  // ferment, exactement comme dans l'appli.
  let open = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith("#")) {
      open = false;
      if (/^##\s/.test(line)) {
        if (section) break; // la section suivante : fini
        const h = head.exec(line);
        if (h && h[1] === version) section = { date: (h[2] ?? "").trim(), items: [] };
      }
      continue;
    }
    if (!section) continue;
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      section.items.push(bullet[1].trim());
      open = true;
    } else if (open && /^\s+\S/.test(line)) {
      section.items[section.items.length - 1] += ` ${line.trim()}`;
    } else {
      open = false;
    }
  }
  return section;
}

/** « Phrase française. · English sentence. » → [français, anglais]. */
function bilingual(item) {
  const m = /[.!?…][)»"]? · /.exec(item);
  const at = m ? m.index + m[0].length - 3 : item.indexOf(" · ");
  return at < 0 ? [item, item] : [item.slice(0, at).trim(), item.slice(at + 3).trim()];
}

// ── YAML (écrit à la main : des chaînes entre guillemets, toujours valides) ─

/** Une valeur simple : telle quelle si elle ne contient que des caractères sûrs, sinon entre guillemets. */
const scalar = (v) => (/^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(String(v)) ? String(v) : JSON.stringify(String(v)));

function yaml(header, fields) {
  const out = [...header, ""];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      out.push(`${key}:`);
      for (const v of value) {
        // Une liste d'objets (Installers) ou de textes (Tags, InstallModes).
        if (typeof v === "object") Object.entries(v).forEach(([k, x], i) => out.push(`${i ? "  " : "- "}${k}: ${scalar(x)}`));
        else out.push(`- ${scalar(v)}`);
      }
    } else if (typeof value === "string" && value.includes("\n")) {
      out.push(`${key}: |-`);
      for (const l of value.split("\n")) out.push(l ? `  ${l}` : "");
    } else {
      out.push(`${key}: ${scalar(value)}`);
    }
  }
  return `${out.join("\n")}\n`;
}

function header(kind) {
  return [
    `# Created with scripts/winget-manifests.mjs (${REPO})`,
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${kind}.${SCHEMA}.schema.json`,
  ];
}

// ── Téléchargement et empreinte ──────────────────────────────────────────────

async function download(url) {
  const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": "ondine-winget-manifests" } });
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status} (la release v… existe-t-elle ?)`);
  return Buffer.from(await res.arrayBuffer());
}

function checkInstaller(bytes) {
  if (bytes.length < 1_000_000) throw new Error(`installateur trop petit (${bytes.length} octets)`);
  if (bytes.subarray(0, 2).toString("latin1") !== "MZ") throw new Error("ce n'est pas un .exe Windows");
  if (!bytes.includes(Buffer.from("Nullsoft", "latin1"))) throw new Error("ce n'est pas un installateur NSIS (Nullsoft)");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const version = process.argv[2]?.replace(/^v/, "");
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error("Usage : node scripts/winget-manifests.mjs <version>   (ex. 1.0.1)");
    process.exit(2);
  }

  const changelog = changelogSection(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"), version);
  if (!changelog) throw new Error(`pas de section « ## ${version} » dans CHANGELOG.md`);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(changelog.date) ? changelog.date : undefined;

  const installerUrl = `${REPO}/releases/download/v${version}/Ondine_${version}_x64-setup.exe`;
  console.log(`Téléchargement de ${installerUrl}…`);
  const bytes = await download(installerUrl);
  checkInstaller(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  console.log(`  ${bytes.length} octets, SHA-256 ${sha256}`);

  const notes = (lang) =>
    changelog.items.length ? changelog.items.map((i) => `- ${bilingual(i)[lang === "fr-FR" ? 0 : 1]}`).join("\n") : undefined;
  const base = { PackageIdentifier: ID, PackageVersion: version };
  const releaseNotesUrl = `${REPO}/releases/tag/v${version}`;

  const files = {
    [`${ID}.yaml`]: yaml(header("version"), {
      ...base,
      DefaultLocale: "en-US",
      ManifestType: "version",
      ManifestVersion: SCHEMA,
    }),
    [`${ID}.installer.yaml`]: yaml(header("installer"), {
      ...base,
      InstallerType: "nullsoft",
      // tauri.conf.json : installMode « currentUser » → installé pour le compte, sans droits d'administrateur.
      Scope: "user",
      InstallModes: ["interactive", "silent", "silentWithProgress"],
      UpgradeBehavior: "install",
      ReleaseDate: date,
      Installers: [{ Architecture: "x64", InstallerUrl: installerUrl, InstallerSha256: sha256 }],
      ManifestType: "installer",
      ManifestVersion: SCHEMA,
    }),
    [`${ID}.locale.en-US.yaml`]: yaml(header("defaultLocale"), {
      ...base,
      PackageLocale: "en-US",
      ...COMMON,
      ShortDescription: TEXT["en-US"].ShortDescription,
      Description: TEXT["en-US"].Description,
      Moniker: "ondine",
      Tags: TEXT["en-US"].Tags,
      ReleaseNotes: notes("en-US"),
      ReleaseNotesUrl: releaseNotesUrl,
      ManifestType: "defaultLocale",
      ManifestVersion: SCHEMA,
    }),
    [`${ID}.locale.fr-FR.yaml`]: yaml(header("locale"), {
      ...base,
      PackageLocale: "fr-FR",
      ...COMMON,
      ShortDescription: TEXT["fr-FR"].ShortDescription,
      Description: TEXT["fr-FR"].Description,
      Tags: TEXT["fr-FR"].Tags,
      ReleaseNotes: notes("fr-FR"),
      ReleaseNotesUrl: releaseNotesUrl,
      ManifestType: "locale",
      ManifestVersion: SCHEMA,
    }),
  };

  const dir = join(ROOT, "packaging", "winget", "manifests", "n", "Naod6473", "Ondine", version);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text, "utf8");
    console.log(`  écrit : ${join("packaging", "winget", "manifests", "n", "Naod6473", "Ondine", version, name)}`);
  }
  console.log("Rien n'a été soumis. Étapes suivantes : packaging/winget/README.md.");
}

main().catch((err) => {
  console.error(`Erreur : ${err.message}`);
  process.exit(1);
});
