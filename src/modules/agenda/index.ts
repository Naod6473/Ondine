// Module « Agenda » : les prochains rendez-vous de plusieurs calendriers
// (fichiers .ics ou liens iCal), chacun avec sa couleur.
//
// Le Rust (src-tauri/src/modules/agenda.rs) lit les calendriers, déroule les
// répétitions, fusionne et trie les rendez-vous, et prévient par
// "agenda.changed" ; on redemande alors la liste avec la commande "upcoming".
// Un peu avant un rendez-vous, il publie "agenda.reminder" : l'île s'ouvre en alerte.
// Deux minutes avant une réunion en ligne, "agenda.join" : « Réunion dans
// 2 min » avec « Rejoindre » (lien ouvert, musique en pause, et un mot si le
// micro est coupé, avec « Rétablir le micro »).
//
// Un clic sur un rendez-vous qui a un lien (réunion Teams, Meet, Zoom, page
// web) l'ouvre : commande "open". On ne connaît que la SORTE de lien ;
// l'adresse reste dans le Rust, qui n'ouvre que du http(s).
//
// La pilule de l'île montre le rendez-vous quand il approche (réglage
// « … quand il commence dans moins de »), puis pendant qu'il a lieu.

import manifest from "./manifest.json";
import { Bridge } from "../../core/bridge";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";
import { icon } from "../../island/icon";
import { reducedMotion } from "../../island/tab-pill";
import { pacedInterval, setText } from "../../core/perf";

interface Meeting {
  key: string;
  title: string;
  location: string;
  /** Millisecondes depuis 1970. */
  start: number;
  end: number;
  allDay: boolean;
  /** Le calendrier d'où il vient (identifiant, nom, couleur « #4fb8ff »). */
  calendar?: string;
  calendarName?: string;
  color?: string;
  /** La sorte de lien à ouvrir d'un clic, ou null s'il n'y en a pas. */
  link?: LinkKind | null;
}

type LinkKind = "teams" | "meet" | "zoom" | "webex" | "web";

interface CalendarInfo {
  id: string;
  name: string;
  color: string;
  kind: "file" | "link";
}

interface Listing {
  events: Meeting[];
  errors: string[];
  /** Les calendriers des réglages (lus ou non). */
  calendars: CalendarInfo[];
  /** Combien d'événements ont été lus en tout, et la date du plus récent. */
  read?: number;
  latest?: string | null;
}

/** Le texte du bouton / de l'infobulle d'un lien. */
const LINK_LABELS: Record<LinkKind, string> = {
  teams: "Rejoindre la réunion Teams",
  meet: "Rejoindre la réunion Google Meet",
  zoom: "Rejoindre la réunion Zoom",
  webex: "Rejoindre la réunion Webex",
  web: "Ouvrir le lien du rendez-vous",
};

/** « 2 calendriers · 245 événements lus (le plus récent : 12/03/2026) · 0 à venir » */
function sourcesLine(calendars: number, read: number | undefined, latest: string | null | undefined, upcoming: number): string {
  const parts: string[] = [];
  if (calendars) parts.push(calendars > 1 ? `${calendars} calendriers` : "1 calendrier");
  if (read !== undefined) parts.push(`${read} événement${read > 1 ? "s" : ""} lu${read > 1 ? "s" : ""}${latest ? ` (le plus récent : ${latest})` : ""}`);
  parts.push(`${upcoming} à venir`);
  return parts.join(" · ");
}

let listing: Listing = { events: [], errors: [], calendars: [] };
const redraws = new Set<() => void>();
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const MINUTE = 60_000;

/**
 * Redemande la liste. "reload" relit tout (bouton « Relire ») ; avec
 * `{ force: false }`, seulement ce qui a changé dans les réglages.
 */
async function refresh(api: ModuleApi, command: "upcoming" | "reload" = "upcoming", args?: { force: boolean }) {
  try {
    const answer = await api.invoke<Listing>(command, args);
    listing = { ...answer, calendars: answer.calendars ?? [] };
  } catch (err) {
    if (command === "reload") {
      api.notify({ title: "Agenda", body: errorText(err), icon: "⚠️", priority: "low", key: "agenda-error" });
    }
    return; // hors de l'appli (navigateur)
  }
  for (const r of redraws) r();
  api.refreshCompact();
}

