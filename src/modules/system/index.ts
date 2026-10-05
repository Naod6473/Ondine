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

const REFRESH_MS = 2000;

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

export const system: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
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
      root.append(
        el("div", { class: "sys" }, el("div", { class: "sys-top" }, cpu.node, mem.node, disk.node, el("div", { class: "sys-side" }, facts, copy)), details),
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
        facts.replaceChildren(
          line("PC", s.host || "?", `${s.domain}\\${s.user}`),
          line("Windows", s.os || "?", s.osBuild ? `build ${s.osBuild}` : undefined),
          line("Allumé depuis", uptimeText(s.uptimeSecs)),
          line("IP", ip),
          bat ? line("Batterie", bat) : "",
        );

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
      const timer = window.setInterval(() => void refresh(), REFRESH_MS);
      return () => {
        alive = false;
        window.clearInterval(timer);
      };
    },
  },
};
