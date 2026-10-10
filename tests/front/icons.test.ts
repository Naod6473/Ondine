// Chaque module a sa vraie icône dans les deux packs (src/island/icon.ts) :
// une image en couleur (src/assets/icons/*.webp) et une icône au trait
// (src/assets/icons-line/*.svg). Jamais un emoji brut dans le style épuré.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** BY_EMOJI, lu dans le source de icon.ts (le fichier utilise import.meta.glob, pas importable ici). */
function byEmoji(): Record<string, string> {
  const src = readFileSync("src/island/icon.ts", "utf8");
  const block = src.slice(src.indexOf("const BY_EMOJI"), src.indexOf("};", src.indexOf("const BY_EMOJI")));
  const map: Record<string, string> = {};
  for (const m of block.matchAll(/"([^"]+)":\s*"([^"]+)"/g)) map[m[1]] = m[2];
  return map;
}

const MODULES = readdirSync("src/modules", { withFileTypes: true }).filter((e) => e.isDirectory());
const MAP = byEmoji();

test("chaque module a une icône au trait (style épuré)", () => {
  for (const dir of MODULES) {
    const m = JSON.parse(readFileSync(join("src/modules", dir.name, "manifest.json"), "utf8")) as { id: string; icon: string };
    const name = MAP[m.icon];
    // 🎉 (Bilan) passe par les pictogrammes au trait (LINE_ONLY) : confetti.
    const svg = name ?? (m.icon === "🎉" ? "confetti" : undefined);
    assert.ok(svg, `${m.id} : ${m.icon} absent de BY_EMOJI`);
    assert.ok(existsSync(`src/assets/icons-line/${svg}.svg`), `${m.id} : icons-line/${svg}.svg manquant`);
  }
});

test("Animations de l'île, Ondine et les fenêtres, Équipe : image en couleur et trait", () => {
  for (const [emoji, name] of [["🌈", "halos"], ["🪟", "windowlife"], ["🤝", "team"]]) {
    assert.equal(MAP[emoji], name);
    assert.ok(existsSync(`src/assets/icons/${name}.webp`), `icons/${name}.webp manquant`);
    const svg = readFileSync(`src/assets/icons-line/${name}.svg`, "utf8");
    // Même gabarit que les autres icônes au trait (Phosphor regular, 256 × 256, couleur du texte).
    assert.match(svg, /viewBox="0 0 256 256"/);
    assert.match(svg, /fill="currentColor"/);
  }
});
