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
import { levelFor } from "../modules/agents/github-logic";
import type { Bus, BusMessage } from "./bus";
import { settingsStore } from "./settings-store";

export function demoOn(): boolean {
  return settingsStore.current.general.demo === true;
}

/** Les scènes que la fenêtre de réglages peut demander (sujet « demo.scene »). */
export const DEMO_SCENES = ["claude-done", "claude-permission", "download", "next-track", "whats-new", "halos-battery", "halos-tour", "voice", "mascot-talk", "ai-outage", "team-visit", "island-dodge"] as const;
export type DemoScene = (typeof DEMO_SCENES)[number];

/**
 * Les nouvelles du Rust qu'on ignore en mode démo : elles parlent de tes
 * vraies données. On garde le reste (ouvrir l'île, raccourcis…).
 */
const REAL_DATA = [
  "agenda.", "agents.", "claude.", "capture.", "clipboard.changed", "clipboard.link-cleaned", "controls.",
  "media.", "nettools.", "notes.", "remote.", "rules.notify", "shelf.", "system.", "task.",
  "weather.", "halos.", "team.",
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
  /** Mode sombre et éclairage nocturne de Windows (onglet Contrôles). */
  dark: false,
  night: false,
  /** Une clé USB inventée est branchée (onglet Contrôles). */
  usbKey: true,
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
  const calendars = [
    { id: "travail", name: "Travail", color: "#4fb8ff", kind: "link" },
    { id: "perso", name: "Perso", color: "#ff8a65", kind: "link" },
    { id: "f1", name: "Club de voile", color: "#7bd88f", kind: "file" },
  ];
  const event = (key: string, cal: number, title: string, location: string, start: number, minutes: number, link: string | null = null) => ({
    key, title, location, start, end: start + minutes * MIN, allDay: false,
    calendar: calendars[cal].id, calendarName: calendars[cal].name, color: calendars[cal].color, link,
  });
  return {
    events: [
      event("d1", 0, "Point d'équipe", "Réunion Microsoft Teams", soon(20), 30, "teams"),
      event("d2", 1, "Café avec Léa", "Le Petit Port", soon(90), 45),
      event("d3", 0, "Revue du site", "Google Meet", soon(180), 45, "meet"),
      event("d4", 0, "Démo d'Ondine", "Salle Lagune", day(1, 10), 60),
      event("d6", 2, "Sortie en mer", "Port de La Rochelle", day(1, 14), 120, "web"),
      event("d5", 1, "Rendez-vous dentiste", "", day(2, 17, 30), 30),
    ],
    errors: [],
    calendars,
    read: 6,
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

/** Un jeton JWT inventé (bouton « Décoder » du Presse-papiers) : émis il y a 1 h, valable 8 h. */
function demoJwt(): string {
  const part = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const iat = Math.floor(Date.now() / 1000 / 60) * 60 - 3600;
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: "demo", name: "Camille", role: "support", iat, exp: iat + 8 * 3600 })}.q3vN8kH2pL0sT5wY7zB1cD4fG6jM9nR2tV5xA8eC0Eo`;
}

function clipboard(query: string) {
  const jwt = demoJwt();
  const items = [
    { id: 1, preview: "https://ondine.pissits.com", chars: 26, at: Date.now() - 2 * MIN },
    { id: 5, preview: jwt, chars: jwt.length, at: Date.now() - 5 * MIN },
    { id: 2, preview: "git commit -m \"Ondine 1.0\"", chars: 26, at: Date.now() - 9 * MIN },
    { id: 3, preview: "Rendez-vous jeudi à 14 h devant la gare", chars: 39, at: Date.now() - 40 * MIN },
    { id: 4, preview: "#4FB8FF", chars: 7, at: Date.now() - 2 * 3600_000 },
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

/**
 * Le QR code du mode démo (bouton ▦ du Presse-papiers) : un vrai code, calculé
 * une fois par clipboard_qr.rs, pour « https://ondine.pissits.com ». Le même
 * pour toutes les copies de démo (le Rust n'est pas appelé en démo).
 */
const DEMO_QR_SIZE = 33;
const DEMO_QR_PATH =
  "M4 4h7v1h-7zM12 4h2v1h-2zM15 4h2v1h-2zM18 4h1v1h-1zM20 4h1v1h-1zM22 4h7v1h-7zM4 5h1v1h-1z" +
  "M10 5h1v1h-1zM12 5h2v1h-2zM16 5h3v1h-3zM20 5h1v1h-1zM22 5h1v1h-1zM28 5h1v1h-1zM4 6h1v1h-1z" +
  "M6 6h3v1h-3zM10 6h1v1h-1zM13 6h2v1h-2zM17 6h2v1h-2zM20 6h1v1h-1zM22 6h1v1h-1zM24 6h3v1h-3z" +
  "M28 6h1v1h-1zM4 7h1v1h-1zM6 7h3v1h-3zM10 7h1v1h-1zM12 7h1v1h-1zM14 7h1v1h-1zM17 7h2v1h-2z" +
  "M22 7h1v1h-1zM24 7h3v1h-3zM28 7h1v1h-1zM4 8h1v1h-1zM6 8h3v1h-3zM10 8h1v1h-1zM14 8h1v1h-1z" +
  "M19 8h2v1h-2zM22 8h1v1h-1zM24 8h3v1h-3zM28 8h1v1h-1zM4 9h1v1h-1zM10 9h1v1h-1zM15 9h1v1h-1z" +
  "M20 9h1v1h-1zM22 9h1v1h-1zM28 9h1v1h-1zM4 10h7v1h-7zM12 10h1v1h-1zM14 10h1v1h-1zM16 10h1v1h-1z" +
  "M18 10h1v1h-1zM20 10h1v1h-1zM22 10h7v1h-7zM12 11h3v1h-3zM4 12h1v1h-1zM6 12h2v1h-2zM9 12h3v1h-3z" +
  "M14 12h1v1h-1zM16 12h1v1h-1zM18 12h1v1h-1zM22 12h1v1h-1zM25 12h1v1h-1zM27 12h2v1h-2zM5 13h2v1h-2z" +
  "M12 13h1v1h-1zM15 13h3v1h-3zM20 13h1v1h-1zM23 13h1v1h-1zM27 13h1v1h-1zM4 14h1v1h-1zM10 14h3v1h-3z" +
  "M15 14h1v1h-1zM18 14h1v1h-1zM22 14h2v1h-2zM5 15h1v1h-1zM7 15h1v1h-1zM9 15h1v1h-1zM11 15h2v1h-2z" +
  "M14 15h2v1h-2zM17 15h3v1h-3zM22 15h1v1h-1zM24 15h3v1h-3zM4 16h3v1h-3zM10 16h1v1h-1zM14 16h5v1h-5z" +
  "M21 16h2v1h-2zM24 16h1v1h-1zM26 16h3v1h-3zM7 17h2v1h-2zM11 17h1v1h-1zM14 17h2v1h-2zM19 17h1v1h-1z" +
  "M21 17h4v1h-4zM28 17h1v1h-1zM5 18h1v1h-1zM8 18h1v1h-1zM10 18h1v1h-1zM13 18h2v1h-2zM16 18h3v1h-3z" +
  "M21 18h1v1h-1zM24 18h1v1h-1zM26 18h2v1h-2zM4 19h1v1h-1zM6 19h1v1h-1zM8 19h1v1h-1zM12 19h2v1h-2z" +
  "M19 19h2v1h-2zM22 19h3v1h-3zM28 19h1v1h-1zM8 20h3v1h-3zM12 20h2v1h-2zM17 20h1v1h-1zM20 20h9v1h-9z" +
  "M12 21h1v1h-1zM15 21h4v1h-4zM20 21h1v1h-1zM24 21h1v1h-1zM26 21h1v1h-1zM28 21h1v1h-1zM4 22h7v1h-7z" +
  "M12 22h3v1h-3zM17 22h1v1h-1zM20 22h1v1h-1zM22 22h1v1h-1zM24 22h1v1h-1zM26 22h3v1h-3zM4 23h1v1h-1z" +
  "M10 23h1v1h-1zM12 23h2v1h-2zM16 23h1v1h-1zM19 23h2v1h-2zM24 23h1v1h-1zM27 23h2v1h-2zM4 24h1v1h-1z" +
  "M6 24h3v1h-3zM10 24h1v1h-1zM13 24h3v1h-3zM20 24h6v1h-6zM28 24h1v1h-1zM4 25h1v1h-1zM6 25h3v1h-3z" +
  "M10 25h1v1h-1zM12 25h1v1h-1zM14 25h2v1h-2zM17 25h1v1h-1zM19 25h4v1h-4zM24 25h5v1h-5zM4 26h1v1h-1z" +
  "M6 26h3v1h-3zM10 26h1v1h-1zM12 26h2v1h-2zM15 26h3v1h-3zM19 26h4v1h-4zM24 26h1v1h-1zM26 26h2v1h-2z" +
  "M4 27h1v1h-1zM10 27h1v1h-1zM15 27h1v1h-1zM17 27h1v1h-1zM22 27h1v1h-1zM24 27h1v1h-1zM26 27h1v1h-1z" +
  "M4 28h7v1h-7zM12 28h1v1h-1zM16 28h3v1h-3zM21 28h8v1h-8z";
function demoQr() {
  const n = DEMO_QR_SIZE;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path fill="#000" d="${DEMO_QR_PATH}"/></svg>`;
  return { image: `data:image/svg+xml,${encodeURIComponent(svg)}`, size: n };
}

