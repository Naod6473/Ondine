// « Se voir » avant une réunion (module Agenda) : l'aperçu de la caméra et la
// jauge du micro, dans l'alerte de l'île (contenu `content` d'une
// notification, voir src/core/notifications.ts).
//
//   - La caméra et le micro s'ouvrent quand l'aperçu s'affiche, et se
//     ferment dès qu'il disparaît (l'île appelle la fonction rendue) ou qu'on
//     rejoint la réunion (`closeSelfView`) : Teams, Meet ou Zoom retrouvent la
//     caméra libre. Un point vert (caméra) et un point orange (micro) restent
//     visibles sur l'image tant qu'ils sont ouverts.
//   - Rien n'est enregistré ni envoyé : l'image ne quitte pas la page, le son
//     passe seulement par un AnalyserNode (Web Audio) pour la jauge.
//   - La jauge et l'indication « image sombre » tournent dans une seule boucle
//     requestAnimationFrame (frameLoop : arrêtée quand l'île est cachée, 30 i/s
//     en Économie) ; la luminance n'est mesurée qu'une fois par seconde, sur
//     une image de 32 × 18.
//   - Caméra et micro se choisissent dans deux menus en verre (glass-select) ;
//     le choix (le NOM de l'appareil) est retenu dans les réglages du module.
//   - Micro coupé (raccourci du module Contrôles) : on le dit, avec
//     « Rallumer le micro » (événement controls.mic-set).
//
// La logique sans page est dans selfview-logic.ts.

import { AsyncResource } from "../../core/async-resource";
import type { ModuleApi } from "../../core/module-types";
import { frameLoop } from "../../core/perf";
import { settingsStore } from "../../core/settings-store";
import { el } from "../../island/dom";
import { motionOn } from "../../island/motion";
import { glassSelect } from "../../settings/glass-select";
import "../../styles/selfview.css";
import { deviceOptions, meanLuma, meterLevel, openError, pickDevice, smoothLevel, tooDark, type Device } from "./selfview-logic";
import { EASE_OUT } from "../../core/easing";

const stopTracks = (s: MediaStream) => s.getTracks().forEach((t) => t.stop());

/** L'aperçu affiché (un seul à la fois) : de quoi le fermer. */
let active: (() => void) | null = null;

/** Ferme l'aperçu affiché, s'il y en a un (« Rejoindre » : la caméra doit être libre). */
export function closeSelfView() {
  active?.();
}

/** Retient la caméra ou le micro choisi (son nom) dans les réglages du module Agenda. */
function remember(key: "mirrorCamera" | "mirrorMic", label: string) {
  void settingsStore.update((d) => {
    const entry = (d.modules.agenda ??= { enabled: true, values: {} });
    entry.values[key] = label;
  });
}

/** Un menu en verre (caméra ou micro). */
function deviceMenu(label: string, onPick: (value: string) => void): { box: HTMLElement; fill: (options: [string, string][], value: string) => void } {
  const select = el("select", { class: "select", "aria-label": label }) as HTMLSelectElement;
  select.addEventListener("change", () => onPick(select.value));
  const box = glassSelect(select, { menuClass: "selfview-menu" });
  return {
    box,
    fill(options, value) {
      select.replaceChildren(...options.map(([v, l]) => el("option", { value: v }, l)));
      select.value = value;
    },
  };
}

/**
 * Monte l'aperçu dans `host`. Renvoie la fonction qui ferme tout (caméra,
 * micro, boucle, écoutes) ; elle peut être appelée plusieurs fois.
 */
