// Le mode démo : de fausses données propres, pour les captures d'écran et la
// vidéo de présentation (réglage general.demo).
//
// Quand il est allumé :
//   - chaque appel d'un module au Rust (api.invoke) reçoit une réponse inventée
//     ici. Rien n'arrive au Rust : aucun fichier n'est touché, aucune commande
//     n'est lancée, rien ne part sur Internet ;
//   - les vraies nouvelles du Rust (musique, presse-papiers, agents…) sont
//     ignorées : rien de personnel ne s'affiche ;
//   - la fenêtre de réglages peut jouer de petites scènes (« Claude a fini »,
//     « Claude demande une autorisation »…) pour filmer les notifications.
//
// Toutes les données d'ici sont inventées.

import { Bridge } from "./bridge";
import type { Bus, BusMessage } from "./bus";
import { settingsStore } from "./settings-store";

export function demoOn(): boolean {
  return settingsStore.current.general.demo === true;
}

/** Les scènes que la fenêtre de réglages peut demander (sujet « demo.scene »). */
export const DEMO_SCENES = ["claude-done", "claude-permission", "download", "next-track"] as const;
export type DemoScene = (typeof DEMO_SCENES)[number];

/**
 * Les nouvelles du Rust qu'on ignore en mode démo : elles parlent de tes
 * vraies données. On garde le reste (ouvrir l'île, raccourcis…).
 */
const REAL_DATA = [
  "agenda.", "agents.", "claude.", "capture.", "clipboard.changed", "clipboard.link-cleaned", "controls.",
  "media.", "nettools.", "notes.", "remote.", "rules.notify", "shelf.", "system.", "task.",
];

export function hidesRealData(msg: BusMessage): boolean {
  return demoOn() && msg.origin === "rust" && REAL_DATA.some((p) => msg.topic.startsWith(p));
}

// ── Les fausses données ──────────────────────────────────────────────────────

const MIN = 60_000;
const HOME = "C:\\Users\\Demo";

/** Dans `minutes`, arrondi au quart d'heure : l'agenda reste crédible à toute heure. */
function soon(minutes: number): number {
  const quarter = 15 * MIN;
  return Math.ceil((Date.now() + minutes * MIN) / quarter) * quarter;
}

