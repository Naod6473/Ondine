// Module « Musique » : ce qui joue en ce moment, avec lecture/pause, suivant
// et précédent. La barre de progression est cliquable (et glissable) quand le
// lecteur accepte qu'on change la position.
//
// Le Rust (src-tauri/src/modules/media.rs) surveille le lecteur de Windows et
// publie "media.changed" quand quelque chose change. Entre deux messages, on
// fait avancer la barre de progression ici, à partir de la dernière position
// connue.

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";
import { pacedInterval, setText } from "../../core/perf";

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
  /** Le lecteur accepte-t-il qu'on change la position ? */
  canSeek: boolean;
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
/** Pendant qu'on glisse sur la barre : la position visée (ms), sinon null. */
let scrub: number | null = null;

function redrawAll() {
  for (const r of redraws) r();
}

/** Y a-t-il quelque chose à montrer ? (un lecteur arrêté sans titre : non) */
function hasTrack(): boolean {
  return !!playing && playing.status !== "stopped" && playing.title.length > 0;
}

/** Position actuelle estimée, en ms (ou celle visée pendant un glissé). */
function currentPosition(): number | null {
  if (scrub !== null) return scrub;
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
async function control(api: ModuleApi, command: "toggle" | "next" | "previous" | "seek", args?: Record<string, unknown>) {
  try {
    await api.invoke(command, args);
  } catch (err) {
    api.notify({ title: "Le lecteur ne répond pas", body: errorText(err), icon: "🎵", priority: "low", key: "media-error" });
  }
}

/** Les pictogrammes des petits boutons de la pilule, dessinés en SVG (nets à toute taille). */
const GLYPHS = {
  previous: "M6 5h2v14H6zM20 5v14L9 12z",
  next: "M16 5h2v14h-2zM4 5v14l11-7z",
  play: "M7 4.5v15L20 12z",
  pause: "M6 5h4v14H6zM14 5h4v14h-4z",
};
function glyph(kind: keyof typeof GLYPHS): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", GLYPHS[kind]);
  svg.append(path);
  return svg;
}

/** Un appui sur une flèche du clavier avance ou recule de… */
const SEEK_STEP_MS = 5_000;

/**
 * Rend la barre de progression cliquable : un clic va à cet endroit du
 * morceau ; en glissant, la barre et le temps suivent le doigt, et la position
 * part au lecteur quand on lâche. Clavier : flèches gauche / droite.
 */
