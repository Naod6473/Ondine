// Lance les tests de l'interface (npm test), sans aucune dépendance en plus :
//   1. TypeScript compile tests/front/*.test.ts (et ce qu'ils importent de src/)
//      dans .tests-build (voir tsconfig.test.json) ;
//   2. le lanceur de tests intégré à Node (`node --test`) les exécute.
//
// Marche pareil sous Windows et sous Linux. Arguments en plus : passés à
// `node --test` (ex. `npm test -- --test-name-pattern=alwaysMini`).

import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

// Pas dans node_modules : `node --test` ignore ce dossier.
const OUT = ".tests-build";
const require = createRequire(import.meta.url);

function run(args) {
  const r = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// 1. Compiler (on repart d'un dossier vide : pas de vieux test oublié).
rmSync(OUT, { recursive: true, force: true });
run([require.resolve("typescript/bin/tsc"), "-p", "tsconfig.test.json"]);
// Le package.json du projet dit "type": "module" ; le code compilé est en
// CommonJS : on le dit à Node pour ce dossier.
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "package.json"), '{ "type": "commonjs" }\n');

// 2. Trouver les tests compilés et les lancer (depuis la racine du projet :
// les tests lisent des fichiers comme src/core/i18n-en.json).
function tests(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return tests(p);
    return e.name.endsWith(".test.js") ? [p] : [];
  });
}
// Barres obliques « / » : `node --test` lit ses arguments comme des motifs
// (glob), où le « \ » de Windows a un autre sens.
const files = tests(join(OUT, "tests")).map((f) => f.replaceAll("\\", "/"));
if (files.length === 0) {
  console.error("Aucun test trouvé dans", OUT);
  process.exit(1);
}
run(["--test", ...process.argv.slice(2), ...files]);