const SHELF = [
  { path: `${HOME}\\Documents\\Présentation.pptx`, name: "Présentation.pptx", isDir: false, exists: true },
  { path: `${HOME}\\Pictures\\Maquette du site.png`, name: "Maquette du site.png", isDir: false, exists: true },
  { path: `${HOME}\\Documents\\Rapport annuel.pdf`, name: "Rapport annuel.pdf", isDir: false, exists: true },
];

/** Le dossier « choisi » par Copier vers… / Déplacer vers… en mode démo (pas de vraie boîte). */
export const DEMO_PICKED_FOLDER = `${HOME}\\Documents\\Projets`;

/** Des captures inventées (« Recherche dans l'île »). */
const CAPTURES = [
  { name: "Capture 2026-10-02 09.41.12.png", date: "2 octobre 2026 à 09:41" },
  { name: "Capture 2026-09-28 16.05.47.png", date: "28 septembre 2026 à 16:05" },
  { name: "Maquette de l'onglet Notes.png", date: "21 septembre 2026 à 11:20" },
];

/** « Été » → « ete » : comme la recherche du Rust (sans accents ni majuscules). */
function plain(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** La recherche dans l'île, sur les fausses données : 5 résultats au plus par source. */
function islandSearch(query: string) {
  const q = plain(query.trim());
  if (q.length < 2) return { groups: [] };
  const hit = (...texts: string[]) => texts.some((t) => plain(t).includes(q));
  const n = notes();
  const clips = clipboard("");
  const groups = [
    {
      source: "notes",
      items: [
        ...n.notes.filter((x) => hit(x.text)).map((x) => {
          const [title, ...rest] = x.text.split("\n");
          return { kind: "note", id: x.id, title, detail: rest.join(" · "), at: x.updated };
        }),
        ...n.todos.filter((x) => hit(x.text)).map((x) => ({ kind: "todo", id: x.id, title: x.text, done: x.done, at: x.created })),
      ],
    },
    {
      source: "clipboard",
      items: [
        ...clips.items.filter((x) => hit(x.preview)).map((x) => ({ kind: "clip", id: x.id, title: x.preview, pinned: x.pinned, at: x.at })),
        ...clips.snippets.filter((x) => hit(x.name, x.text)).map((x) => ({ kind: "snippet", id: x.id, title: x.name, detail: x.text.replace(/\n/g, " ") })),
      ],
    },
    {
      source: "shelf",
      items: SHELF.filter((x) => hit(x.name)).map((x) => ({ kind: "file", path: x.path, title: x.name, detail: x.path.slice(0, x.path.lastIndexOf("\\")) })),
    },
    {
      source: "capture",
      items: CAPTURES.filter((x) => hit(x.name, x.date)).map((x) => ({ kind: "file", name: x.name, title: x.name, detail: x.date })),
    },
  ];
  return { groups: groups.map((g) => ({ ...g, items: g.items.slice(0, 5) })).filter((g) => g.items.length) };
}

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
      // Relus de l'historique des 7 jours (agents-history.json) : sans message, avec le bilan git.
      { at: now - 26 * 60 * MIN, source: "claude-code", kind: "done", title: "Claude a fini", body: "", project: "Island", session: "", changes: { files: 3, added: 120, removed: 14, names: ["main.rs", "index.ts", "README.md"], dir: "", vscode: false, terminal: false } },
      { at: now - 50 * 60 * MIN, source: "codex", kind: "waiting", title: "Codex attend votre permission", body: "", project: "site-ondine", session: "" },
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

/** Les services IA surveillés (Réseau). */
const DEMO_AI = [
  { id: "claude", name: "Claude" },
  { id: "chatgpt", name: "ChatGPT" },
  { id: "gemini", name: "Gemini" },
];

/** « Bureau propre » du mode démo : les icônes du bureau sont-elles cachées ? */
let demoDeskHidden = false;
const RULE_EMPTY = { extensions: [], nameContains: "", minKb: null, maxKb: null };

/** La clé USB inventée de l'onglet Contrôles. */
const DEMO_USB = { root: "E:\\", letter: "E:", label: "KINGSTON", removable: true, ejecting: false };

/** L'historique de la pipette (module Capture) : une petite palette inventée. */
const DEMO_COLORS = ["#3A7BD5", "#00D2FF", "#F7B733", "#FC4A1A", "#6A3093", "#2ECC71", "#1F2937", "#F5F5F4"];

/** Le compteur de jetons (onglet Agents IA) : trente jours inventés, Claude Code surtout, un peu de Codex. */
function agentsUsage() {
  const pad = (n: number) => String(n).padStart(2, "0");
  const days = [];
  // Trente jours pour la courbe : des journées plus ou moins chargées, les week-ends au repos.
  for (let back = 29; back >= 0; back--) {
    const d = new Date();
    d.setDate(d.getDate() - back);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const k = 1 + ((back * 7) % 5);
    days.push({ day, tool: "claude-code", model: "claude-opus-5-5", input: 1_800 * k, output: 9_500 * k, cacheRead: 410_000 * k, cacheWrite: 38_000 * k, messages: 24 * k });
    if (back % 3 === 0) days.push({ day, tool: "codex", model: "gpt-5-codex", input: 22_000, output: 6_000, cacheRead: 90_000, cacheWrite: 0, messages: 9 });
  }
  return {
    days,
    projects: [
      { name: "site-ondine", tool: "claude-code", input: 30_000, output: 150_000, cacheRead: 6_400_000, cacheWrite: 600_000, messages: 380 },
      { name: "Island", tool: "claude-code", input: 8_000, output: 40_000, cacheRead: 1_900_000, cacheWrite: 170_000, messages: 110 },
      { name: "site-ondine", tool: "codex", input: 66_000, output: 18_000, cacheRead: 270_000, cacheWrite: 0, messages: 27 },
    ],
    tools: ["claude-code", "codex"],
    files: 14,
    partial: false,
  };
}

/** La semaine des agents (carte « Agents IA » du bilan) : 23 tâches, un peu d'attente, deux projets. */
function agentsWeek() {
  const usage = agentsUsage();
  return {
    done: 23,
    waitMinutes: 130,
    projects: ["site-ondine", "Island"],
    // Les 7 derniers jours seulement, comme le Rust.
    days: usage.days.slice(-7),
    prices: "claude-opus ; 15 ; 75 ; 1,5 ; 18,75\ngpt-5-codex ; 1,25 ; 10 ; 0,125 ; 0",
  };
}
/**
 * Le calendrier de contributions GitHub : une année inventée mais plausible
 * (des semaines chargées, des week-ends calmes, une série en cours), tirée au
 * sort de façon fixe pour que la grille soit la même à chaque ouverture.
 */
function githubCalendar(fromCache: boolean) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Le dimanche d'il y a 52 semaines, comme le Rust.
  const start = new Date(today);
  start.setDate(start.getDate() - start.getDay() - 52 * 7);
  let seed = 1234;
  const rand = () => ((seed = (seed * 48271) % 2147483647) % 1000) / 1000;
  const days: { date: string; count: number; level: number }[] = [];
  const counts: number[] = [];
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const age = (today.getTime() - d.getTime()) / 86_400_000;
    const r = rand();
    let count = weekend ? (r < 0.8 ? 0 : 1 + Math.floor(r * 3)) : r < 0.55 ? 0 : 1 + Math.floor(r * 5);
    // Une période de vacances en août, et une série de 12 jours qui court jusqu'à hier.
    if (d.getMonth() === 7 && d.getDate() > 8 && d.getDate() < 24) count = 0;
    if (age < 12 && age >= 1) count = Math.max(count, 1 + Math.floor(r * 4));
    if (age < 1) count = 0;
    counts.push(count);
    days.push({ date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, count, level: 0 });
  }
  const max = Math.max(1, ...counts);
  for (const d of days) d.level = levelFor(d.count, max);
  const total = counts.reduce((a, b) => a + b, 0);
  return { login: "simon-demo", total, streak: 11, today: 0, days, fetchedAt: Date.now() - 4 * MIN, private: false, fromCache };
}
let githubAsked = false;

