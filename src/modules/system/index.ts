// Module « Système » : l'état du PC d'un coup d'œil (phase Outils IT).
//
// Le Rust (src-tauri/src/modules/system.rs) mesure tout ; ici on affiche :
// trois jauges (processeur, mémoire, disque C:), les infos utiles au support
// (nom du PC, Windows, adresse IP…), puis le détail des disques et des cartes
// réseau. Tant que l'onglet est ouvert, on redemande les mesures toutes les 2 s.

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";
import { pacedInterval } from "../../core/perf";

interface Disk {
  mount: string;
  label: string;
  totalGb: number;
  freeGb: number;
  removable: boolean;
}

interface Snapshot {
  host: string;
  user: string;
  domain: string;
  os: string;
  osBuild: string;
  uptimeSecs: number;
  cpu: { brand: string; cores: number; usage: number };
  mem: { totalGb: number; usedGb: number };
  disks: Disk[];
  net: { name: string; ips: string[]; mac: string }[];
  battery: { percent: number | null; charging: boolean; plugged: boolean } | null;
}

// L'onglet se rafraîchit toutes les 2 s (1 s en haute, 5 s en éco) : "systemTab" de src/core/perf.ts.

/** La météo du module Météo (sujet `weather.updated`), s'il est allumé. */
interface WeatherLine {
  icon: string;
  temp: string;
  label: string;
  place: string;
  detail: string;
}
let weather: WeatherLine | null = null;

