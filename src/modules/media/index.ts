// Module « Musique » : ce qui joue en ce moment, avec lecture/pause, suivant,
// précédent, aléatoire, répétition et le volume DU LECTEUR (pas celui du PC).
// La barre de progression est cliquable (et glissable) quand le lecteur
// accepte qu'on change la position.
//
// La carte (1.2.4) suit la maquette « Musique » : pochette cliquable (ouvre le
// lecteur), pastille de couleur devant le titre, temps écoulé et restant,
// barre grise au repos qui prend la couleur sous la souris avec un petit
// bouton rond, icônes au trait, grand bouton lecture rond et plein. La couleur
// vient de la pochette (coverTint, src/mascot/env-tint.ts), avec une lueur
// douce dans la carte. Idée et mise en page inspirées de la carte Spotify de
// Coucou (MIT) ; dessins et code à nous.
//
// Le Rust (src-tauri/src/modules/media.rs) surveille le lecteur de Windows et
// publie "media.changed" quand quelque chose change. Entre deux messages, on
// fait avancer la barre de progression ici, à partir de la dernière position
// connue. Les calculs sans DOM sont dans logic.ts.
//
// Les paroles (1.2.5, réglage « Paroles (LRCLIB) », coupé par défaut) : un
// bouton « Paroles » coupe la carte en deux, le lecteur réduit à gauche
// (pochette, titre, barre, boutons), les paroles à droite. La ligne chantée
// est en blanc, les autres estompées, et la liste glisse avec un ressort.
// Un clic sur une ligne y va (si le lecteur accepte « seek »), sinon la met
// seulement en avant. Le Rust demande les paroles à LRCLIB (commande
// `lyrics`, seulement quand la vue est ouverte) ; le format LRC est lu dans
// lyrics-logic.ts. La position vient de la même estimation que la barre.

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";
import { pacedInterval, perfMode, setText } from "../../core/perf";
import { reducedMotion } from "../../island/tab-pill";
import { coverTint, onCoverColors, setCover } from "../../mascot/env-tint";
import { appName, buttons, cardTint, clock, eqHeights, EQ_MIN, nextRepeat, remaining, throttle, volumeLevel, type Levels, type NowPlaying, type PlayerVolume, type RepeatMode } from "./logic";
import { currentLine, lyricsKey, lyricsView, msUntilNextLine, scrollFor, type LyricsReply, type LyricsView } from "./lyrics-logic";

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
/** Le volume du lecteur (null tant qu'on ne l'a pas lu). */
let volume: PlayerVolume | null = null;
/** La couleur de la pochette, gardée pour ce morceau (coverTint s'efface en pause). */
let tintFor: { artwork: number; rgb: readonly [number, number, number] } | null = null;
const redraws = new Set<() => void>();
/** Pendant qu'on glisse sur la barre : la position visée (ms), sinon null. */
let scrub: number | null = null;
/** La vue Paroles est-elle ouverte ? (gardé quand l'île se referme) */
let lyricsOpen = false;
/** Les paroles du morceau en cours : pour quel morceau (lyricsKey), et où on en est. */
let lyrics: { key: string; status: "loading" | "ready" | "error"; view: LyricsView; error?: string } | null = null;

function redrawAll() {
  for (const r of redraws) r();
}

/** Le réglage « Paroles (LRCLIB) » est-il coché ? */
function lyricsAllowed(api: ModuleApi): boolean {
  return api.settings().lyrics === true;
}

/**
 * Demande les paroles du morceau en cours, si la vue Paroles est ouverte et
 * qu'on ne les a pas déjà (une erreur se retente à la réouverture de la vue).
 */