/** Les hooks des agents (onglet Agents IA) : Claude branché, Codex sur un ancien chemin. */
const DEMO_HOOKS: Record<string, string> = { "claude-code": "installed", codex: "stale", gemini: "absent", copilot: "absent", cursor: "installed", qwen: "absent", goose: "absent" };
function demoHooks() {
  const file = {
    "claude-code": ".claude\\settings.json",
    codex: ".codex\\config.toml",
    gemini: ".gemini\\settings.json",
    copilot: ".copilot\\hooks\\ondine.json",
    cursor: ".cursor\\hooks.json",
    qwen: ".qwen\\settings.json",
    goose: ".agents\\plugins\\ondine\\hooks\\hooks.json",
  } as Record<string, string>;
  return Object.fromEntries(
    Object.entries(DEMO_HOOKS).map(([t, state]) => [t, { file: `${HOME}\\${file[t]}`, state, permission: false, otherPermission: false }]),
  );
}

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
    case "controls.theme":
      return { dark: state.dark, mixed: false, night: { supported: true, on: state.night } };
    // Batteries Bluetooth et « Bureau propre » (bande du bas).
    case "controls.bt_batteries":
      return [
        { name: "Casque Bluetooth", percent: 62, connected: true },
        { name: "Souris MX", percent: 11, connected: true },
      ];
    case "controls.desktop_icons":
      return { hidden: demoDeskHidden };
    case "controls.set_desktop_icons":
      demoDeskHidden = args.hidden === true;
      return { hidden: demoDeskHidden };
    case "controls.set_dark":
      state.dark = args.on === true;
      return null;
    case "controls.set_night":
      state.night = args.on === true;
      return { opened: false };
    case "controls.usb_drives":
      return state.usbKey ? [DEMO_USB] : [];
    case "controls.eject":
      // Comme le Rust : la réponse arrive un peu plus tard, par le bus.
      state.usbKey = false;
      window.setTimeout(() => bus.inject("controls.usb-ejected", { ...DEMO_USB, ok: true }, "controls"), 800);
      return null;

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
    case "clipboard.qr":
      return demoQr();
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
    // Copier / déplacer vers… : rien ne bouge, l'onglet affiche le résultat.
    case "shelf.copy_to":
    case "shelf.move_to":
      return { count: Array.isArray(args.paths) ? args.paths.length : 1, error: null };
    // Vers le téléphone : aucun serveur n'est ouvert, l'adresse est inventée.
    case "shelf.phone_share": {
      const name = String(args.path ?? "").split("\\").pop() || "Présentation.pptx";
      return { id: 1, url: `http://192.168.1.20:51234/4f1c2a9e7b3d4c5a8e6f0a1b2c3d4e5f/${encodeURIComponent(name)}`, qr: demoQr().image, name, size: 2_516_582, seconds: 300 };
    }

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
    // Services IA (réglage aiStatus) : tout va bien, une petite panne hier.
    case "nettools.ai_status":
      return {
        services: DEMO_AI.map((s) => ({ ...s, level: "ok", description: "All Systems Operational", checkedAt: Date.now() })),
        history: [{ id: "chatgpt", from: Date.now() - 26 * 3600_000, to: Date.now() - 25 * 3600_000 - 20 * MIN, level: "degraded" }],
      };
    case "remote.list":
      return {
        favorites: [
          { id: 1, name: "Serveur web", kind: "ssh", host: "web.exemple.fr", port: 22, user: "admin" },
          { id: 2, name: "Poste de l'accueil", kind: "rdp", host: "accueil.exemple.local", port: null, user: "", mac: "02:4F:4E:44:49:4E" },
        ],
      };
    case "remote.probe":
      return { online: true, ms: 10 + Number(args.id) * 7 };
    // Réveiller : rien ne part, le « poste » répond au bout de 4 s.
    case "remote.wake": {
      const fav = { id: Number(args.id), name: "Poste de l'accueil" };
      bus.inject("remote.waking", fav, "remote");
      window.setTimeout(() => bus.inject("remote.wake-done", { ...fav, awake: true, secs: 4, ms: 3 }, "remote"), 4000);
      return { sent: 3 };
    }
    // Équipe : de faux collègues, aucun réseau.
    case "team.state":
      return teamDemo();
    case "team.show_code":
      return { code: "482913", seconds: 180, ip: "192.168.1.20" };
    case "rules.list":
      return {
        rules: [
          { id: 1, name: "Ranger les PDF", enabled: true, trigger: { type: "file", folder: `${HOME}\\Downloads` }, conditions: { ...RULE_EMPTY, extensions: ["pdf"] }, actions: [{ type: "move", to: `${HOME}\\Documents\\PDF` }] },
          { id: 2, name: "Clé USB branchée", enabled: true, trigger: { type: "drive" }, conditions: RULE_EMPTY, actions: [{ type: "reveal" }] },
          { id: 3, name: "Agent fini", enabled: true, trigger: { type: "agent", waiting: false }, conditions: RULE_EMPTY, actions: [{ type: "mascot", gesture: "dance" }] },
          { id: 4, name: "Pause déjeuner", enabled: true, trigger: { type: "schedule", time: "12:30", days: [0, 1, 2, 3, 4] }, conditions: RULE_EMPTY, actions: [{ type: "notify", text: "C'est l'heure de manger !" }, { type: "quiet", minutes: 45 }] },
          { id: 5, name: "Vieux téléchargements", enabled: true, trigger: { type: "schedule", time: "17:00", days: [4], folder: `${HOME}\\Downloads` }, conditions: { ...RULE_EMPTY, olderThanDays: 30 }, actions: [{ type: "trash" }] },
        ],
        paused: false,
        history: [
          { at: Date.now() - 4 * MIN, rule: "Agent fini", subject: "site-ondine", ok: true, message: "la mascotte danse" },
          { at: Date.now() - 12 * MIN, rule: "Ranger les PDF", subject: "Facture-octobre.pdf", ok: true, message: "Déplacé dans PDF" },
        ],
        errors: {},
        topics: [],
        counts: { "1": 7, "3": 12, "4": 4 },
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
    case "launcher.search":
      return islandSearch(String(args.query ?? ""));
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

    // Agents IA et « Parler à Ondine »
    case "agents.history":
      return agentsHistory();
    case "agents.projects":
      return { tools: ["claude", "codex", "gemini", "copilot", "cursor", "qwen", "goose", "opencode", "kiro", "hermes", "aider", "amp"], projects: [{ path: `${HOME}\\Projets\\site-ondine`, name: "site-ondine" }] };
    // « Reprendre » : la dernière phrase de la dernière session du projet.
    case "agents.last_sessions":
      return [{ index: 0, found: true, who: "assistant", text: "Le site est à jour.", at: Date.now() - 2 * 3600_000 }];
    case "agents.hook_config":
      return { exe: "C:\\Program Files\\Ondine\\ondine.exe", other: '"C:\\Program Files\\Ondine\\ondine.exe" notify --source other --event done' };
    // Le bilan cliquable : la liste des fichiers d'un dépôt inventé.
    case "agents.report_files":
      return {
        root: `${HOME}\\Projets\\site-ondine`,
        files: [
          { path: "src/pages/index.astro", added: 84, removed: 9, untracked: false, exists: true },
          { path: "src/styles/site.css", added: 30, removed: 5, untracked: false, exists: true },
          { path: "docs/notes-lancement.md", added: 6, removed: 0, untracked: true, exists: true },
        ],
      };
    case "agents.open_vscode_file":
    case "agents.copy_text":
      return null;
    // Le compteur de jetons : une semaine d'usage inventée, Claude Code et Codex.
    case "agents.usage":
      return agentsUsage();
    // L'export CSV : rien n'est écrit, on fait comme si le fichier était sur l'étagère.
    case "agents.usage_csv":
      return { name: `jetons-agents-${agentsUsage().days.at(-1)?.day}.csv`, shelf: true };
    // La semaine des agents pour le Bilan de la semaine (carte « Agents IA »).
    case "agents.weekly":
      return agentsWeek();
    // Le calendrier GitHub : la première lecture vient « de GitHub », les suivantes de la mémoire.
    case "agents.github_calendar": {
      const cal = githubCalendar(githubAsked);
      githubAsked = true;
      return cal;
    }
    case "agents.answer":
      bus.inject("agents.ask.closed", { id: Number(args.id), expired: false }, "agents");
      return null;
    // Installer les hooks : rien n'est écrit, seul le faux état change.
    case "agents.hook_status":
      return { exe: "C:\\Program Files\\Ondine\\ondine.exe", tools: demoHooks() };
    case "agents.hook_install":
    case "agents.hook_remove": {
      const t = String(args.tool);
      if (t in DEMO_HOOKS) DEMO_HOOKS[t] = command === "hook_install" ? "installed" : "absent";
      return command === "hook_install" ? { backup: null, changed: true, removed: 0, otherPermission: false } : { backup: null, removed: 1 };
    }
    case "askclaude.status":
      return {
        provider: "claude",
        hasKey: true,
        model: "claude-sonnet-5-5",
        destination: "api.anthropic.com",
        keyLabel: "Clé API Anthropic",
        system: "Vous êtes Ondine, la mascotte d'une petite île posée en haut de l'écran Windows : une goutte de gomme toute ronde, joyeuse, curieuse et un brin espiègle.",
        history: [],
        maxTurns: 20,
        fileTools: true,
        pcTools: true,
        filesFolder: "C:\\Users\\Camille\\Documents\\Ondine",
      };
    case "askclaude.prepare":
      return {
        id: 1,
        name: "Texte copié",
        text: "Ondine est une petite île en haut de l'écran : musique, agenda, notes et agents IA, sans changer de fenêtre.",
        image: null,
        bytes: 112,
        destination: "api.anthropic.com",
      };
    case "askclaude.unprepare":
    case "askclaude.reset":
      return null;
    // Le bouton 🎙️ : la petite scène de la voix (sous-titres, halo, réponse en « plop plip »).
    case "askclaude.listen":
      demoVoice(bus);
      return null;
    case "askclaude.voice_state":
      return { listening: false, discreet: null };
    // Un message qui parle de volume ou d'application : Ondine règle, puis demande avant d'ouvrir.
    case "askclaude.send":
      if (/volume|musique|ouvre|calculatrice|lumi/i.test(String(args.message ?? ""))) {
        return {
          pending: { id: 8, kind: "action", what: "app", value: "Calculatrice" },
          activity: [{ kind: "did", what: "volume", value: "30" }],
        };
      }
      // Un message qui parle de fichiers : Ondine cherche, puis demande l'accord pour en créer un.
      if (/fichier|facture|liste|crée/i.test(String(args.message ?? ""))) {
        return {
          pending: {
            id: 7,
            kind: "create",
            name: "liste-de-courses.md",
            bytes: 118,
            preview: "# Liste de courses\n\n- Pommes\n- Farine\n- Œufs\n- Chocolat noir\n- Lait d'avoine\n\n_Préparée par Ondine 💧_",
            folder: "C:\\Users\\Camille\\Documents\\Ondine",
          },
          activity: [{ kind: "search", query: "courses", count: 2 }],
        };
      }
      return {
        answer: "Avec plaisir ! Ondine, c'est votre bureau en un coup d'œil : la musique, l'agenda, les notes et vos agents IA tiennent dans une petite île, toujours à portée de souris. Une goutte d'organisation, en somme.",
        emotion: "happy",
        model: "claude-sonnet-5-5",
        truncated: false,
        inputTokens: 64,
        outputTokens: 48,
      };
    case "askclaude.confirm":
      if (args.id === 8) {
        return {
          answer: args.ok ? "Voilà : le son est à 30 % et la calculatrice est ouverte. Bons calculs !" : "D'accord, je n'ouvre rien. Le son reste à 30 %.",
          emotion: args.ok ? "happy" : "calm",
          model: "claude-sonnet-5-5",
          truncated: false,
          inputTokens: 380,
          outputTokens: 40,
          activity: [{ kind: "did", what: "volume", value: "30" }, args.ok ? { kind: "did", what: "app", value: "Calculatrice" } : { kind: "refused-act", what: "app", value: "Calculatrice" }],
          cards: [],
        };
      }
      return {
        answer: args.ok
          ? "C'est fait ! Votre liste est rangée dans votre dossier Ondine. J'ai aussi retrouvé celle du mois dernier, au cas où."
          : "Pas de souci, je n'ai rien créé. Dites-moi si vous voulez la changer.",
        emotion: args.ok ? "proud" : "calm",
        model: "claude-sonnet-5-5",
        truncated: false,
        inputTokens: 412,
        outputTokens: 96,
        activity: [{ kind: "search", query: "courses", count: 2 }, args.ok ? { kind: "created", name: "liste-de-courses.md" } : { kind: "refused", name: "liste-de-courses.md" }],
        cards: args.ok
          ? [
              { numero: 3, nom: "liste-de-courses.md", dossier: "~\\Documents\\Ondine", taille: "118 o", cree: true },
              { numero: 1, nom: "Courses septembre.txt", dossier: "~\\Documents", taille: "1 Ko", cree: false },
            ]
          : [],
      };
    case "weather.current":
      // Une fausse météo : un bel après-midi à Lyon.
      return { place: "Lyon", temp: 21.4, min: 12.1, max: 23.6, wind: 9, code: 1, isDay: true, icon: "🌤️", label: "Plutôt dégagé", unit: "c", at: "15:00" };
    case "halos.levels": {
      // Le halo qui suit la voix (visio) : une voix inventée qui monte et descend.
      const t = Date.now() / 1000;
      const v = Math.max(0, 0.08 + 0.3 * Math.sin(t * 5.3) * Math.sin(t * 1.7) + 0.12 * Math.sin(t * 11));
      return { mic: args.mic ? v : null, out: args.out ? v : null };
    }
    case "weekly.peek":
      // « Voir le bilan maintenant » : une belle semaine inventée (« due » reste null : pas de vrai bilan en démo).
      return { pomodoros: 9, focusMinutes: 215, todos: 14, until: "", agents: agentsWeek() };
    default:
      // Toute autre action : on fait comme si c'était fait, sans rien toucher.
      return null;
  }
}

