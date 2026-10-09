// La page « Profils » des réglages : « Travail », « Maison »…
//
// Un profil change d'un coup quelques réglages de l'île : les onglets affichés
// et leur ordre, la couleur, « Toujours en mini ». Il ne retient QUE ce qu'il
// remplace. Activer un profil passe par le Rust (Bridge.profileActivate), qui
// range les réglages actuels et pose ceux du profil : voir
// src-tauri/src/services/profiles.rs. Ici, on ne fait que créer, renommer,
// régler et supprimer les profils.

import { Bridge, IS_TAURI } from "../core/bridge";
import { errorText } from "../core/log";
import { settingsStore } from "../core/settings-store";
import type { Profile, ProfileValues, Profiles, Settings } from "../core/types";
import { el } from "../island/dom";
import { THEMES } from "../island/themes";
import { ALL_MODULES } from "../modules";
import { chip, choice, group, inSub, row, select, toggle, wideRow } from "./controls";

/** Comme dans profiles.rs. */
const MAX_PROFILES = 10;
const DAYS: [number, string, string][] = [
  [1, "L", "Lundi"],
  [2, "M", "Mardi"],
  [3, "M", "Mercredi"],
  [4, "J", "Jeudi"],
  [5, "V", "Vendredi"],
  [6, "S", "Samedi"],
  [7, "D", "Dimanche"],
];

type Save = (change: (s: Settings) => void, redraw?: boolean) => void;

/** Les profils des réglages (une liste vide si le fichier n'en a pas encore). */
function profilesOf(s: Settings): Profiles {
  s.profiles ??= { list: [], active: "", auto: false, base: {} };
  return s.profiles;
}

/** Les onglets affichés en ce moment : id → activé (seulement les modules qui ont un onglet). */
function currentTabs(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const m of ALL_MODULES) if (m.views?.expanded) out[m.manifest.id] = settingsStore.moduleEnabled(m.manifest.id);
  return out;
}

/** Ce que le profil retient des onglets, pris sur les réglages actuels. */
function tabsNow(s: Settings): Pick<ProfileValues, "tabOrder" | "modules"> {
  return { tabOrder: [...(s.island.tabOrder ?? [])], modules: currentTabs() };
}

/** Change le profil `id` ; s'il est actif, ce qu'on lui donne s'applique tout de suite. */
function editProfile(s: Settings, id: string, change: (p: Profile, active: boolean) => void) {
  const all = profilesOf(s);
  const p = all.list.find((x) => x.id === id);
  if (p) change(p, all.active === id);
}

async function activate(id: string) {
  try {
    await Bridge.profileActivate(id);
  } catch (err) {
    if (IS_TAURI) console.warn("[profils] non activé", errorText(err));
  }
}

/** Les sous-menus de la page : « Profil actif », puis un par profil (son nom). */
export function profileSubs(s: Settings): { id: string; label: string; noI18n?: boolean }[] {
  return [{ id: "active", label: "Profil actif" }, ...(s.profiles?.list ?? []).map((p) => ({ id: `p:${p.id}`, label: p.name, noI18n: true }))];
}