function seekable(api: ModuleApi, zone: HTMLElement, bar: HTMLElement, durationMs: number, show: () => void) {
  zone.classList.add("seekable");
  zone.tabIndex = 0;
  zone.setAttribute("role", "slider");
  zone.setAttribute("aria-label", "Position dans le morceau");
  const at = (e: PointerEvent) => {
    const r = bar.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * durationMs);
  };
  const go = (ms: number) => {
    // On montre tout de suite la nouvelle position, sans attendre le lecteur.
    if (playing) {
      playing.positionMs = ms;
      receivedAt = performance.now();
    }
    void control(api, "seek", { positionMs: ms });
  };
  zone.addEventListener("pointerdown", (e) => {
    zone.setPointerCapture(e.pointerId);
    zone.classList.add("scrubbing");
    scrub = at(e);
    show();
  });
  zone.addEventListener("pointermove", (e) => {
    if (scrub === null) return;
    scrub = at(e);
    show();
  });
  const release = (send: boolean) => {
    if (scrub === null) return;
    const target = scrub;
    scrub = null;
    zone.classList.remove("scrubbing");
    if (send) go(target);
    redrawAll(); // un message du lecteur a pu arriver pendant le glissé
  };
  zone.addEventListener("pointerup", () => release(true));
  zone.addEventListener("pointercancel", () => release(false));
  zone.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowRight" ? SEEK_STEP_MS : e.key === "ArrowLeft" ? -SEEK_STEP_MS : 0;
    const pos = currentPosition();
    if (!step || pos === null) return;
    e.preventDefault();
    go(Math.max(0, Math.min(durationMs, pos + step)));
    show();
  });
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
          const asked = state.artwork;
          let url: string | null = null;
          try {
            url = (await api.invoke<{ url: string | null }>("artwork")).url;
          } catch {
            url = null; // pas de pochette : la note de musique la remplace
          }
          // Deux changements de piste rapides : la réponse de l'ancienne
          // pochette peut arriver après la nouvelle. On ne garde que la bonne.
          if (asked !== artworkId) return;
          artworkUrl = url;
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

    compact(root, api) {
      // La pilule est construite une fois, puis mise à jour : le titre qui
      // défile ne recommence pas à chaque message du lecteur.
      const text = el("span", { class: "marquee-text" });
      const box = el("span", { class: "marquee" }, text);
      const mini = (icon: SVGSVGElement, title: string, command: "toggle" | "next" | "previous") =>
        el("button", { class: "media-mini", title, "aria-label": title, onclick: api.handler(() => control(api, command)) }, icon) as HTMLButtonElement;
      const prev = mini(glyph("previous"), "Précédent", "previous");
      const play = mini(glyph("play"), "Lecture", "toggle");
      const next = mini(glyph("next"), "Suivant", "next");
      const controls = el("span", { class: "media-minis" }, prev, play, next);
      const coverSlot = el("span", { class: "media-cover-slot" });
      const eqSlot = el("span", { class: "media-eq-slot" });
      root.append(el("div", { class: "media-compact" }, coverSlot, box, controls, eqSlot));

      // Le titre défile seulement s'il est trop long pour la pilule.
      const measure = () => {
        const overflow = text.scrollWidth - box.clientWidth;
        const scroll = overflow > 4;
        box.classList.toggle("scrolling", scroll);
        if (scroll) {
          box.style.setProperty("--shift", `-${overflow + 12}px`);
          // Environ 30 px par seconde, avec une pause à chaque bout.
          box.style.setProperty("--marquee-time", `${Math.max(6, (overflow + 12) / 30 + 3).toFixed(1)}s`);
        }
      };
      const sizes = new ResizeObserver(measure);
      sizes.observe(box);

      let shown = "";
      let shownArtwork: string | null | undefined;
      const draw = () => {
        if (!playing) return;
        const p = playing;
        const line = p.artist ? `${p.title} · ${p.artist}` : p.title;
        if (line !== shown) {
          shown = line;
          text.textContent = line;
          box.title = line;
          box.classList.remove("scrolling"); // l'animation repart du début
          requestAnimationFrame(measure);
        }
        if (artworkUrl !== shownArtwork) {
          shownArtwork = artworkUrl;
          coverSlot.replaceChildren(cover("small"));
        }
        const on = p.status === "playing";
        if (play.dataset.on !== String(on)) {
          play.dataset.on = String(on);
          play.replaceChildren(glyph(on ? "pause" : "play"));
        }
        play.title = on ? "Pause" : "Lecture";
        play.setAttribute("aria-label", play.title);
        play.disabled = !p.canToggle;
        prev.disabled = !p.canPrevious;
        next.disabled = !p.canNext;
        controls.hidden = !api.settings().compactControls;
        eqSlot.replaceChildren(equalizer());
      };
      draw();
      redraws.add(draw);
      return () => {
        redraws.delete(draw);
        sizes.disconnect();
      };
    },

    expanded(root, api) {
      const draw = () => {
        // Pendant un glissé sur la barre, on ne redessine pas (on perdrait la souris).
        if (scrub !== null) return;
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
        // La zone cliquable est plus haute que la barre (4 px, trop fine pour viser).
        const seek = el("div", { class: "media-seek" }, bar, el("span", { class: "media-thumb" }));
        if (p.canSeek && p.durationMs) seekable(api, seek, bar, p.durationMs, () => tick());

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
              p.durationMs ? el("div", { class: "media-progress" }, seek, times) : null,
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
        const percent = Math.min(100, (pos / duration) * 100);
        fill.style.width = `${percent}%`;
        root.querySelector<HTMLElement>(".media-seek")?.style.setProperty("--f", `${percent}%`);
        root.querySelector(".media-seek")?.setAttribute("aria-valuetext", clock(pos));
        setText(now, clock(pos));
        setText(total, clock(duration));
      };

      draw();
      redraws.add(draw);
      // Toutes les 500 ms (250 en haute, 1 s en économie d'énergie : src/core/perf.ts).
      const stopTick = pacedInterval(tick, "mediaProgress", true);
      return () => {
        redraws.delete(draw);
        stopTick();
      };
    },
  },
};