// ── Petites fonctions d'affichage ────────────────────────────────────────────

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** Minuit du jour de `ms`. */
function dayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** « Aujourd'hui », « Demain », sinon « mercredi 8 octobre ». */
function dayLabel(ms: number): string {
  const days = Math.round((dayStart(ms) - dayStart(Date.now())) / 86_400_000);
  if (days <= 0) return "Aujourd'hui";
  if (days === 1) return "Demain";
  const text = new Date(ms).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** « 9:30 – 10:30 », ou « Toute la journée ». */
function timeRange(m: Meeting): string {
  if (m.allDay) return "Toute la journée";
  return m.end > m.start ? `${hhmm(m.start)} – ${hhmm(m.end)}` : hhmm(m.start);
}

/** En cours ? (un rendez-vous sans durée l'est pendant 5 minutes) */
function ongoing(m: Meeting, now = Date.now()): boolean {
  const end = m.end > m.start ? m.end : m.start + 5 * MINUTE;
  return m.start <= now && now < end;
}

/** « dans 12 min », « dans 2 h 05 », « en cours », « demain à 9:30 »… */
function relative(m: Meeting, now = Date.now()): string {
  if (ongoing(m, now)) return m.allDay ? "aujourd'hui" : `en cours, jusqu'à ${hhmm(m.end > m.start ? m.end : m.start + 5 * MINUTE)}`;
  const min = Math.ceil((m.start - now) / MINUTE);
  if (min < 60) return `dans ${min} min`;
  if (dayStart(m.start) === dayStart(now)) {
    const h = Math.floor(min / 60);
    const rest = min % 60;
    return rest ? `dans ${h} h ${String(rest).padStart(2, "0")}` : `dans ${h} h`;
  }
  return m.allDay ? dayLabel(m.start).toLowerCase() : `${dayLabel(m.start).toLowerCase()} à ${hhmm(m.start)}`;
}

/** Ouvre le lien d'un rendez-vous (le Rust le retrouve et vérifie qu'il est http(s)). */
async function openLink(api: ModuleApi, m: Meeting) {
  if (!m.link) return;
  try {
    await api.invoke("open", { calendar: m.calendar ?? "", key: m.key });
  } catch (err) {
    api.notify({ title: "Agenda", body: errorText(err), icon: "⚠️", priority: "low", key: "agenda-error" });
  }
}

/**
 * « Rejoindre » une réunion en ligne : son lien s'ouvre comme d'un clic, le
 * Rust demande au module Musique de mettre en pause ce qui joue, et si le
 * micro est coupé (le Rust le lit au moment du clic), on le dit, avec de quoi
 * le rétablir.
 */
async function join(api: ModuleApi, m: Meeting) {
  let micMuted = false;
  try {
    const r = await api.invoke<{ micMuted?: boolean } | null>("join", { calendar: m.calendar ?? "", key: m.key });
    micMuted = r?.micMuted === true;
  } catch (err) {
    api.notify({ title: "Agenda", body: errorText(err), icon: "⚠️", priority: "low", key: "agenda-error" });
    return;
  }
  if (!micMuted) return;
  api.notify({
    title: "Votre micro est coupé",
    body: m.title,
    icon: "🔇",
    priority: "high",
    key: `agenda-${m.key}`,
    durationMs: 15_000,
    // Le module Contrôles rétablit le micro et confirme (« Micro rétabli »).
    actions: [{ label: "Rétablir le micro", run: () => api.emit("controls.mic-set", { muted: false }) }],
  });
}

/** Le bouton d'un rendez-vous dans une notification : « Rejoindre » une réunion, « Ouvrir » un lien web. */
function linkAction(api: ModuleApi, m: Meeting) {
  if (!m.link) return undefined;
  return m.link === "web" ? [{ label: "Ouvrir", run: () => void openLink(api, m) }] : [{ label: "Rejoindre", run: () => void join(api, m) }];
}

/** La pastille de couleur du calendrier. */
function dot(m: Meeting): HTMLElement {
  const d = el("span", { class: "agenda-dot", title: m.calendarName ?? "", "aria-hidden": "true" });
  if (m.color) d.style.setProperty("--cal", m.color);
  return d;
}

/**
 * Rend un élément cliquable s'il a un lien : clic, ou Entrée / Espace au
 * clavier. Sans lien, il ne se passe rien.
 */
function clickable(node: HTMLElement, api: ModuleApi, m: Meeting): HTMLElement {
  if (!m.link) return node;
  node.classList.add("has-link");
  node.setAttribute("role", "button");
  node.setAttribute("tabindex", "0");
  node.title = LINK_LABELS[m.link];
  node.addEventListener("click", api.handler(() => openLink(api, m)));
  node.addEventListener(
    "keydown",
    api.handler((e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      return openLink(api, m);
    }),
  );
  return node;
}

/** Le rendez-vous à montrer dans la pilule : en cours, ou qui commence bientôt. */
function soon(api: ModuleApi): Meeting | null {
  const s = api.settings();
  if (!s.showCompact) return null;
  const within = Number(s.compactWithinMin) * MINUTE;
  const now = Date.now();
  return listing.events.find((m) => !m.allDay && (ongoing(m, now) || (m.start > now && m.start - now <= within))) ?? null;
}

// ── Le module ────────────────────────────────────────────────────────────────

export const agenda: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    api.on("agenda.changed", () => void refresh(api));
    api.on("agenda.reminder", (msg) => {
      const { key } = (msg.payload ?? {}) as { key?: string };
      const m = listing.events.find((e) => e.key === key);
      if (!m) return void refresh(api);
      const min = Math.max(0, Math.ceil((m.start - Date.now()) / MINUTE));
      api.notify({
        title: min > 0 ? `Dans ${min} min : ${m.title}` : `Maintenant : ${m.title}`,
        body: [timeRange(m), m.location].filter(Boolean).join(" · "),
        icon: "📅",
        priority: "high",
        key: `agenda-${m.key}`,
        actions: linkAction(api, m),
      });
    });
    // Une réunion en ligne commence dans 2 min : on propose de la rejoindre
    // (une seule fois par rendez-vous, décidé par le Rust). Même clé que le
    // rappel : elle le remplace s'il est encore affiché.
    api.on("agenda.join", (msg) => {
      const { key } = (msg.payload ?? {}) as { key?: string };
      void (async () => {
        let m = listing.events.find((e) => e.key === key);
        if (!m) {
          await refresh(api); // la liste n'était peut-être pas encore à jour
          m = listing.events.find((e) => e.key === key);
        }
        if (!m?.link) return;
        const meeting = m;
        const left = meeting.start - Date.now();
        const min = Math.max(0, Math.ceil(left / MINUTE));
        api.notify({
          title: min > 0 ? `Réunion dans ${min} min : ${meeting.title}` : `La réunion commence : ${meeting.title}`,
          body: [timeRange(meeting), meeting.location].filter(Boolean).join(" · "),
          icon: "🎥",
          priority: "high",
          key: `agenda-${meeting.key}`,
          // Visible jusqu'au début de la réunion (30 s au moins, 5 min au plus).
          durationMs: Math.min(5 * MINUTE, Math.max(30_000, left + MINUTE)),
          actions: linkAction(api, meeting),
        });
      })();
    });
    // Calendriers changés dans les réglages : on relit ce qui a changé, tout de suite.
    const off = api.onSettingsChange(() => void refresh(api, "reload", { force: false }));

    // Le récap du soir : à l'heure choisie, une fois par jour, les rendez-vous de
    // demain (et Ondine qui bâille). Rien si l'heure vaut 0.
    let recapDay = "";
    const recap = window.setInterval(() => {
      const hour = Number(api.settings().recapHour ?? 18);
      const now = new Date();
      const today = now.toDateString();
      if (!hour || now.getHours() !== hour || recapDay === today) return;
      recapDay = today;
      const tomorrow = dayStart(Date.now()) + 24 * 60 * MINUTE;
      const list = listing.events.filter((e) => e.start >= tomorrow && e.start < tomorrow + 24 * 60 * MINUTE);
      const first = list.find((e) => !e.allDay) ?? list[0];
      api.emit("mascot.emote", { emotion: "sleep" });
      api.notify({
        title: list.length ? `Demain : ${list.length} rendez-vous` : "Demain : aucun rendez-vous",
        body: first ? `${first.allDay ? "Toute la journée" : `Le premier à ${hhmm(first.start)}`} : ${first.title}` : "Bonne soirée !",
        icon: "🌙",
        priority: "normal",
        key: "agenda-recap",
        durationMs: 15_000,
        actions: list.length ? [{ label: "Voir", run: () => api.openIsland("agenda") }] : undefined,
      });
    }, MINUTE);

    // La pilule dépend de l'heure : on vérifie régulièrement si elle doit changer.
    // Toutes les 10 s (30 s en économie d'énergie : "agendaPill" de src/core/perf.ts).
    let wasSoon: string | null = null;
    const stopPill = pacedInterval(() => {
      const key = soon(api)?.key ?? null;
      if (key !== wasSoon) {
        wasSoon = key;
        api.refreshCompact();
      }
    }, "agendaPill");

    void refresh(api);
    return () => {
      off();
      stopPill();
      window.clearInterval(recap);
    };
  },

  views: {
    compactWhen: (api) => soon(api) !== null,

    compact(root, api) {
      const text = el("span", { class: "timer-compact-text" });
      const bar = el("span", { class: "timer-compact-bar agenda-compact-bar" }, el("i"));
      root.append(el("div", { class: "timer-compact" }, text, bar));
      const draw = () => {
        const m = soon(api);
        if (!m) return;
        // L'heure d'abord : si le titre est long, c'est lui qui est coupé.
        const when = ongoing(m) ? "En cours" : relative(m).replace(/^./, (c) => c.toUpperCase());
        setText(text, `📅 ${when} · ${m.title}`);
        // Pendant le rendez-vous, la barre se remplit ; avant, elle est cachée.
        const live = ongoing(m) && m.end > m.start;
        bar.style.display = live ? "" : "none";
        if (live) (bar.firstChild as HTMLElement).style.transform = `scaleX(${Math.min(1, (Date.now() - m.start) / (m.end - m.start))})`;
      };
      draw();
      // Chaque seconde (5 s en économie d'énergie : le texte est à la minute).
      return pacedInterval(draw, "agendaCompact", true);
    },

    expanded(root, api) {
      const body = el("div", { class: "agenda" });
      root.append(body);
      let first = true;

      const draw = () => {
        const { events, errors, calendars, read, latest } = listing;
        body.replaceChildren();

        if (!calendars.length && !errors.length) {
          body.append(
            el(
              "div",
              { class: "agenda-empty" },
              el("div", { class: "agenda-empty-icon" }, icon("📅")),
              el("b", {}, "Aucun agenda pour l'instant"),
              el(
                "p",
                { class: "muted" },
                "Dans les réglages du module Agenda, ajoutez l'adresse secrète iCal de votre agenda en ligne (Google Agenda, Outlook…), toujours à jour, ou un fichier .ics exporté. Vous pouvez en mettre plusieurs, chacun avec sa couleur.",
              ),
              el("button", { class: "btn primary", onclick: api.handler(() => Bridge.openSettingsWindow()) }, "⚙ Ouvrir les réglages"),
            ),
          );
          return;
        }

        for (const e of errors) body.append(el("p", { class: "agenda-error" }, `⚠️ ${e}`));

        if (!events.length) {
          body.append(el("p", { class: "muted agenda-none" }, `Rien de prévu dans les ${Number(api.settings().horizonDays ?? 60)} prochains jours. 🌴`));
        } else {
          // La carte du prochain rendez-vous (ou de celui en cours).
          const next = events.find((m) => !m.allDay) ?? events[0];
          body.append(
            clickable(
              el(
                "div",
                { class: `agenda-next${ongoing(next) ? " live" : ""}` },
                el("span", { class: "agenda-when" }, relative(next)),
                el("b", { class: "agenda-title" }, dot(next), next.title),
                el("span", { class: "muted" }, [dayLabel(next.start), timeRange(next), next.location].filter(Boolean).join(" · ")),
                next.link ? el("span", { class: "agenda-join" }, next.link === "web" ? "🔗 " : "🎥 ", LINK_LABELS[next.link]) : null,
              ),
              api,
              next,
            ),
          );

          // Les suivants, rangés par jour.
          const list = el("div", { class: "agenda-list" });
          let day = -1;
          for (const m of events) {
            if (m === next) continue;
            const d = dayStart(m.start);
            if (d !== day) {
              day = d;
              list.append(el("div", { class: "agenda-day" }, dayLabel(m.start)));
            }
            list.append(
              clickable(
                el(
                  "div",
                  { class: `agenda-row${ongoing(m) ? " live" : ""}` },
                  dot(m),
                  el("span", { class: "agenda-time" }, m.allDay ? "Journée" : hhmm(m.start)),
                  el("span", { class: "agenda-row-title" }, m.title),
                  m.location ? el("span", { class: "muted agenda-loc" }, m.location) : null,
                  m.link ? el("span", { class: "agenda-link-icon", "aria-hidden": "true" }, m.link === "web" ? "🔗" : "🎥") : null,
                ),
                api,
                m,
              ),
            );
          }
          if (list.childElementCount) body.append(list);
        }

        body.append(
          el(
            "div",
            { class: "btn-row agenda-foot" },
            el("span", { class: "muted" }, sourcesLine(calendars.length, read, latest, events.length)),
            el("button", { class: "btn small", title: "Relire tous les calendriers", onclick: api.handler(() => refresh(api, "reload", { force: true })) }, "🔄 Relire"),
          ),
        );

        // À l'ouverture, les lignes arrivent l'une après l'autre (vite).
        if (first && !reducedMotion()) {
          [...body.querySelectorAll<HTMLElement>(".agenda-next, .agenda-day, .agenda-row")].slice(0, 12).forEach((node, i) =>
            node.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], {
              duration: 320,
              delay: i * 22,
              easing: EASE,
              fill: "backwards",
            }),
          );
        }
        first = false;
      };

      draw();
      redraws.add(draw);
      // « dans 12 min » doit avancer tout seul.
      const stopList = pacedInterval(draw, "agendaList", true);
      return () => {
        redraws.delete(draw);
        stopList();
      };
    },
  },
};