/** Demain (ou dans `days` jours) à cette heure, en ms. */
function day(days: number, hour: number, minute = 0): number {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

/** Une pochette dessinée (un coucher de soleil sur la mer), sans aucune image réelle. */
const COVERS = [
  ["#ff9a6b", "#ff5e8a", "#5b3fb8"],
  ["#5ee7df", "#3a8dde", "#1d2b64"],
];
function cover(n: number): string {
  const [a, b, c] = COVERS[n % COVERS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs>
<rect width="200" height="200" fill="url(#g)"/><circle cx="100" cy="112" r="34" fill="#fff" opacity=".85"/>
<path d="M0 128q25-10 50 0t50 0t50 0t50 0V200H0z" fill="${c}" opacity=".9"/>
<path d="M0 148q25-8 50 0t50 0t50 0t50 0V200H0z" fill="#000" opacity=".25"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const TRACKS = [
  { title: "Lumière d'été", artist: "Les Vagues", album: "Marées", durationMs: 214_000 },
  { title: "Nuit bleue", artist: "Corail", album: "Profondeurs", durationMs: 187_000 },
];

const state = {
  track: 0,
  playing: true,
  /** Position au moment `since` (ms). */
  positionMs: 63_000,
  since: performance.now(),
  // De 0 à 100, comme Windows.
  speakers: { volume: 62, muted: false },
  microphone: { volume: 80, muted: false },
  radios: { wifi: true, bluetooth: true },
  brightness: 70,
  output: "speakers",
  pinnedClips: new Set<number>([1]),
  todosDone: new Set<number>([2]),
};

function position(): number {
  const t = TRACKS[state.track];
  const moved = state.playing ? performance.now() - state.since : 0;
  return Math.min(state.positionMs + moved, t.durationMs);
}

function mediaState() {
  const t = TRACKS[state.track];
  return {
    playing: {
      app: "Spotify.exe",
      ...t,
      status: state.playing ? "playing" : "paused",
      positionMs: Math.round(position()),
      canToggle: true,
      canNext: true,
      canPrevious: true,
      canSeek: true,
    },
    // Un numéro de pochette à part (1000+) : il ne se confond pas avec les vrais.
    artwork: 1000 + state.track,
  };
}

function setPosition(ms: number) {
  state.positionMs = ms;
  state.since = performance.now();
}

function agenda() {
  const event = (key: string, title: string, location: string, start: number, minutes: number) => ({
    key, title, location, start, end: start + minutes * MIN, allDay: false,
  });
  return {
    events: [
      event("d1", "Point d'équipe", "Salle Océan", soon(20), 30),
      event("d2", "Café avec Léa", "Le Petit Port", soon(90), 45),
      event("d3", "Revue du site", "Visio", soon(180), 45),
      event("d4", "Démo d'Ondine", "Salle Lagune", day(1, 10), 60),
      event("d5", "Rendez-vous dentiste", "", day(2, 17, 30), 30),
    ],
    errors: [],
    files: 1,
    online: true,
    read: 5,
    latest: null,
  };
}

function notes() {
  const todo = (id: number, text: string) => ({ id, text, done: state.todosDone.has(id), created: Date.now() - id * 3600_000 });
  return {
    notes: [
      { id: 1, text: "Idées pour le site\n- une vidéo courte\n- les captures de chaque onglet\n- la page en anglais", updated: Date.now() - 25 * MIN },
      { id: 2, text: "Courses : café, citrons, pain", updated: Date.now() - 3 * 3600_000 },
    ],
    todos: [todo(1, "Préparer la démo"), todo(2, "Envoyer le devis"), todo(3, "Rappeler le garage"), todo(4, "Acheter du café")],
  };
}

function clipboard(query: string) {
  const items = [
    { id: 1, preview: "https://ondine.pissits.com", chars: 26, at: Date.now() - 2 * MIN },
    { id: 2, preview: "git commit -m \"Ondine 1.0\"", chars: 26, at: Date.now() - 9 * MIN },
    { id: 3, preview: "Rendez-vous jeudi à 14 h devant la gare", chars: 39, at: Date.now() - 40 * MIN },
    { id: 4, preview: "#4FB8FF", chars: 7, at: Date.now() - 2 * 3600_000 },
    { id: 5, preview: "ipconfig /flushdns", chars: 18, at: Date.now() - 5 * 3600_000 },
  ]
    .map((i) => ({ ...i, pinned: state.pinnedClips.has(i.id) }))
    .filter((i) => !query || i.preview.toLowerCase().includes(query.toLowerCase()));
  return {
    items,
    snippets: [
      { id: 1, name: "Signature", text: "Bonne journée,\nCamille" },
      { id: 2, name: "Wi-Fi invités", text: "Réseau : Ondine-Invites" },
    ],
    total: items.length,
  };
}

const SHELF = [
  { path: `${HOME}\\Documents\\Présentation.pptx`, name: "Présentation.pptx", isDir: false, exists: true },
  { path: `${HOME}\\Pictures\\Maquette du site.png`, name: "Maquette du site.png", isDir: false, exists: true },
  { path: `${HOME}\\Documents\\Rapport annuel.pdf`, name: "Rapport annuel.pdf", isDir: false, exists: true },
];

function system() {
  return {
    host: "PC-ONDINE",
    user: "demo",
    domain: "",
    os: "Windows 11 Pro",
    osBuild: "26100",
    uptimeSecs: 3 * 3600 + 1240,
    cpu: { brand: "Intel Core i7-1360P", cores: 16, usage: 8 + Math.random() * 14 },
    mem: { totalGb: 16, usedGb: 7.2 + Math.random() * 0.6 },
    disks: [
      { mount: "C:\\", label: "Windows", totalGb: 476, freeGb: 212, removable: false },
      { mount: "D:\\", label: "Données", totalGb: 931, freeGb: 540, removable: false },
    ],
    net: [{ name: "Wi-Fi", ips: ["192.168.1.42"], mac: "02-00-4C-4F-4F-50" }],
    battery: { percent: 84, charging: true, plugged: true },
  };
}

function agentsHistory() {
  const now = Date.now();
  return {
    events: [
      { at: now - 6 * MIN, source: "claude-code", kind: "done", title: "Claude a fini", body: "Les captures sont prêtes", project: "site-ondine", session: "s1" },
      { at: now - 18 * MIN, source: "gemini", kind: "done", title: "Gemini a fini", body: "Tests au vert", project: "api-meteo", session: "s2" },
    ],
    working: 1,
    sessions: [
      { id: "s1", source: "claude-code", project: "site-ondine", state: "working", since: now - 4 * MIN },
      { id: "s2", source: "gemini", project: "api-meteo", state: "done", since: now - 18 * MIN },
    ],
    asks: [],
    quiet: null,
  };
}

const RULE_EMPTY = { extensions: [], nameContains: "", minKb: null, maxKb: null };

/** L'historique de la pipette (module Capture) : une petite palette inventée. */
const DEMO_COLORS = ["#3A7BD5", "#00D2FF", "#F7B733", "#FC4A1A", "#6A3093", "#2ECC71", "#1F2937", "#F5F5F4"];

// ── Les réponses aux modules ─────────────────────────────────────────────────

/** Ce que le Rust aurait répondu. Les actions ne font rien (ou changent les fausses données). */
export async function demoInvoke(bus: Bus, module: string, command: string, raw: unknown): Promise<unknown> {
  const args = (raw ?? {}) as Record<string, unknown>;
  switch (`${module}.${command}`) {
    // Musique
    case "media.state":
      return mediaState();
    case "media.artwork":
      return { url: cover(state.track) };
    case "media.toggle":
      setPosition(position());
      state.playing = !state.playing;
      return void bus.inject("media.changed", mediaState(), "media");
    case "media.next":
    case "media.previous":
      state.track = (state.track + 1) % TRACKS.length;
      setPosition(0);
      state.playing = true;
      return void bus.inject("media.changed", mediaState(), "media");
    case "media.seek":
      setPosition(Number(args.positionMs) || 0);
      return void bus.inject("media.changed", mediaState(), "media");

    // Contrôles
    case "controls.state":
      return { speakers: { ...state.speakers }, microphone: { ...state.microphone } };
    case "controls.set_volume":
      state[args.device === "microphone" ? "microphone" : "speakers"].volume = Number(args.volume) || 0;
      return null;
    case "controls.set_muted":
      state[args.device === "microphone" ? "microphone" : "speakers"].muted = args.muted === true;
      return null;
    case "controls.toggle_mic":
      state.microphone.muted = !state.microphone.muted;
      return { muted: state.microphone.muted };
    case "controls.radios":
      return [
        { kind: "wifi", on: state.radios.wifi, disabled: false },
        { kind: "bluetooth", on: state.radios.bluetooth, disabled: false },
      ];
    case "controls.set_radio":
      if (args.kind === "wifi" || args.kind === "bluetooth") state.radios[args.kind] = args.on === true;
      return null;
    case "controls.set_airplane":
      state.radios.wifi = state.radios.bluetooth = args.on !== true;
      return null;
    case "controls.screens":
      return [{ id: "1", name: "Écran intégré", brightness: state.brightness }];
    case "controls.set_brightness":
      state.brightness = Number(args.brightness) || 0;
      return null;
    case "controls.outputs":
      return [
        { id: "speakers", name: "Haut-parleurs", default: state.output === "speakers" },
        { id: "headset", name: "Casque Bluetooth", default: state.output === "headset" },
      ];
    case "controls.set_output":
      state.output = String(args.id);
      return null;
    case "controls.media_use":
      return { mic: [], camera: [] };
    case "controls.window":
      return { title: "Présentation.pptx - PowerPoint", pinned: false };
    case "controls.toggle_pin":
      return { title: "Présentation.pptx - PowerPoint", pinned: true };

    // Agenda, notes, presse-papiers, étagère
    case "agenda.upcoming":
    case "agenda.reload":
      return agenda();
    case "notes.list":
      return notes();
    case "notes.todo_toggle": {
      const id = Number(args.id);
      if (state.todosDone.has(id)) state.todosDone.delete(id);
      else state.todosDone.add(id);
      bus.inject("notes.changed", null, "notes");
      return null;
    }
    case "notes.note_save":
      return { id: Number(args.id) || 99 };
    case "clipboard.list":
      return clipboard(String(args.query ?? ""));
    case "clipboard.pin": {
      const id = Number(args.id);
      if (args.pinned) state.pinnedClips.add(id);
      else state.pinnedClips.delete(id);
      bus.inject("clipboard.changed", null, "clipboard");
      return null;
    }
    case "clipboard.password_generate":
      return { password: "Vague-Corail-Lagune-27" };
    case "shelf.list":
      return { items: SHELF };
    case "shelf.add":
      return { added: 0 };
    case "shelf.copy_paths":
      return { count: SHELF.length };
    case "shelf.rename_preview":
      return [];
    case "shelf.images":
      return { count: 0, failed: 0, error: null };

    // Système, réseau, accès distants
    case "system.snapshot":
      return system();
    case "nettools.status":
      return { internet: true, vpns: [], publicIp: "203.0.113.24" };
    case "nettools.ping":
      return { ip: "93.184.215.14", ms: 14 + Math.round(Math.random() * 8), ttl: 56 };
    case "nettools.port":
      return { ip: "93.184.215.14", state: "open", ms: 21 };
    case "nettools.dns":
      return { reverse: false, addrs: ["93.184.215.14", "2606:2800:21f:cb07::1"], ms: 12 };
    case "remote.list":
      return {
        favorites: [
          { id: 1, name: "Serveur web", kind: "ssh", host: "web.exemple.fr", port: 22, user: "admin" },
          { id: 2, name: "Poste de l'accueil", kind: "rdp", host: "accueil.exemple.local", port: null, user: "" },
        ],
      };
    case "remote.probe":
      return { online: true, ms: 10 + Number(args.id) * 7 };
    case "rules.list":
      return {
        rules: [
          { id: 1, name: "Ranger les PDF", enabled: true, trigger: { type: "file", folder: `${HOME}\\Downloads` }, conditions: { ...RULE_EMPTY, extensions: ["pdf"] }, actions: [{ type: "move", to: `${HOME}\\Documents\\PDF` }] },
          { id: 2, name: "Clé USB branchée", enabled: true, trigger: { type: "drive" }, conditions: RULE_EMPTY, actions: [{ type: "reveal" }] },
        ],
        paused: false,
        history: [{ at: Date.now() - 12 * MIN, rule: "Ranger les PDF", subject: "Facture-octobre.pdf", ok: true, message: "Déplacé dans PDF" }],
        errors: {},
        topics: [],
      };
    case "launcher.entries":
      return {
        items: [
          { id: 1, name: "Explorateur de fichiers", kind: "app", detail: "" },
          { id: 2, name: "Terminal", kind: "app", detail: "" },
          { id: 3, name: "Calculatrice", kind: "app", detail: "" },
          { id: 4, name: "Présentation.pptx", kind: "recent", detail: `${HOME}\\Documents` },
        ],
        hotkey: "",
        hotkeyError: null,
      };
    case "terminal.start_dir":
      return { dir: HOME };
    case "capture.last":
      return { result: null };
    case "capture.colors":
      return { colors: DEMO_COLORS.map((hex) => ({ hex, text: hex })) };
    case "capture.pick_color":
      // Pas de vraie pipette : une couleur « choisie » un instant plus tard.
      setTimeout(() => bus.inject("capture.color", { ok: true, hex: "#3A7BD5", text: "#3A7BD5" }, "capture"), 900);
      return null;
    case "capture.copy_color":
      return { text: String(args.hex ?? "") };

    // Agents IA et « Demander à Claude »
    case "agents.history":
      return agentsHistory();
    case "agents.projects":
      return { tools: ["claude", "codex", "gemini"], projects: [{ path: `${HOME}\\Projets\\site-ondine`, name: "site-ondine" }] };
    case "agents.hook_config":
      return { exe: "C:\\Program Files\\Ondine\\ondine.exe" };
    case "agents.answer":
      bus.inject("agents.ask.closed", { id: Number(args.id), expired: false }, "agents");
      return null;
    case "askclaude.status":
      return { hasKey: true };
    case "askclaude.prepare":
      return {
        id: 1,
        name: "Texte copié",
        text: "Ondine est une petite île en haut de l'écran : musique, agenda, notes et agents IA, sans changer de fenêtre.",
        image: null,
        bytes: 112,
        model: "claude-sonnet",
        instruction: "Rends ce texte plus accrocheur",
        destination: "API Claude (Anthropic)",
      };
    case "askclaude.send":
      return {
        answer: "Ondine, c'est ton bureau en un coup d'œil : la musique, l'agenda, les notes et tes agents IA tiennent dans une petite île, toujours à portée de souris.",
        model: "claude-sonnet",
        truncated: false,
        inputTokens: 64,
        outputTokens: 48,
      };
    default:
      // Toute autre action : on fait comme si c'était fait, sans rien toucher.
      return null;
  }
}

// ── Allumer, éteindre, scènes ────────────────────────────────────────────────

/** Les sujets « …changed » qui font relire leurs données aux modules. */
const REFRESH = ["agenda.changed", "notes.changed", "clipboard.changed", "rules.changed", "remote.changed", "agents.changed"];

/** Fait relire leurs données à tous les modules (fausses ou vraies selon le mode). */
async function refreshAll(bus: Bus) {
  for (const topic of REFRESH) bus.inject(topic, null, "demo");
  if (demoOn()) {
    // Le morceau repart du même endroit à chaque fois qu'on allume le mode démo.
    state.track = 0;
    state.playing = true;
    setPosition(63_000);
    bus.inject("media.changed", mediaState(), "demo");
    bus.inject("shelf.changed", { items: SHELF }, "demo");
    return;
  }
  // Retour aux vraies données : on redemande la musique et l'étagère au Rust.
  const media = await Bridge.moduleInvoke("media", "state", null).catch(() => null);
  bus.inject("media.changed", media ?? { playing: null, artwork: -1 }, "demo");
  const shelf = await Bridge.moduleInvoke<{ items: unknown[] }>("shelf", "list", null).catch(() => null);
  bus.inject("shelf.changed", shelf ?? { items: [] }, "demo");
}

function playScene(bus: Bus, scene: string) {
  const now = Date.now();
  switch (scene) {
    case "claude-done":
      bus.inject("agents.event", { at: now, source: "claude-code", kind: "done", title: "Claude a fini", body: "Le site est à jour", project: "site-ondine", session: "s1" }, "demo");
      break;
    case "claude-permission":
      bus.inject(
        "agents.ask",
        { id: 900 + (now % 100), kind: "permission", who: "Claude", question: "Claude veut lancer une commande", detail: "npm run build", options: ["Autoriser", "Refuser", "Au terminal"], session: "s1", until: now + 10 * MIN },
        "demo",
      );
      break;
    case "download":
      bus.inject("shelf.downloaded", { name: "Facture-octobre.pdf" }, "demo");
      break;
    case "next-track":
      state.track = (state.track + 1) % TRACKS.length;
      setPosition(0);
      state.playing = true;
      bus.inject("media.changed", mediaState(), "demo");
      break;
  }
}

/** Branche le mode démo sur l'île (fenêtre principale). */
export function startDemo(bus: Bus) {
  let was = demoOn();
  if (was) void refreshAll(bus);
  settingsStore.onChange(() => {
    if (demoOn() === was) return;
    was = demoOn();
    void refreshAll(bus);
  });
  bus.on("demo.scene", (msg) => {
    if (demoOn()) playScene(bus, String((msg.payload as { scene?: string } | null)?.scene ?? ""));
  });
}