// ── Allumer, éteindre, scènes ────────────────────────────────────────────────

/** Les sujets « …changed » qui font relire leurs données aux modules. */
const REFRESH = ["agenda.changed", "notes.changed", "clipboard.changed", "rules.changed", "remote.changed", "agents.changed", "weather.changed"];

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
    case "whats-new":
      // Le panneau « Quoi de neuf » de la version installée (core/whats-new.ts).
      bus.inject("app.whats-new", null, "demo");
      break;
    case "halos-battery":
      play(bus, HALOS_BATTERY);
      break;
    case "halos-tour":
      play(bus, HALOS_TOUR);
      break;
    case "voice":
      demoVoice(bus);
      break;
    case "mascot-talk":
      talkScene(bus);
      break;
    case "ai-outage": {
      // Claude tombe (Réseau → services IA) : notification, pastille rouge sur l'île, la mascotte grimace.
      const services = DEMO_AI.map((s) => ({ ...s, level: s.id === "claude" ? "down" : "ok", description: s.id === "claude" ? "Elevated errors on Claude.ai" : "", checkedAt: now }));
      bus.inject("nettools.ai-status", { services, change: services[0] }, "demo");
      bus.inject("mascot.emote", { emotion: "worried" }, "demo");
      break;
    }
    case "team-visit":
      // La mascotte d'une collègue traverse l'île (module Équipe).
      bus.inject("team.event", { kind: "visit", from: TEAM_PEERS[0], note: "Le café est prêt !" }, "demo");
      break;
    case "island-dodge":
      // L'île s'écarte de la fenêtre de réglages (forme et peur d'Ondine ; la
      // fenêtre, elle, ne bouge pas dans un navigateur), puis rentre chez elle.
      bus.inject("island.dodge-demo", { edge: "top", align: "end", phase: "flee" }, "demo");
      window.setTimeout(() => bus.inject("island.dodge-demo", { edge: "top", align: "end", phase: "cornered" }, "demo"), 1800);
      window.setTimeout(() => bus.inject("island.dodge-demo", { edge: "top", align: "center", phase: "home" }, "demo"), 4200);
      break;
  }
}

