// Module « Agenda » : le prochain rendez-vous, lu dans des fichiers .ics.
//
// Le Rust (src-tauri/src/modules/agenda.rs) lit les fichiers, déroule les
// répétitions et prévient par "agenda.changed" ; on redemande alors la liste
// avec la commande "upcoming". Un peu avant un rendez-vous, il publie
// "agenda.reminder" : l'île s'ouvre en alerte.
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

interface Meeting {
  key: string;
  title: string;
  location: string;
  /** Millisecondes depuis 1970. */
  start: number;
  end: number;
  allDay: boolean;
}

interface Listing {
  events: Meeting[];
  errors: string[];
  /** Nombre de fichiers lus avec succès. */
  files: number;
  /** Un agenda en ligne (adresse iCal) est branché. */
  online?: boolean;
  /** Combien d'événements ont été lus en tout, et la date du plus récent. */
  read?: number;
  latest?: string | null;
}

/** « 1 fichier · agenda en ligne · 245 événements lus (le plus récent : 12/03/2026) · 0 à venir » */
function sourcesLine(files: number, online: boolean | undefined, read: number | undefined, latest: string | null | undefined, upcoming: number): string {
  const parts: string[] = [];
  if (files) parts.push(files > 1 ? `${files} fichiers` : "1 fichier");
  if (online) parts.push("agenda en ligne");
  if (read !== undefined) parts.push(`${read} événement${read > 1 ? "s" : ""} lu${read > 1 ? "s" : ""}${latest ? ` (le plus récent : ${latest})` : ""}`);
  parts.push(`${upcoming} à venir`);
  return parts.join(" · ");
}

let listing: Listing = { events: [], errors: [], files: 0 };
const redraws = new Set<() => void>();
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const MINUTE = 60_000;

async function refresh(api: ModuleApi, command: "upcoming" | "reload" = "upcoming") {
  try {
    listing = await api.invoke<Listing>(command);
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
      });
    });
    // Fichiers changés dans les réglages : on relit tout de suite.
    const off = api.onSettingsChange(() => void refresh(api, "reload"));

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
    let wasSoon: string | null = null;
    const interval = window.setInterval(() => {
      const key = soon(api)?.key ?? null;
      if (key !== wasSoon) {
        wasSoon = key;
        api.refreshCompact();
      }
    }, 10_000);

    void refresh(api);
    return () => {
      off();
      window.clearInterval(interval);
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
        text.textContent = `📅 ${when} · ${m.title}`;
        // Pendant le rendez-vous, la barre se remplit ; avant, elle est cachée.
        const live = ongoing(m) && m.end > m.start;
        bar.style.display = live ? "" : "none";
        if (live) (bar.firstChild as HTMLElement).style.transform = `scaleX(${Math.min(1, (Date.now() - m.start) / (m.end - m.start))})`;
      };
      draw();
      const interval = window.setInterval(draw, 1000);
      return () => window.clearInterval(interval);
    },

    expanded(root, api) {
      const body = el("div", { class: "agenda" });
      root.append(body);
      let first = true;

      const draw = () => {
        const { events, errors, files, online, read, latest } = listing;
        body.replaceChildren();

        if (!files && !online && !errors.length) {
          body.append(
            el(
              "div",
              { class: "agenda-empty" },
              el("div", { class: "agenda-empty-icon" }, icon("📅")),
              el("b", {}, "Aucun agenda pour l'instant"),
              el(
                "p",
                { class: "muted" },
                "Google Agenda : colle son adresse secrète iCal dans Réglages → Identifiants (toujours à jour). Sinon, exporte ton agenda en .ics et choisis le fichier dans les réglages du module Agenda.",
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
            el(
              "div",
              { class: `agenda-next${ongoing(next) ? " live" : ""}` },
              el("span", { class: "agenda-when" }, relative(next)),
              el("b", { class: "agenda-title" }, next.title),
              el("span", { class: "muted" }, [dayLabel(next.start), timeRange(next), next.location].filter(Boolean).join(" · ")),
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
              el(
                "div",
                { class: `agenda-row${ongoing(m) ? " live" : ""}` },
                el("span", { class: "agenda-time" }, m.allDay ? "Journée" : hhmm(m.start)),
                el("span", { class: "agenda-row-title" }, m.title),
                m.location ? el("span", { class: "muted agenda-loc" }, m.location) : null,
              ),
            );
          }
          if (list.childElementCount) body.append(list);
        }

        body.append(
          el(
            "div",
            { class: "btn-row agenda-foot" },
            el("span", { class: "muted" }, sourcesLine(files, online, read, latest, events.length)),
            el("button", { class: "btn small", title: "Relire les fichiers .ics", onclick: api.handler(() => refresh(api, "reload")) }, "🔄 Relire"),
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
      const interval = window.setInterval(draw, 30_000);
      return () => {
        redraws.delete(draw);
        window.clearInterval(interval);
      };
    },
  },
};
