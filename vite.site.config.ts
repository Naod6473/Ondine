import { defineConfig } from "vite";
import { resolve } from "node:path";

// Le script autonome du site vitrine (site/index.html) : la famille gomme
// animée dans des canvas, sans rien de l'appli. `npm run build:site` écrit
// site/media/ondine-gomme.js (un seul fichier, pas de sourcemap), qui est
// committé : GitHub Pages sert le dossier site/ tel quel.
export default defineConfig({
  clearScreen: false,
  build: {
    target: "es2020",
    sourcemap: false,
    emptyOutDir: false,
    outDir: resolve(__dirname, "site/media"),
    lib: {
      entry: resolve(__dirname, "src/mascot/gum-standalone.ts"),
      name: "OndineGomme",
      formats: ["iife"],
      fileName: () => "ondine-gomme.js",
    },
  },
});