/** « 3 j 4 h », « 5 h 12 min », « 7 min ». */
export function uptimeText(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return d > 0 ? `${d} j ${h} h` : h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** 0 à 100 → « ok », « warn » ou « bad » (couleur de la jauge). */
function level(pct: number): string {
  return pct >= 90 ? "bad" : pct >= 75 ? "warn" : "ok";
}

const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

/** Une jauge ronde : le pourcentage glisse en douceur d'une mesure à l'autre (voir island.css). */
function gauge(label: string, sub: string) {
  const value = el("b", {}, "–");
  const caption = el("small", { class: "muted" }, sub);
  // L'anneau est « évidé » par un masque CSS : le chiffre est posé à côté, par-dessus.
  const ring = el("div", { class: "sys-ring" });
  const node = el("div", { class: "sys-gauge" }, el("div", { class: "sys-dial" }, ring, value), el("span", {}, label), caption);
  return {
    node,
    set(pct: number, text: string, subText: string) {
      ring.style.setProperty("--p", String(Math.max(0, Math.min(100, pct))));
      ring.dataset.level = level(pct);
      value.textContent = text;
      caption.textContent = subText;
    },
  };
}

function line(label: string, value: string, title?: string) {
  return el("div", { class: "sys-line", title: title ?? value }, el("span", { class: "muted" }, label), el("span", {}, value));
}

/** « Météo  🌤️ 21°C · Plutôt dégagé · Lyon » (le détail au survol). */
function weatherLine(w: WeatherLine) {
  return el(
    "div",
    { class: "sys-line", title: w.detail },
    el("span", { class: "muted" }, "Météo"),
    el("span", {}, `${w.icon} ${w.temp} · `, el("span", {}, w.label), " · ", el("span", { "data-no-i18n": true }, w.place)),
  );
}

export const system: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    // La météo arrive par le bus (les modules ne se parlent que comme ça).
    api.on("weather.updated", (msg) => {
      weather = (msg.payload as WeatherLine | null) ?? null;
    });
    api.on("system.disk-low", (msg) => {
      const p = (msg.payload ?? {}) as { mount?: string; freePct?: number; freeGb?: number };
      api.notify({
        title: `Disque ${p.mount ?? ""} presque plein`,
        body: `Il reste ${fmt(p.freeGb ?? 0)} Go (${p.freePct ?? 0} %).`,
        icon: "💽",
        priority: "normal",
        key: `disk-low-${p.mount}`,
      });
    });
    api.on("system.battery-low", (msg) => {
      const p = (msg.payload ?? {}) as { percent?: number };
      api.notify({ title: "Batterie faible", body: `Plus que ${p.percent ?? "?"} % : pense à brancher le chargeur.`, icon: "🪫", priority: "normal", key: "battery" });
    });
    api.on("system.battery-full", () => {
      api.notify({ title: "Batterie chargée", body: "Tu peux débrancher le chargeur.", icon: "🔋", priority: "low", key: "battery" });
    });
  },

  views: {
    expanded(root, api: ModuleApi) {
      const cpu = gauge("Processeur", "");
      const mem = gauge("Mémoire", "");
      const disk = gauge("Disque C:", "");
      const facts = el("div", { class: "sys-facts" });
      const copy = el(
        "button",
        {
          class: "btn small",
          title: "Nom du PC, Windows, IP, MAC, mémoire, disques… à coller dans un ticket",
          onclick: api.handler(async () => {
            try {
              await api.invoke("copy_support");
              api.notify({ title: "Infos copiées pour le support", icon: "📋", priority: "low", key: "system-copied" });
            } catch (err) {
              api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: "system-error" });
            }
          }),
        },
        "📋 Copier pour le support",
      );
      const details = el("div", { class: "sys-details" });
      // « Préparer un ticket » : le formulaire prend la place du détail.
      let ticketOpen = false;
      // Ce qui est affiché (en texte), pour ne pas tout reconstruire toutes les
      // 2 s quand rien n'a changé (les disques et le réseau bougent rarement).
      let shownFacts = "";
      let shownDetails = "";
      const ticketForm = () => {
        shownDetails = ""; // à la fermeture du formulaire, le détail revient
        const text = el("textarea", { class: "clip-input sys-ticket-text", rows: 4, maxlength: 5000, placeholder: "Que se passe-t-il ? Depuis quand ? Message d'erreur…" }) as HTMLTextAreaElement;
        const withImage = el("input", { type: "checkbox" }) as HTMLInputElement;
        const go = el(
          "button",
          {
            class: "btn small primary",
            onclick: api.handler(async () => {
              try {
                await api.invoke("ticket", { description: text.value, withImage: withImage.checked });
                api.notify({ title: "Ticket prêt", body: "Le dossier est ouvert, et le texte est copié : colle-le dans ta demande.", icon: "🎫", priority: "low", key: "system-ticket" });
                ticketOpen = false;
                void refresh();
              } catch (err) {
                api.notify({ title: errorText(err), icon: "⚠️", priority: "normal", key: "system-error" });
              }
            }),
          },
          "Préparer",
        );
        const cancel = el("button", { class: "btn small", onclick: () => ((ticketOpen = false), void refresh()) }, "Annuler");
        details.replaceChildren(
          el(
            "div",
            { class: "sys-ticket" },
            el("div", { class: "sys-title muted" }, "Préparer un ticket"),
            text,
            el("label", { class: "pw-check" }, withImage, "Joindre l'image copiée (fais d'abord ta capture avec Win+Maj+S)"),
            el("p", { class: "muted tool-note" }, "Un dossier est créé dans Documents\\Ondine\\Tickets avec ta description, les infos du poste et l'image. Rien n'est envoyé."),
            el("div", { class: "btn-row" }, go, cancel),
          ),
        );
        text.focus();
      };
      const ticketBtn = el(
        "button",
        {
          class: "btn small",
          title: "Ta description + les infos du poste (+ une capture) dans un dossier prêt à joindre",
          onclick: () => {
            ticketOpen = true;
            ticketForm();
          },
        },
        "🎫 Préparer un ticket",
      );
      root.append(
        el("div", { class: "sys" }, el("div", { class: "sys-top" }, cpu.node, mem.node, disk.node, el("div", { class: "sys-side" }, facts, el("div", { class: "btn-row" }, copy, ticketBtn))), details),
      );

      let alive = true;
      const draw = (s: Snapshot) => {
        cpu.set(s.cpu.usage, `${Math.round(s.cpu.usage)} %`, `${s.cpu.cores} cœurs`);
        const memPct = s.mem.totalGb ? (s.mem.usedGb / s.mem.totalGb) * 100 : 0;
        mem.set(memPct, `${Math.round(memPct)} %`, `${fmt(s.mem.usedGb)} / ${fmt(s.mem.totalGb)} Go`);
        const c = s.disks.find((d) => /^c:/i.test(d.mount)) ?? s.disks[0];
        if (c) {
          const used = c.totalGb ? ((c.totalGb - c.freeGb) / c.totalGb) * 100 : 0;
          disk.set(used, `${Math.round(used)} %`, `${fmt(c.freeGb)} Go libres`);
        }

        const ip = s.net.flatMap((n) => n.ips.filter((x) => !x.includes(":")).map((x) => `${x} (${n.name})`))[0] ?? "aucune";
        const bat = s.battery
          ? `${s.battery.percent ?? "?"} %${s.battery.charging ? " · en charge" : s.battery.plugged ? " · branché" : ""}`
          : null;
        const factsKey = JSON.stringify([s.host, s.domain, s.user, s.os, s.osBuild, uptimeText(s.uptimeSecs), ip, bat, weather]);
        if (factsKey !== shownFacts) {
          shownFacts = factsKey;
          facts.replaceChildren(
            line("PC", s.host || "?", `${s.domain}\\${s.user}`),
            line("Windows", s.os || "?", s.osBuild ? `build ${s.osBuild}` : undefined),
            line("Allumé depuis", uptimeText(s.uptimeSecs)),
            line("IP", ip),
            bat ? line("Batterie", bat) : "",
            weather ? weatherLine(weather) : "",
          );
        }

        if (ticketOpen) return;
        const detailsKey = JSON.stringify([s.disks, s.net, s.cpu.brand]);
        if (detailsKey === shownDetails) return;
        shownDetails = detailsKey;
        details.replaceChildren(
          el("div", { class: "sys-title muted" }, "Disques"),
          ...s.disks.map((d) => {
            const used = d.totalGb ? ((d.totalGb - d.freeGb) / d.totalGb) * 100 : 0;
            const bar = el("i", {});
            bar.style.width = `${used}%`;
            return el(
              "div",
              { class: "sys-disk", "data-level": level(used) },
              el("span", {}, `${d.removable ? "🔌" : "💽"} ${d.mount}${d.label ? ` ${d.label}` : ""}`),
              el("span", { class: "sys-bar" }, bar),
              el("span", { class: "muted" }, `${fmt(d.freeGb)} Go libres / ${fmt(d.totalGb)}`),
            );
          }),
          el("div", { class: "sys-title muted" }, "Réseau"),
          ...(s.net.length
            ? s.net.map((n) => el("div", { class: "sys-net" }, el("b", {}, n.name), el("span", {}, n.ips.join(" · ")), el("span", { class: "muted" }, `MAC ${n.mac}`)))
            : [el("div", { class: "muted" }, "Aucune carte réseau connectée.")]),
          el("div", { class: "sys-title muted" }, "Processeur"),
          el("div", { class: "muted" }, s.cpu.brand || "?"),
        );
      };

      const refresh = async () => {
        try {
          const s = await api.invoke<Snapshot>("snapshot");
          if (alive) draw(s);
        } catch {
          // hors de l'appli (navigateur) : on garde l'affichage
        }
      };
      void refresh();
      const stopTimer = pacedInterval(() => void refresh(), "systemTab", true);
      return () => {
        alive = false;
        stopTimer();
      };
    },
  },
};
