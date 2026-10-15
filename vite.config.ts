import { defineConfig } from "vite";
import { resolve } from "node:path";

// Six pages : l'île (index.html), la fenêtre de réglages (settings.html),
// la fenêtre d'annotation des captures (annotate.html), Ondine sur le
// bureau (pet.html), les reflets de l'île sur les autres écrans (mirror.html)
// et l'écran de veille (screensaver.html).
// Les mascottes de `mascots/` sont trouvées par import.meta.glob dans
// src/mascot/catalog.ts : Vite les embarque au moment du build.
export default defineConfig({
  clearScreen: false,
  server: {
    // Port fixe : tauri.conf.json pointe dessus (devUrl).
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    // Ne pas surveiller le Rust : pendant `tauri dev`, cargo écrit et verrouille
    // des centaines de fichiers dans src-tauri/target, et Windows refuse alors
    // de les surveiller (EBUSY), ce qui arrête Vite. Tauri recompile le Rust
    // de lui-même.
    watch: { ignored: ["**/src-tauri/**"] },
  },
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
        pet: resolve(__dirname, "pet.html"),
        pill: resolve(__dirname, "pill.html"),
        // Les reflets de l'île sur les autres écrans (1.2.3, src-tauri/src/island/mirrors.rs).
        mirror: resolve(__dirname, "mirror.html"),
        screensaver: resolve(__dirname, "screensaver.html"),
      },
    },
  },
});