async function loadLyrics(api: ModuleApi, retry = false) {
  if (!lyricsOpen || !lyricsAllowed(api) || !hasTrack() || !playing) return;
  const key = lyricsKey(playing);
  if (lyrics?.key === key && !(retry && lyrics.status === "error")) return;
  lyrics = { key, status: "loading", view: { kind: "none" } };
  redrawAll();
  let reply: LyricsReply | null;
  try {
    reply = await api.invoke<LyricsReply | null>("lyrics");
  } catch (err) {
    if (lyrics?.key === key) lyrics = { key, status: "error", view: { kind: "none" }, error: errorText(err) };
    redrawAll();
    return;
  }
  if (lyrics?.key !== key) return; // un autre morceau entre-temps : sa demande est partie
  if (!reply || !playing || reply.title !== playing.title || reply.artist !== playing.artist) {
    // Le Rust a déjà vu le morceau suivant : le message "media.changed" arrive et redemande.
    lyrics = null;
    return;
  }
  lyrics = { key, status: "ready", view: lyricsView(reply.lyrics) };
  redrawAll();
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

/** La couleur de la carte : celle de la pochette (gardée pendant la pause), sinon null (accent du thème). */
function tint() {
  const now = coverTint();
  if (now) tintFor = { artwork: artworkId, rgb: now };
  return cardTint(tintFor && tintFor.artwork === artworkId ? tintFor.rgb : null);
}

/** Pose la couleur de la pochette sur un élément (variables --media-tint et --media-tint-soft). */
function paintTint(node: HTMLElement) {
  const t = tint();
  if (t) {
    node.style.setProperty("--media-tint", t.tint);
    node.style.setProperty("--media-tint-soft", t.soft);
    // Style Encoche : la lueur de l'île prend la couleur de la pochette (island-notch.css).
    document.body.style.setProperty("--notch-tint", t.tint);
  } else {
    node.style.removeProperty("--media-tint");
    node.style.removeProperty("--media-tint-soft");
    document.body.style.removeProperty("--notch-tint");
  }
}

// ── Icônes au trait (SVG, nettes à toute taille, de la couleur du texte) ─────

const SVG_NS = "http://www.w3.org/2000/svg";
/** [tracé, rempli ?] : les icônes au trait ont un contour, les autres sont pleines. */
const ICONS = {
  previous: [["M6 5v14", false], ["M19 5.5v13L9 12z", true]],
  next: [["M18 5v14", false], ["M5 5.5v13L15 12z", true]],
  play: [["M8 5.2v13.6a.6.6 0 0 0 .9.5l10.6-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5z", true]],
  pause: [["M7 5h3.5v14H7zM13.5 5H17v14h-3.5z", true]],
  shuffle: [["M3 7h3c4 0 6 10 10 10h5M18 14l3 3-3 3M3 17h3c1.6 0 2.8-1.4 3.8-3M13 9.5C14 8 15 7 16 7h5M18 4l3 3-3 3", false]],
  repeat: [["M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4", false]],
  // Répéter ce morceau : la même boucle avec un petit « 1 » au milieu.
  repeatOne: [["M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4M11 10.5l1.5-1v5", false]],
  vol0: [["M4 9.5h3.2L12 5.5v13l-4.8-4H4zM15.5 9.5l5 5M20.5 9.5l-5 5", false]],
  vol1: [["M4 9.5h3.2L12 5.5v13l-4.8-4H4zM15 9.8a3.2 3.2 0 0 1 0 4.4", false]],
  vol2: [["M4 9.5h3.2L12 5.5v13l-4.8-4H4zM15 9.8a3.2 3.2 0 0 1 0 4.4M17.4 7.6a6.4 6.4 0 0 1 0 8.8", false]],
  vol3: [["M4 9.5h3.2L12 5.5v13l-4.8-4H4zM15 9.8a3.2 3.2 0 0 1 0 4.4M17.4 7.6a6.4 6.4 0 0 1 0 8.8M19.8 5.4a9.6 9.6 0 0 1 0 13.2", false]],
  note: [["M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0M19 16a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0", false]],
} satisfies Record<string, [string, boolean][]>;
type IconName = keyof typeof ICONS;

function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("media-ico");
  for (const [d, filled] of ICONS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("class", filled ? "fill" : "line");
    svg.append(path);
  }
  return svg;
}

/** Change l'icône d'un bouton seulement si elle a changé (pas de clignotement). */
function setIcon(button: HTMLElement, name: IconName) {
  if (button.dataset.icon === name) return;
  button.dataset.icon = name;
  button.replaceChildren(icon(name));
}

/** Change la bulle et le nom lu d'un bouton. */
function setLabel(node: HTMLElement, label: string) {
  if (node.title !== label) node.title = label;
  if (node.getAttribute("aria-label") !== label) node.setAttribute("aria-label", label);
}

