// Module « Musique » : ce qui joue en ce moment, avec lecture/pause, suivant
// et précédent.
//
// Le Rust (src-tauri/src/modules/media.rs) surveille le lecteur de Windows et
// publie "media.changed" quand quelque chose change. Entre deux messages, on
// fait avancer la barre de progression ici, à partir de la dernière position
// connue.

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";

/** Miroir de `NowPlaying` (src-tauri/src/platform/media.rs). */
interface NowPlaying {
  app: string;
  title: string;
  artist: string;
  album: string;
  status: "playing" | "paused" | "stopped" | "changing";
  positionMs: number | null;
  durationMs: number | null;
  canToggle: boolean;
  canNext: boolean;
  canPrevious: boolean;
}

interface MediaState {
  playing: NowPlaying | null;
  /** Numéro de la pochette : change à chaque nouveau morceau. */
  artwork: number;
}

// ── État local, partagé par les vues ─────────────────────────────────────────

let playing: NowPlaying | null = null;
/** Heure (performance.now) où `playing.positionMs` était juste. */
let receivedAt = 0;
let artworkId = 0;
let artworkUrl: string | null = null;
const redraws = new Set<() => void>();

function redrawAll() {
  for (const r of redraws) r();
}

/** Y a-t-il quelque chose à montrer ? (un lecteur arrêté sans titre : non) */
function hasTrack(): boolean {
  return !!playing && playing.status !== "stopped" && playing.title.length > 0;
}

/** Position actuelle estimée, en ms. */
function currentPosition(): number | null {
  if (!playing || playing.positionMs === null) return null;
  const elapsed = playing.status === "playing" ? performance.now() - receivedAt : 0;
  return Math.min(playing.positionMs + elapsed, playing.durationMs ?? Infinity);
}

/** 83 000 → « 1:23 ». */
function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Un nom lisible pour l'appli qui joue. Windows donne « Spotify.exe », ou pour
 * une appli du Store quelque chose comme « Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic ».
 */
function appName(id: string): string {
  const last = id.split("!").pop() ?? id;
  return last.replace(/\.exe$/i, "").replace(/^Microsoft\./, "").replace(/_[a-z0-9]{13}$/, "") || id;
}

/** La pochette, ou une note de musique à la place. */
function cover(size: "small" | "large"): HTMLElement {
  if (artworkUrl) return el("img", { class: `media-cover ${size}`, src: artworkUrl, alt: "" });
  return el("div", { class: `media-cover ${size} empty` }, "🎵");
}

/** Lance une commande du lecteur ; une erreur (lecteur fermé…) s'affiche sans compter comme plantage. */
async function control(api: ModuleApi, command: "toggle" | "next" | "previous") {
  try {
    await api.invoke(command);
  } catch (err) {
    api.notify({ title: "Le lecteur ne répond pas", body: errorText(err), icon: "🎵", priority: "low", key: "media-error" });
  }
}

/** Trois petites barres qui dansent quand la musique joue. */
function equalizer(): HTMLElement {
  const on = playing?.status === "playing";
  return el("span", { class: `media-eq ${on ? "on" : ""}`, "aria-hidden": "true" }, el("i"), el("i"), el("i"));
}

export const media: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    let first = true;
    const apply = async (state: MediaState) => {
      const before = playing;
      const wasShown = hasTrack();
      playing = state.playing;
      receivedAt = performance.now();

      if (state.artwork !== artworkId) {
        artworkId = state.artwork;
        artworkUrl = null;
        if (playing) {
          try {
            artworkUrl = (await api.invoke<{ url: string | null }>("artwork")).url;
          } catch {
            artworkUrl = null; // pas de pochette : la note de musique la remplace
          }
        }
      }

      // Nouveau morceau qui joue : on le montre (pas au démarrage de l'île).
      const newTrack = !!playing && (!before || before.title !== playing.title || before.artist !== playing.artist);
      if (!first && newTrack && playing?.status === "playing" && api.settings().announceTracks) {
        api.notify({
          title: playing.title,
          body: playing.artist || appName(playing.app),
          icon: "🎵",
          priority: "low",
          key: "media-track",
        });
      }
      first = false;

      if (wasShown !== hasTrack()) api.refreshCompact();
      redrawAll();
    };

    api.on("media.changed", (msg) => void apply(msg.payload as MediaState));
    // Au démarrage (ou après réactivation), on demande l'état actuel.
    api
      .invoke<MediaState>("state")
      .then(apply)
      .catch(() => {}); // hors de l'appli (navigateur) : rien en lecture

    // Changer le réglage « pilule » doit changer la vue compacte tout de suite.
    api.onSettingsChange(() => api.refreshCompact());

    return () => {
      playing = null;
      artworkId = 0;
      artworkUrl = null;
    };
  },

  views: {
    compactWhen: (api) => hasTrack() && Boolean(api.settings().showCompact),

    compact(root) {
      const draw = () => {
        root.replaceChildren();
        if (!playing) return;
        root.append(
          el(
            "div",
            { class: "media-compact" },
            cover("small"),
            el("span", { class: "media-line" }, el("b", {}, playing.title), playing.artist ? ` · ${playing.artist}` : ""),
            equalizer(),
          ),
        );
      };
      draw();
      redraws.add(draw);
      return () => redraws.delete(draw);
    },

    expanded(root, api) {
      const draw = () => {
        root.replaceChildren();
        if (!hasTrack() || !playing) {
          root.append(
            el(
              "p",
              { class: "muted" },
              "Rien en lecture. Lance de la musique dans Spotify, ton navigateur ou un autre lecteur : elle apparaîtra ici.",
            ),
          );
          return;
        }
        const p = playing;
        const button = (label: string, title: string, enabled: boolean, command: "toggle" | "next" | "previous") =>
          el("button", { class: "media-btn", title, disabled: !enabled, onclick: api.handler(() => control(api, command)) }, label);

        const bar = el("div", { class: "media-bar" }, el("div", { class: "media-bar-fill" }));
        const times = el("div", { class: "media-times" }, el("span"), el("span"));

        root.append(
          el(
            "div",
            { class: "media-full" },
            cover("large"),
            el(
              "div",
              { class: "media-info" },
              el("div", { class: "media-title" }, p.title),
              el("div", { class: "media-artist" }, [p.artist, p.album].filter(Boolean).join(" · ")),
              el("div", { class: "muted media-app" }, appName(p.app)),
              p.durationMs ? el("div", { class: "media-progress" }, bar, times) : null,
              el(
                "div",
                { class: "media-controls" },
                button("⏮", "Précédent", p.canPrevious, "previous"),
                button(p.status === "playing" ? "⏸" : "▶", p.status === "playing" ? "Pause" : "Lecture", p.canToggle, "toggle"),
                button("⏭", "Suivant", p.canNext, "next"),
              ),
            ),
          ),
        );
        tick();
      };

      // La barre avance toute seule entre deux messages du Rust.
      const tick = () => {
        const fill = root.querySelector<HTMLElement>(".media-bar-fill");
        const [now, total] = root.querySelectorAll<HTMLElement>(".media-times span");
        const pos = currentPosition();
        const duration = playing?.durationMs;
        if (!fill || pos === null || !duration) return;
        fill.style.width = `${Math.min(100, (pos / duration) * 100)}%`;
        now.textContent = clock(pos);
        total.textContent = clock(duration);
      };

      draw();
      redraws.add(draw);
      const timer = window.setInterval(tick, 500);
      return () => {
        redraws.delete(draw);
        window.clearInterval(timer);
      };
    },
  },
};