// ── Les halos de l'île (src/island/halo.ts) : des moments qui défilent ────────

type Step = [ms: number, topic: string, payload: unknown];

/** Les halos de batterie : branché, chargée, débranché, faible, critique, branché (soulagement). */
const HALOS_BATTERY: Step[] = [
  [0, "system.battery-plug", { plugged: true, percent: 56, charging: true }],
  [5000, "system.battery-full", {}],
  [9000, "system.battery-plug", { plugged: false, percent: 82, charging: false }],
  [12500, "system.battery-low", { percent: 18 }],
  [20000, "system.battery-critical", { percent: 8 }],
  [28000, "system.battery-plug", { plugged: true, percent: 9, charging: true }],
];

/** Les autres halos, l'un après l'autre. */
const HALOS_TOUR: Step[] = [
  [0, "halos.wake", { secs: 3600 }],
  [5500, "controls.usb-added", { root: "E:\\", letter: "E:", label: "CLÉ", removable: true }],
  [8500, "shelf.downloaded", { name: "Facture-octobre.pdf" }],
  [12000, "system.disk-low", { mount: "C:\\", freePct: 3, freeGb: 14.2 }],
  [18500, "halos.wifi", { quality: 22 }],
  [23500, "weather.updated", { icon: "⛈️", temp: "16°C", label: "Orage", place: "Lyon", detail: "" }],
  [32000, "island.halo", { action: "think", on: true }],
  [37000, "island.halo", { action: "think", on: false }],
  [37500, "agents.event", { at: 0, source: "claude-code", kind: "waiting", title: "Claude attend votre permission", body: "npm run build", project: "site-ondine" }],
  [42000, "agents.event", { at: 0, source: "claude-code", kind: "done", title: "Claude a fini", body: "Le site est à jour", project: "site-ondine" }],
  [46500, "halos.lock-key", { key: "caps", on: true }],
  [48500, "halos.clip", { action: "copy", text: "Bonjour tout le monde" }],
  [50500, "halos.volume", { volume: 45, muted: false }],
  [51200, "halos.volume", { volume: 60, muted: false }],
  [53000, "controls.media-use", { mic: ["Teams"], cam: [] }],
  [60000, "controls.media-use", { mic: [], cam: [] }],
];