/** La pochette, ou une note de musique au trait à la place. */
function cover(size: "small" | "large"): HTMLElement {
  if (artworkUrl) return el("img", { class: `media-cover ${size}`, src: artworkUrl, alt: "", draggable: "false" });
  return el("div", { class: `media-cover ${size} empty` }, icon("note"));
}

type Command = "toggle" | "next" | "previous" | "seek" | "shuffle" | "repeat" | "open";

/** Lance une commande du lecteur ; une erreur (lecteur fermé…) s'affiche sans compter comme plantage. */
async function control(api: ModuleApi, command: Command, args?: Record<string, unknown>) {
  try {
    await api.invoke(command, args);
  } catch (err) {
    api.notify({ title: "Le lecteur ne répond pas", body: errorText(err), icon: "🎵", priority: "low", key: "media-error" });
  }
}

/** Relit le volume du lecteur (au montage de la carte, et quand le lecteur change). */
async function readVolume(api: ModuleApi) {
  try {
    volume = await api.invoke<PlayerVolume>("volume");
  } catch {
    volume = null; // hors de l'appli, ou lecteur sans son : le curseur est grisé
  }
  redrawAll();
}

// ── Barre glissable (position dans le morceau, volume) ──────────────────────

interface Slider {
  el: HTMLElement;
  /** Peut-on la toucher ? (sinon grise, sans bouton rond) */
  enabled: boolean;
  /** Place le remplissage (0…1) et le texte lu par les lecteurs d'écran. */
  set(fraction: number, valueText: string): void;
}

/**
 * Une barre grise au repos ; sous la souris (ou pendant un glissé), elle
 * prend la couleur de la pochette et montre un petit bouton rond. Un clic va
 * à cet endroit ; en glissant, `input` suit le doigt et `commit` part quand on
 * lâche. Clavier : flèches gauche / droite (`step`).
 */
function slider(
  cls: string,
  label: string,
  on: { input: (f: number) => void; commit: (f: number) => void; cancel?: () => void; step: (dir: 1 | -1) => void },
): Slider {
  const fill = el("i", { class: "media-fill" });
  const knob = el("i", { class: "media-knob" });
  const zone = el("div", { class: `media-slider ${cls}`, role: "slider", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": "100" }, el("i", { class: "media-track" }), fill, knob);
  let dragging = false;
  const at = (e: PointerEvent) => {
    const r = zone.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
  };
  const self: Slider = {
    el: zone,
    enabled: true,
    set(f, text) {
      zone.style.setProperty("--f", `${(Math.max(0, Math.min(1, f)) * 100).toFixed(2)}%`);
      zone.setAttribute("aria-valuenow", String(Math.round(f * 100)));
      zone.setAttribute("aria-valuetext", text);
    },
  };
  zone.addEventListener("pointerdown", (e) => {
    if (!self.enabled || e.button !== 0) return;
    e.stopPropagation(); // un glissé dans la carte ne déplace pas l'île
    dragging = true;
    try {
      zone.setPointerCapture(e.pointerId);
    } catch {
      // la capture est un plus
    }
    zone.classList.add("scrubbing");
    on.input(at(e));
  });
  zone.addEventListener("pointermove", (e) => {
    if (dragging) on.input(at(e));
  });
  const release = (e: PointerEvent, send: boolean) => {
    if (!dragging) return;
    dragging = false;
    zone.classList.remove("scrubbing");
    if (send) on.commit(at(e));
    else on.cancel?.();
  };
  zone.addEventListener("pointerup", (e) => release(e, true));
  zone.addEventListener("pointercancel", (e) => release(e, false));
  zone.addEventListener("click", (e) => e.stopPropagation());
  zone.addEventListener("keydown", (e) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!dir || !self.enabled) return;
    e.preventDefault();
    on.step(dir);
  });
  return self;
}

/** Un appui sur une flèche du clavier avance ou recule de… */
const SEEK_STEP_MS = 5_000;
const VOLUME_STEP = 5;

/** Trois petites barres qui dansent quand la musique joue. */
function equalizer(): HTMLElement {
  return el("span", { class: "media-eq", "aria-hidden": "true" }, el("i"), el("i"), el("i"));
}