export function mountSelfView(host: HTMLElement, api: ModuleApi): () => void {
  closeSelfView(); // un seul aperçu : l'ancien rend la caméra
  const values = () => api.settings();
  const cam = new AsyncResource<MediaStream>(stopTracks);
  const mic = new AsyncResource<MediaStream>(stopTracks);
  let audio: { ctx: AudioContext; analyser: AnalyserNode; buf: Float32Array<ArrayBuffer> } | null = null;
  let devices: Device[] = [];
  let closed = false;
  let winked = false;

  // ── Les morceaux ───────────────────────────────────────────────────────────
  const video = el("video", { class: "selfview-video", muted: true, playsinline: true, autoplay: true, "aria-label": "Aperçu de votre caméra" }) as HTMLVideoElement;
  video.muted = true;
  const note = el("div", { class: "selfview-note", "aria-live": "polite" }, "Ouverture de la caméra…");
  const camDot = el("span", { class: "selfview-dot cam", title: "Caméra allumée", hidden: true });
  const micDot = el("span", { class: "selfview-dot mic", title: "Micro ouvert", hidden: true });
  const dark = el("span", { class: "selfview-dark", hidden: true }, "Image sombre : ajoutez de la lumière");
  const stage = el("div", { class: "selfview-stage" }, video, note, el("span", { class: "selfview-dots" }, camDot, micDot), dark);

  const fill = el("span", { class: "selfview-meter-fill" });
  const meter = el("div", { class: "selfview-meter", role: "meter", "aria-label": "Niveau du micro", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" }, fill);
  const micNote = el("small", { class: "muted selfview-mic-note", "aria-live": "polite" });
  const unmute = el("button", { class: "btn small", onclick: api.handler(() => api.emit("controls.mic-set", { muted: false })) }, "Rallumer le micro");
  const muted = el("div", { class: "selfview-muted", hidden: true, role: "status" }, el("span", {}, "🔇 Votre micro est coupé"), unmute);

  const camMenu = deviceMenu("Caméra", (label) => {
    remember("mirrorCamera", label);
    void openCamera(label);
  });
  const micMenu = deviceMenu("Micro", (label) => {
    remember("mirrorMic", label);
    void openMic(label);
  });

  const side = el(
    "div",
    { class: "selfview-side" },
    el("div", { class: "selfview-label" }, el("span", {}, "🎙️ Micro"), meter),
    micNote,
    muted,
    el("div", { class: "selfview-menus" }, camMenu.box, micMenu.box),
  );
  const root = el("div", { class: "selfview" }, stage, side);
  host.append(root);

  // Arrivée en gelée : l'image s'écrase un peu puis se pose (rien si Windows réduit les animations).
  if (motionOn()) {
    stage.animate(
      [
        { transform: "scale(0.6, 0.5)", opacity: 0 },
        { transform: "scale(1.06, 0.95)", opacity: 1, offset: 0.45 },
        { transform: "scale(0.98, 1.02)", offset: 0.72 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 620, easing: EASE_OUT, fill: "backwards" },
    );
  }

  const drawDots = () => {
    camDot.hidden = !cam.value;
    micDot.hidden = !mic.value;
  };

  /** La liste des appareils (les noms n'arrivent qu'une fois l'autorisation donnée). */
  const listDevices = async () => {
    try {
      devices = (await navigator.mediaDevices.enumerateDevices()).map((d) => ({ deviceId: d.deviceId, label: d.label, kind: d.kind }));
    } catch {
      devices = [];
    }
    if (closed) return;
    const v = values();
    camMenu.fill(deviceOptions(devices, "videoinput", String(v.mirrorCamera ?? "")), String(v.mirrorCamera ?? ""));
    micMenu.fill(deviceOptions(devices, "audioinput", String(v.mirrorMic ?? "")), String(v.mirrorMic ?? ""));
  };

  const openCamera = async (label: string) => {
    if (closed) return;
    note.hidden = false;
    note.textContent = "Ouverture de la caméra…";
    video.srcObject = null;
    const id = pickDevice(devices, "videoinput", label);
    let stream: MediaStream | null;
    try {
      stream = await cam.open(() =>
        navigator.mediaDevices.getUserMedia({ video: { deviceId: id ? { exact: id } : undefined, width: { ideal: 640 }, height: { ideal: 360 } }, audio: false }),
      );
    } catch (err) {
      if (closed) return;
      note.textContent = openError((err as { name?: string })?.name ?? "", "camera");
      drawDots();
      return;
    }
    drawDots();
    if (!stream || closed) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    note.hidden = true;
    // Ondine fait un clin d'œil, une seule fois, quand on se voit.
    if (!winked) {
      winked = true;
      api.emit("mascot.emote", { emotion: "wink" });
    }
  };

  const closeAudio = () => {
    const a = audio;
    audio = null;
    if (a) void a.ctx.close().catch(() => undefined);
  };

  const openMic = async (label: string) => {
    if (closed) return;
    closeAudio();
    micNote.textContent = "";
    const id = pickDevice(devices, "audioinput", label);
    let stream: MediaStream | null;
    try {
      // Sans traitement : la jauge montre ce que le micro capte vraiment.
      stream = await mic.open(() =>
        navigator.mediaDevices.getUserMedia({ audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false }),
      );
    } catch (err) {
      if (closed) return;
      micNote.textContent = openError((err as { name?: string })?.name ?? "", "mic");
      drawDots();
      return;
    }
    drawDots();
    if (!stream || closed) return;
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      // Rien n'est relié aux haut-parleurs : on mesure seulement.
      ctx.createMediaStreamSource(stream).connect(analyser);
      audio = { ctx, analyser, buf: new Float32Array(analyser.fftSize) };
    } catch {
      micNote.textContent = "Jauge du micro indisponible.";
    }
  };

  // ── La boucle : la jauge à chaque image, la luminance chaque seconde ──────
  const probe = document.createElement("canvas");
  probe.width = 32;
  probe.height = 18;
  let level = 0;
  let isDark = false;
  let lastProbe = 0;
  const stopLoop = frameLoop(meter, (now) => {
    if (audio) {
      audio.analyser.getFloatTimeDomainData(audio.buf);
      level = smoothLevel(level, meterLevel(audio.buf));
    } else level = 0;
    fill.style.transform = `scaleX(${level.toFixed(3)})`;
    meter.setAttribute("aria-valuenow", String(Math.round(level * 100)));
    if (now - lastProbe > 1000 && cam.value && video.readyState >= 2) {
      lastProbe = now;
      const ctx = probe.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, probe.width, probe.height);
        isDark = tooDark(meanLuma(ctx.getImageData(0, 0, probe.width, probe.height).data), isDark);
        dark.hidden = !isDark;
      }
    }
  });

  // ── Le micro coupé (module Contrôles) ──────────────────────────────────────
  const showMuted = (on: boolean) => (muted.hidden = !on);
  void api
    .invoke<{ micMuted?: boolean } | null>("mic")
    .then((r) => !closed && showMuted(r?.micMuted === true))
    .catch(() => undefined);
  const offMuted = api.on("controls.mic-muted", (msg) => showMuted(!!(msg.payload as { muted?: boolean } | null)?.muted));

  // Une caméra ou un micro branché ou débranché : les menus suivent.
  const onDeviceChange = () => void listDevices();
  navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);

  // ── C'est parti ────────────────────────────────────────────────────────────
  if (!navigator.mediaDevices?.getUserMedia) {
    note.textContent = "Pas de caméra disponible ici.";
  } else {
    void (async () => {
      await listDevices(); // les identifiants, pour ouvrir l'appareil choisi
      await openCamera(String(values().mirrorCamera ?? ""));
      await openMic(String(values().mirrorMic ?? ""));
      await listDevices(); // l'autorisation donnée : les noms arrivent
      // Les noms n'étaient pas connus avant l'autorisation : celui de Windows a
      // été ouvert. Si l'appareil choisi est là, on passe dessus.
      const v = values();
      const wantCam = String(v.mirrorCamera ?? "");
      const wantMic = String(v.mirrorMic ?? "");
      if (wantCam && pickDevice(devices, "videoinput", wantCam) && cam.value?.getVideoTracks()[0]?.label !== wantCam) await openCamera(wantCam);
      if (wantMic && pickDevice(devices, "audioinput", wantMic) && mic.value?.getAudioTracks()[0]?.label !== wantMic) await openMic(wantMic);
    })();
  }

  const close = () => {
    if (closed) return;
    closed = true;
    stopLoop();
    offMuted();
    navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
    video.srcObject = null;
    cam.destroy();
    mic.destroy();
    closeAudio();
    drawDots();
    if (active === close) active = null;
  };
  active = close;
  return close;
}