/** La page entière. `save` : l'enregistrement de la fenêtre de réglages. */
export function profilesPage(main: HTMLElement, save: Save) {
  const s = settingsStore.current;
  const profiles = s.profiles ?? { list: [], active: "", auto: false, base: {} };
  const active = profiles.list.find((p) => p.id === profiles.active);

  // ── Le profil actif ──
  const options: [string, string][] = [["", "Aucun"], ...profiles.list.map((p): [string, string] => [p.id, p.name])];
  main.append(
    inSub("active", group(
      "Profil actif",
      [
        row(
          "Profil actif",
          profiles.list.length ? choice(profiles.active, options, (v) => void activate(v)) : chip("Aucun profil"),
          active ? `« ${active.name} » est actif. Aussi depuis le menu de l'icône d'Ondine, près de l'horloge.` : "Aussi depuis le menu de l'icône d'Ondine, près de l'horloge.",
        ),
        row(
          "Changer tout seul",
          toggle(profiles.auto, (v) => save((d) => (profilesOf(d).auto = v)), "Changer de profil tout seul"),
          "Selon l'heure ou le Wi-Fi (la règle de chaque profil, dans son sous-menu). Un choix fait à la main tient jusqu'au prochain changement.",
        ),
      ],
      "Un profil ne retient que ce qu'il remplace. Pendant qu'il est actif, vos changements de ces réglages (page Onglets, Apparence…) lui sont gardés ; les autres réglages restent communs.",
    )),
  );

  // ── Un bloc par profil ──
  for (const p of profiles.list) main.append(inSub(`p:${p.id}`, profileBlock(p, p.id === profiles.active, save)));

  const full = profiles.list.length >= MAX_PROFILES;
  main.append(
    el(
      "div",
      { class: "actions", "data-sub": "active" },
      el(
        "button",
        {
          class: "btn",
          disabled: full,
          title: full ? `${MAX_PROFILES} profils au plus` : undefined,
          onclick: () =>
            save((d) => {
              const all = profilesOf(d);
              const n = all.list.length + 1;
              all.list.push({
                id: `p${Date.now().toString(36)}`,
                name: n === 1 ? "Travail" : n === 2 ? "Maison" : `Profil ${n}`,
                values: { ...tabsNow(d), theme: d.island.theme, color: d.island.color, alwaysMini: d.island.alwaysMini },
                rule: { kind: "none", days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00", ssid: "" },
              });
            }, true),
        },
        "＋ Nouveau profil (à partir des réglages actuels)",
      ),
    ),
  );
}

function profileBlock(p: Profile, isActive: boolean, save: Save): HTMLElement {
  const edit = (change: (p: Profile, active: boolean, d: Settings) => void, redraw = false) =>
    save((d) => editProfile(d, p.id, (x, a) => change(x, a, d)), redraw);

  // Le nom
  const name = el("input", { type: "text", class: "text", maxlength: 40, "aria-label": "Nom du profil" }) as HTMLInputElement;
  name.value = p.name;
  name.addEventListener("change", () => {
    const v = name.value.trim().slice(0, 40);
    if (v) edit((x) => (x.name = v), true);
  });

  // Les onglets : retenus tels qu'ils sont au moment où l'on coche.
  const tabs = toggle(p.values.tabOrder !== undefined || p.values.modules !== undefined, (on) =>
    edit((x, _a, d) => {
      if (on) Object.assign(x.values, tabsNow(d));
      else {
        delete x.values.tabOrder;
        delete x.values.modules;
      }
    }),
  "Le profil remplace les onglets");

  // La couleur : un thème, ou « ne change pas ».
  const themes: [string, string][] = [["", "Ne change pas"], ...THEMES.map((t): [string, string] => [t.id, t.name]), ["custom", "Personnalisée"]];
  // Profil actif : ce qu'il remplace, c'est ce que l'île montre en ce moment
  // (les retouches lui seront rangées au prochain changement de profil).
  const live = settingsStore.current.island;
  const themeValue = p.values.theme === undefined ? "" : isActive ? live.theme : p.values.theme;
  const theme = select(themeValue, themes, (v) =>
    edit((x, a, d) => {
      if (!v) {
        delete x.values.theme;
        delete x.values.color;
        return;
      }
      x.values.theme = v;
      x.values.color = x.values.color ?? d.island.color;
      if (a) {
        d.island.theme = v;
        d.island.color = x.values.color;
      }
    }),
  );

  // « Toujours en mini »
  const miniOn = isActive ? live.alwaysMini : p.values.alwaysMini;
  const miniValue = p.values.alwaysMini === undefined ? "" : miniOn ? "on" : "off";
  const mini = choice(miniValue, [["", "Ne change pas"], ["on", "Oui"], ["off", "Non"]], (v) =>
    edit((x, a, d) => {
      if (!v) delete x.values.alwaysMini;
      else {
        x.values.alwaysMini = v === "on";
        if (a) d.island.alwaysMini = v === "on";
      }
    }),
  );

  // Supprimer : un second clic confirme.
  let armed = false;
  const remove = el("button", { class: "btn small" }, "Supprimer");
  remove.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      remove.textContent = "Confirmer la suppression";
      window.setTimeout(() => {
        armed = false;
        remove.textContent = "Supprimer";
      }, 4000);
      return;
    }
    // Un profil actif : on revient d'abord aux réglages hors profil.
    void (isActive ? activate("") : Promise.resolve()).then(() =>
      save((d) => {
        const all = profilesOf(d);
        all.list = all.list.filter((x) => x.id !== p.id);
        if (all.active === p.id) all.active = "";
      }, true),
    );
  });

  const buttons = el(
    "div",
    { class: "btn-row" },
    isActive ? null : el("button", { class: "btn small primary", onclick: () => void activate(p.id) }, "Activer"),
    remove,
  );

  return group(
    null,
    [
      el("h3", { class: "group-title" }, p.name, isActive ? " " : "", isActive ? chip("actif", "ok") : ""),
      row("Nom", name),
      row("Onglets affichés et leur ordre", tabs, "Coché : le profil retient les onglets tels qu'ils sont maintenant."),
      row("Couleur de l'île", theme),
      row("Toujours en mini", mini),
      ...ruleRows(p, edit),
      wideRow(null, buttons),
    ],
  );
}