/**
 * L'égaliseur qui suit le vrai son (1.2.5, réglage liveEqualizer) : tant que
 * ça joue, on lit le niveau de la sortie (commande `levels` : des nombres,
 * jamais le son) et les trois barres (gauche, ensemble, droite) le suivent.
 * Sans réponse (hors de l'appli) ou en éco, les barres gardent leur danse CSS.
 * Renvoie `sync(on)` (à appeler à chaque dessin) et de quoi tout arrêter.
 */
function liveEqualizer(api: ModuleApi, eq: HTMLElement) {
  const bars = [...eq.querySelectorAll("i")] as HTMLElement[];
  let heights = [EQ_MIN, EQ_MIN, EQ_MIN];
  let stop: (() => void) | null = null;
  let busy = false;
  let failed = false;
  const off = () => {
    stop?.();
    stop = null;
    eq.classList.remove("live");
    bars.forEach((b) => b.style.removeProperty("height"));
  };
  const read = () => {
    if (busy) return;
    busy = true;
    api
      .invoke<Levels | null>("levels")
      .then((l) => {
        if (!l || !stop) return;
        heights = eqHeights(heights, l);
        eq.classList.add("live");
        bars.forEach((b, i) => (b.style.height = `${heights[i]}px`));
      })
      .catch(() => {
        // hors de l'appli : on garde la danse CSS, et on ne redemande plus
        failed = true;
        off();
      })
      .finally(() => (busy = false));
  };
  return {
    sync(on: boolean) {
      const want = on && !failed && api.settings().liveEqualizer !== false && !reducedMotion() && perfMode() !== "eco";
      if (want && !stop) stop = pacedInterval(read, "mediaEq", true);
      else if (!want && stop) off();
    },
    stop: off,
  };
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

      // Un autre lecteur, ou il vient de se mettre à jouer : son volume a pu changer.
      if (playing && (!before || before.app !== playing.app || before.status !== playing.status)) void readVolume(api);
      if (!playing) volume = null;

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
      // Les reflets de la mascotte gomme prennent un peu la couleur de la pochette (en lecture seulement).
      setCover(playing?.status === "playing" ? artworkUrl : null);

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
      void loadLyrics(api);
    };

    api.on("media.changed", (msg) => void apply(msg.payload as MediaState));
    // Au démarrage (ou après réactivation), on demande l'état actuel.
    api
      .invoke<MediaState>("state")
      .then(apply)
      .catch(() => {}); // hors de l'appli (navigateur) : rien en lecture

    // La couleur de la pochette arrive un instant après l'image (env-tint.ts) : on repeint.
    const offTint = onCoverColors(() => redrawAll());

    // Changer le réglage « pilule » doit changer la vue compacte tout de suite ;
    // décocher « Paroles » referme la vue Paroles.
    api.onSettingsChange(() => {
      api.refreshCompact();
      if (!lyricsAllowed(api)) {
        lyricsOpen = false;
        lyrics = null;
      }
      redrawAll();
    });

    // L'Accueil : une carte large, teintée aux couleurs de la pochette, tant qu'un morceau est là.
    api.homeCard({
      title: "Musique",
      icon: "🎵",
      size: "large",
      moments: { morning: 40, day: 55, evening: 70 },
      view: () => {
        if (!hasTrack() || !playing) return null;
        const pos = currentPosition();
        const on = playing.status === "playing";
        return {
          value: playing.title,
          sub: playing.artist || appName(playing.app),
          image: artworkUrl,
          tint: on ? coverTint() : null,
          progress: pos !== null && playing.durationMs ? pos / playing.durationMs : null,
          actions: [
            ...(playing.canPrevious ? [{ icon: "⏮", label: "Précédent", run: () => control(api, "previous") }] : []),
            ...(playing.canToggle ? [{ icon: on ? "⏸" : "▶", label: on ? "Pause" : "Lecture", run: () => control(api, "toggle") }] : []),
            ...(playing.canNext ? [{ icon: "⏭", label: "Suivant", run: () => control(api, "next") }] : []),
          ],
        };
      },
    });

    return () => {
      offTint();
      playing = null;
      artworkId = 0;
      artworkUrl = null;
      volume = null;
      tintFor = null;
      lyricsOpen = false;
      lyrics = null;
      setCover(null);
    };
  },

  views: {
    compactWhen: (api) => hasTrack() && Boolean(api.settings().showCompact),

    // La mini-île : au repos, pochette + titre + égaliseur ; sous la souris
    // (ou au clavier), la pochette et l'égaliseur s'effacent, la goutte danse
    // à côté, et lecture / suivant apparaissent (réglage compactControls).
    compact(root, api) {
      // La pilule est construite une fois, puis mise à jour : le titre qui
      // défile ne recommence pas à chaque message du lecteur.
      const text = el("span", { class: "marquee-text" });
      const box = el("span", { class: "marquee" }, text);
      const mini = (title: string, command: "toggle" | "next") =>
        el("button", { class: "media-mini", title, "aria-label": title, onclick: api.handler(() => control(api, command)) }) as HTMLButtonElement;
      const play = mini("Lecture", "toggle");
      const next = mini("Suivant", "next");
      setIcon(next, "next");
      const controls = el("span", { class: "media-minis" }, play, next);
      const coverSlot = el("span", { class: "media-cover-slot" });
      const eqBars = equalizer();
      const eqSlot = el("span", { class: "media-eq-slot" }, eqBars);
      const live = liveEqualizer(api, eqBars);
      const compact = el("div", { class: "media-compact" }, coverSlot, box, eqSlot, controls);
      root.append(compact);

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
        const b = buttons(p, volume);
        setIcon(play, b.toggle.on ? "pause" : "play");
        setLabel(play, b.toggle.label);
        play.disabled = !b.toggle.enabled;
        next.disabled = !b.next.enabled;
        controls.hidden = !api.settings().compactControls;
        compact.classList.toggle("with-controls", !controls.hidden);
        paintTint(compact);
        const on = b.toggle.on;
        // L'égaliseur bat tant que ça joue ; la bulle du titre ondule (island.css ; rien
        // avec « Réduire les animations » ni en éco).
        compact.classList.toggle("on", on);
        compact.classList.toggle("playing", on && !reducedMotion() && perfMode() !== "eco");
        live.sync(on);
      };
      draw();
      redraws.add(draw);
      return () => {
        live.stop();
        redraws.delete(draw);
        sizes.disconnect();
      };
    },

    expanded(root, api) {
      const empty = el("p", { class: "muted" }, "Rien en lecture. Lancez de la musique dans Spotify, votre navigateur ou un autre lecteur : elle apparaîtra ici.");

      // ── En-tête : pochette (ouvre le lecteur), titre, artiste · album, appli ──
      const coverBtn = el("button", { class: "media-cover-btn", title: "Ouvrir le lecteur", "aria-label": "Ouvrir le lecteur", onclick: api.handler(() => control(api, "open")) });
      const title = el("span", { class: "media-title" });
      const sub = el("div", { class: "media-artist" });
      const appLine = el("div", { class: "media-app" });
      const head = el(
        "div",
        { class: "media-head" },
        coverBtn,
        el("div", { class: "media-info" }, el("div", { class: "media-title-row" }, el("span", { class: "media-dot", "aria-hidden": "true" }), title), sub, appLine),
      );

      // ── Progression : écoulé, barre, restant ──
      const elapsed = el("span", { class: "media-time" });
      const left = el("span", { class: "media-time left" });
      const seek = slider("media-seek", "Position dans le morceau", {
        input: (f) => {
          scrub = Math.round(f * (playing?.durationMs ?? 0));
          tick();
        },
        commit: (f) => {
          scrub = null;
          go(Math.round(f * (playing?.durationMs ?? 0)));
        },
        cancel: () => {
          scrub = null;
          sync();
        },
        step: (dir) => {
          const pos = currentPosition();
          const d = playing?.durationMs;
          if (pos === null || !d) return;
          go(Math.max(0, Math.min(d, pos + dir * SEEK_STEP_MS)));
        },
      });
      const go = (ms: number) => {
        // On montre tout de suite la nouvelle position, sans attendre le lecteur.
        if (playing) {
          playing.positionMs = ms;
          receivedAt = performance.now();
        }
        tick();
        void control(api, "seek", { positionMs: ms });
      };
      const progress = el("div", { class: "media-progress" }, elapsed, seek.el, left);

      // ── Boutons : aléatoire, précédent, lecture, suivant, répétition ──
      const btn = (cls: string, run: () => void, target?: string) =>
        el("button", { class: cls, "data-scene-target": target, onclick: api.handler(run) }) as HTMLButtonElement;
      const shuffleB = btn("media-btn toggle", () => {
        if (!playing) return;
        const on = !playing.shuffle;
        playing.shuffle = on; // tout de suite à l'écran, le lecteur confirme ensuite
        sync();
        void control(api, "shuffle", { on });
      });
      const prevB = btn("media-btn", () => control(api, "previous"));
      const playB = btn("media-play", () => control(api, "toggle"));
      const nextB = btn("media-btn", () => control(api, "next"), "media-next");
      const repeatB = btn("media-btn toggle", () => {
        if (!playing) return;
        const mode: RepeatMode = nextRepeat(playing.repeat);
        playing.repeat = mode;
        sync();
        void control(api, "repeat", { mode });
      });
      setIcon(shuffleB, "shuffle");
      setIcon(prevB, "previous");
      setIcon(nextB, "next");

      // ── Volume du lecteur : icône (couper / remettre), barre, nombre ──
      let volDrag: number | null = null;
      const sendVolume = throttle((v: number) => void setVolume({ value: v }), 120);
      const setVolume = async (args: { value?: number; muted?: boolean }) => {
        try {
          const got = await api.invoke<PlayerVolume>("volume", args);
          // Pendant un glissé, la réponse d'un envoi précédent ne fait pas reculer la barre.
          if (volDrag === null) volume = got;
        } catch (err) {
          api.notify({ title: "Le lecteur ne répond pas", body: errorText(err), icon: "🎵", priority: "low", key: "media-error" });
          void readVolume(api);
          return;
        }
        sync();
      };
      const volIcon = btn("media-btn media-vol-icon", () => {
        if (!volume || volume.volume === null) return;
        const muted = !(volume.muted || volume.volume === 0);
        // Remettre le son d'un lecteur à 0 : un niveau raisonnable.
        const args = muted ? { muted: true } : volume.volume === 0 ? { muted: false, value: 30 } : { muted: false };
        volume = { volume: args.value ?? volume.volume, muted };
        sync();
        void setVolume(args);
      });
      const volNum = el("span", { class: "media-vol-num" });
      const vol = slider("media-volume-bar", "Volume du lecteur", {
        input: (f) => {
          volDrag = Math.round(f * 100);
          sync();
          sendVolume.push(volDrag);
        },
        commit: (f) => {
          const v = Math.round(f * 100);
          volDrag = null;
          volume = { volume: v, muted: false };
          sync();
          sendVolume.push(v);
          sendVolume.flush();
        },
        cancel: () => {
          volDrag = null;
          sync();
        },
        step: (dir) => {
          if (!volume || volume.volume === null) return;
          const v = Math.max(0, Math.min(100, volume.volume + dir * VOLUME_STEP));
          volume = { volume: v, muted: false };
          sync();
          sendVolume.push(v);
        },
      });
      const volBox = el("div", { class: "media-volume" }, volIcon, vol.el, volNum);

      // ── Paroles : le bouton, et le volet de droite ──
      const lyricsB = btn("media-lyrics-btn", () => {
        lyricsOpen = !lyricsOpen;
        sync();
        void loadLyrics(api, true);
      });
      lyricsB.textContent = "Paroles";
      const lyricsList = el("ol", { class: "media-lyrics-list", "data-no-i18n": true });
      const lyricsNote = el("p", { class: "media-lyrics-note" });
      const lyricsPane = el("div", { class: "media-lyrics", "aria-label": "Paroles" }, lyricsNote, lyricsList);
      /** Les lignes affichées (pour ne pas les refaire à chaque message du lecteur). */
      let shownView: LyricsView | null = null;
      let shownLine = -2;
      /** Une ligne cliquée sans pouvoir y aller : mise en avant tant que la ligne chantée ne change pas. */
      let pinned: { line: number; while: number } | null = null;
      let nextLineTimer = 0;

      const controls = el("div", { class: "media-controls" }, shuffleB, prevB, playB, nextB, repeatB, el("span", { class: "media-grow" }), lyricsB, volBox);
      const main = el("div", { class: "media-main" }, head, progress, controls);

      const card = el("div", { class: "media-card" }, el("span", { class: "media-glow", "aria-hidden": "true" }), main, lyricsPane);

      /** Le volet des paroles : le message, ou la liste (refaite seulement quand les paroles changent). */
      const drawLyrics = () => {
        const state = lyrics;
        const view = state?.status === "ready" ? state.view : null;
        const note =
          !state || state.status === "loading"
            ? "Recherche des paroles…"
            : state.status === "error"
              ? "Paroles indisponibles pour l'instant (pas de connexion ?)"
              : view?.kind === "instrumental"
                ? "Morceau instrumental : pas de paroles"
                : view?.kind === "none"
                  ? "Pas de paroles pour ce morceau"
                  : view?.kind === "plain"
                    ? "Paroles non synchronisées"
                    : "";
        setText(lyricsNote, note);
        lyricsNote.hidden = !note;
        if (state?.status === "error" && state.error) lyricsNote.title = state.error;
        else lyricsNote.removeAttribute("title");
        lyricsPane.classList.toggle("plain", view?.kind === "plain");
        if (view === shownView) return;
        shownView = view;
        shownLine = -2;
        pinned = null;
        lyricsList.style.transform = "";
        if (view?.kind === "synced") {
          lyricsList.replaceChildren(
            ...view.lines.map((l, i) =>
              el("li", {}, el("button", { class: "media-lyric", type: "button", "data-no-i18n": true, onclick: api.handler(() => pickLine(i)) }, l.text || "♪")),
            ),
          );
        } else if (view?.kind === "plain") {
          lyricsList.replaceChildren(...view.lines.map((l) => el("li", { class: "media-lyric-plain", "data-no-i18n": true }, l || " ")));
        } else lyricsList.replaceChildren();
      };

      /** Un clic sur une ligne : le lecteur y va s'il le peut, sinon la ligne est mise en avant. */
      const pickLine = (i: number) => {
        const view = shownView;
        if (view?.kind !== "synced") return;
        if (seek.enabled) {
          pinned = null;
          go(view.lines[i].timeMs);
          return;
        }
        const pos = currentPosition();
        pinned = { line: i, while: pos === null ? -1 : currentLine(view.lines, pos) };
        markLine();
      };

      /** Allume la ligne chantée et fait glisser la liste ; prévoit le prochain changement. */
      const markLine = () => {
        window.clearTimeout(nextLineTimer);
        const view = shownView;
        if (view?.kind !== "synced" || !lyricsPane.isConnected || lyricsPane.hidden) return;
        const pos = currentPosition();
        const sung = pos === null ? -1 : currentLine(view.lines, pos);
        if (pinned && pinned.while !== sung) pinned = null;
        const line = pinned ? pinned.line : sung;
        if (line !== shownLine) {
          const items = lyricsList.children;
          lyricsList.querySelector(".on")?.classList.remove("on");
          const li = items[line] as HTMLElement | undefined;
          li?.classList.add("on");
          shownLine = line;
          const top = li ? li.offsetTop : 0;
          const h = li ? li.offsetHeight : 0;
          lyricsList.style.transform = `translateY(${scrollFor(lyricsPane.clientHeight, top, h)}px)`;
        }
        // La ligne suivante tombe pile, sans attendre le prochain tour de la barre.
        if (pos !== null && playing?.status === "playing" && scrub === null) {
          const wait = msUntilNextLine(view.lines, pos);
          if (wait !== null) nextLineTimer = window.setTimeout(markLine, wait + 20);
        }
      };

      // La barre avance toute seule entre deux messages du Rust.
      const tick = () => {
        markLine();
        const pos = currentPosition();
        const duration = playing?.durationMs;
        if (pos === null || !duration) return;
        seek.set(pos / duration, clock(pos));
        setText(elapsed, clock(pos));
        setText(left, remaining(pos, duration));
      };

      let shownArtwork: string | null | undefined;
      let shownTrack = "";
      const sync = () => {
        if (!hasTrack() || !playing) {
          if (card.isConnected || !empty.isConnected) root.replaceChildren(empty);
          shownArtwork = undefined;
          return;
        }
        if (!card.isConnected) root.replaceChildren(card);
        const p = playing;
        const key = `${p.title}\n${p.artist}\n${p.album}\n${p.app}`;
        if (key !== shownTrack) {
          shownTrack = key;
          title.textContent = p.title;
          title.title = p.title;
          sub.textContent = [p.artist, p.album].filter(Boolean).join(" · ");
          sub.hidden = !sub.textContent;
          appLine.textContent = appName(p.app);
        }
        if (artworkUrl !== shownArtwork) {
          shownArtwork = artworkUrl;
          coverBtn.replaceChildren(cover("large"));
        }
        paintTint(card);
        card.classList.toggle("on", p.status === "playing");

        // Paroles : le bouton (réglage coché), la carte coupée en deux quand la vue est ouverte.
        const allowed = lyricsAllowed(api);
        const split = allowed && lyricsOpen;
        lyricsB.hidden = !allowed;
        lyricsB.classList.toggle("on", split);
        lyricsB.setAttribute("aria-pressed", String(split));
        setLabel(lyricsB, split ? "Fermer les paroles" : "Afficher les paroles");
        card.classList.toggle("with-lyrics", split);
        lyricsPane.hidden = !split;
        if (split) drawLyrics();

        const b = buttons(p, volume);
        const apply = (node: HTMLButtonElement, s: { enabled: boolean; on: boolean; label: string }) => {
          node.disabled = !s.enabled;
          node.classList.toggle("on", s.on);
          setLabel(node, s.label);
        };
        apply(shuffleB, b.shuffle);
        apply(repeatB, b.repeat);
        setIcon(repeatB, p.repeat === "track" && b.repeat.enabled ? "repeatOne" : "repeat");
        apply(prevB, b.previous);
        apply(nextB, b.next);
        apply(playB, { ...b.toggle, on: false });
        setIcon(playB, b.toggle.on ? "pause" : "play");

        // Progression : cachée si le lecteur ne donne pas la durée.
        progress.hidden = !p.durationMs;
        seek.enabled = p.canSeek && !!p.durationMs;
        seek.el.classList.toggle("disabled", !seek.enabled);
        seek.el.tabIndex = seek.enabled ? 0 : -1;
        if (seek.enabled) seek.el.removeAttribute("aria-disabled");
        else seek.el.setAttribute("aria-disabled", "true");

        // Volume du lecteur.
        const level = volDrag ?? (volume?.volume ?? 0);
        const muted = volDrag === null && !!volume?.muted;
        vol.enabled = b.volume.enabled;
        vol.el.classList.toggle("disabled", !vol.enabled);
        vol.el.tabIndex = vol.enabled ? 0 : -1;
        vol.set(muted ? 0 : level / 100, `${muted ? 0 : level} %`);
        volIcon.disabled = !b.volume.enabled;
        setIcon(volIcon, `vol${volumeLevel(b.volume.enabled ? level : null, muted)}` as IconName);
        setLabel(volIcon, !b.volume.enabled ? b.volume.label : muted || level === 0 ? "Remettre le son du lecteur" : "Couper le son du lecteur");
        volBox.title = b.volume.label;
        volBox.classList.toggle("disabled", !b.volume.enabled);
        setText(volNum, b.volume.enabled ? String(muted ? 0 : level) : "–");
        tick();
      };

      // Le volet change de taille (l'île s'ouvre, la carte se coupe en deux) : on recentre la ligne.
      const paneSize = new ResizeObserver(() => {
        shownLine = -2;
        markLine();
      });
      paneSize.observe(lyricsPane);

      sync();
      redraws.add(sync);
      void readVolume(api);
      // Toutes les 500 ms (250 en haute, 1 s en économie d'énergie : src/core/perf.ts).
      const stopTick = pacedInterval(tick, "mediaProgress", true);
      return () => {
        redraws.delete(sync);
        stopTick();
        window.clearTimeout(nextLineTimer);
        paneSize.disconnect();
        sendVolume.flush();
        scrub = null;
      };
    },
  },
};
