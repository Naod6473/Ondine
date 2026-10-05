import { defineConfig } from "vite";
import { resolve } from "node:path";

// Trois pages : l'île (index.html), la fenêtre de réglages (settings.html)
// et la fenêtre d'annotation des captures (annotate.html).
// Les mascottes de `mascots/` sont trouvées par import.meta.glob dans
// src/mascot/catalog.ts : Vite les embarque au moment du build.
export default defineConfig({
  clearScreen: false,
  // Port fixe : tauri.conf.json pointe dessus (devUrl).
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    // WebView2 est un Chromium récent.
    target: "chrome110",
    sourcemap: false,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        island: resolve(__dirname, "index.html"),
        settings: resolve(__dirname, "settings.html"),
        annotate: resolve(__dirname, "annotate.html"),
      },
    },
  },
});