/** « Activer tout seul » : jamais, une plage horaire, ou un Wi-Fi. */
function ruleRows(p: Profile, edit: (change: (p: Profile, active: boolean, d: Settings) => void, redraw?: boolean) => void): HTMLElement[] {
  const r = p.rule;
  const rows = [
    row(
      "Activer tout seul",
      choice(r.kind, [["none", "Non"], ["hours", "Heures"], ["wifi", "Wi-Fi"]], (v) => edit((x) => (x.rule.kind = v as Profile["rule"]["kind"]), true)),
      "Il faut aussi « Changer tout seul », en haut de la page.",
    ),
  ];
  if (r.kind === "hours") {
    const days = el(
      "div",
      { class: "btn-row" },
      ...DAYS.map(([n, short, long]) => {
        const on = r.days.includes(n);
        return el(
          "button",
          {
            class: `btn small${on ? " primary" : ""}`,
            title: long,
            "aria-label": long,
            "aria-pressed": String(on),
            onclick: () => edit((x) => (x.rule.days = on ? x.rule.days.filter((d) => d !== n) : [...x.rule.days, n].sort()), true),
          },
          short,
        );
      }),
    );
    const time = (value: string, label: string, set: (rule: Profile["rule"], v: string) => void) => {
      const input = el("input", { type: "time", class: "text", "aria-label": label }) as HTMLInputElement;
      input.value = value;
      input.addEventListener("change", () => {
        if (/^\d{2}:\d{2}$/.test(input.value)) edit((x) => set(x.rule, input.value));
      });
      return input;
    };
    rows.push(
      wideRow("Jours", days),
      row(
        "De … à …",
        el("div", { class: "btn-row" }, time(r.start, "Début", (x, v) => (x.start = v)), time(r.end, "Fin", (x, v) => (x.end = v))),
        "Une fin avant le début passe minuit (22:00 → 06:00).",
      ),
    );
  }
  if (r.kind === "wifi") {
    const ssid = el("input", { type: "text", class: "text", maxlength: 32, placeholder: "Nom du Wi-Fi", "aria-label": "Nom du Wi-Fi" }) as HTMLInputElement;
    ssid.value = r.ssid;
    ssid.addEventListener("change", () => edit((x) => (x.rule.ssid = ssid.value.trim())));
    const here = el("button", { class: "btn small" }, "Wi-Fi actuel");
    here.addEventListener("click", async () => {
      const name = await Bridge.wifiName();
      if (name) {
        ssid.value = name;
        edit((x) => (x.rule.ssid = name));
      } else {
        here.textContent = "Introuvable";
        window.setTimeout(() => (here.textContent = "Wi-Fi actuel"), 2500);
      }
    });
    rows.push(
      row(
        "Nom du Wi-Fi",
        el("div", { class: "btn-row" }, ssid, here),
        "Windows 11 ne donne ce nom qu'aux applis autorisées à utiliser la localisation (Paramètres → Confidentialité → Localisation).",
      ),
    );
  }
  return rows;
}