function play(bus: Bus, steps: Step[]) {
  for (const [ms, topic, payload] of steps) window.setTimeout(() => demoOn() && bus.inject(topic, payload, "demo"), ms);
}

/**
 * Parler à Ondine à voix haute, pour la vidéo : l'écoute s'ouvre, les mots
 * s'écrivent en direct pendant que le niveau du micro bouge (le halo), puis
 * la question part (réponse inventée de `askclaude.send`).
 */
function demoVoice(bus: Bus) {
  const words = ["Dis", "Ondine,", "c'est", "quoi", "cette", "petite", "île", "en", "haut", "de", "l'écran", "?"];
  bus.inject("voice.listening", { on: true, look: false }, "askclaude");
  bus.inject("askclaude.voice", { kind: "open", look: false, hold: false }, "askclaude");
  const start = Date.now();
  const level = window.setInterval(() => {
    const t = (Date.now() - start) / 1000;
    bus.inject("voice.level", { level: Math.round((0.35 + 0.3 * Math.sin(t * 9) * Math.sin(t * 2.3)) * 100) / 100 }, "askclaude");
  }, 80);
  words.forEach((_, i) => {
    window.setTimeout(() => bus.inject("askclaude.voice", { kind: "partial", text: words.slice(0, i + 1).join(" ").replace(" ?", " ?") }, "askclaude"), 500 + i * 260);
  });
  window.setTimeout(() => {
    window.clearInterval(level);
    bus.inject("voice.level", { level: 0 }, "askclaude");
    bus.inject("voice.listening", { on: false, look: false }, "askclaude");
    bus.inject("askclaude.voice", { kind: "final", text: "Dis Ondine, c'est quoi cette petite île en haut de l'écran ?", look: false }, "askclaude");
  }, 500 + words.length * 260 + 900);
}

/**
 * La mascotte qui parle (1.2.2) : comme le ferait la voix, « Bonjour ! Ça va ? »
 * syllabe par syllabe (mascot.talk, la bouche suit ; les sourcils montent sur
 * « ! » et « ? »), puis les lunettes de soleil.
 */
function talkScene(bus: Bus) {
  const syllables: [number, string?][] = [[0.9], [0.5], [0.8, "!"], [0], [0.7], [0.4], [0.9, "?"], [0]];
  bus.inject("mascot.emote", { emotion: "talk" }, "demo");
  syllables.forEach(([open, mark], i) => setTimeout(() => bus.inject("mascot.talk", { open, mark }, "demo"), 150 + i * 190));
  setTimeout(() => bus.inject("mascot.emote", { emotion: "sunglasses" }, "demo"), 2600);
}

// ── Équipe ───────────────────────────────────────────────────────────────────

const TEAM_PEERS = [
  { id: "a1b2c3d4e5f60718", name: "Léa", color: "#ff8f78", mascot: "goutte-gomme", mine: false, it: false },
  { id: "0f1e2d3c4b5a6978", name: "Karim", color: "#62e6c4", mascot: "goutte-gomme", mine: false, it: true },
  { id: "1122334455667788", name: "Portable", color: "#b98cff", mascot: "goutte-gomme", mine: true, it: false },
];

function teamDemo() {
  const live = [
    { status: "available", statusText: "", battery: null },
    { status: "meeting", statusText: "Point hebdo", battery: null },
    { status: "focus", statusText: "", battery: { percent: 64, charging: false } },
  ];
  return {
    me: { id: "9988776655443322", fingerprint: "9988 7766 5544 3322", name: "Simon", ip: "192.168.1.20", status: "available", statusText: "", auto: true, visible: true },
    peers: TEAM_PEERS.map((p, i) => ({ ...p, ...live[i], addr: `192.168.1.${30 + i}`, online: true, version: "1.2.2", visits: true, fingerprint: p.id.replace(/(.{4})(?!$)/g, "$1 ") })),
    nearby: [{ id: "5566778899aabbcc", name: "Camille", color: "#ffd24a", addr: "192.168.1.44" }],
    pending: [{ id: 1, peer: TEAM_PEERS[0].id, kind: "file", text: "", name: "Planning-octobre.xlsx", size: 48_640, folder: false, at: Date.now() - MIN }],
    code: null,
    polls: [],
  };
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
