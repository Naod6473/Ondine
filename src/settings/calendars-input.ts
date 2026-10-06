// La liste des calendriers du module Agenda, dans ses réglages (champ de type
// « calendars ») : chaque calendrier a une couleur, un nom, et sa source :
//   - un fichier .ics, choisi avec la boîte « Ouvrir » de Windows ;
//   - ou un lien iCal, rangé dans le Gestionnaire d'identifiants sous
//     « agenda-ical-url-<id> ». L'adresse ne va JAMAIS dans les réglages, et
//     la fenêtre ne peut pas la relire : seulement savoir si elle existe.
//
// Ajouter, renommer, changer la couleur ou le lien, retirer. Le Rust
// (src-tauri/src/modules/agenda.rs) relit tout dès que la liste change.

import type { CalendarEntry } from "../core/module-types";
import { Bridge, IS_TAURI } from "../core/bridge";
import { errorText } from "../core/log";
import { el } from "../island/dom";
import { chip } from "./controls";

/** Les couleurs données tour à tour aux nouveaux calendriers (les mêmes que le Rust). */
const COLORS = ["#4fb8ff", "#ff8a65", "#7bd88f", "#c792ea", "#ffd166", "#ff6b9a", "#5eead4", "#a3a3ff"];
/** L'ancienne clé (un seul lien, avant la version 1.2), gardée par le calendrier « lien ». */
const OLD_KEY = "agenda-ical-url";

/** La clé du Gestionnaire d'identifiants qui garde le lien de ce calendrier. */
const linkKey = (id: string) => `${OLD_KEY}-${id}`;

/** Un identifiant au hasard : 8 lettres minuscules ou chiffres. */
function newId(taken: CalendarEntry[]): string {
  const letters = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const id = [...bytes].map((b) => letters[b % letters.length]).join("");
    if (!taken.some((c) => c.id === id)) return id;
  }
}

/** La première couleur pas encore prise (sinon, on recommence la liste). */
function nextColor(list: CalendarEntry[]): string {
  return COLORS.find((c) => !list.some((cal) => cal.color === c)) ?? COLORS[list.length % COLORS.length];
}

/** « C:\Users\moi\Travail.ics » → « Travail ». */
function stem(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.ics$/i, "") || "Agenda";
}

export function calendarsInput(max: number, initial: CalendarEntry[], onChange: (list: CalendarEntry[]) => void): HTMLElement {
  let list = initial.map((c) => ({ ...c }));
  const box = el("div", { class: "paths cals" });
  const msg = el("div", { class: "row-help" });

  const update = (next: CalendarEntry[], redraw = true) => {
    list = next;
    onChange(list.map((c) => ({ ...c })));
    if (redraw) draw();
  };

  /** Le petit état d'un lien : enregistré ou non (jamais l'adresse). */
  const linkStatus = (cal: CalendarEntry): HTMLElement => {
    const status = chip("…");
    void (async () => {
      const present = (await Bridge.credentialExists(linkKey(cal.id))) || (cal.id === "lien" && (await Bridge.credentialExists(OLD_KEY)));
      status.textContent = present ? "✓ Lien enregistré" : "Aucun lien";
      status.className = `chip ${present ? "ok" : "warn"}`;
    })();
    return status;
  };

  /** Un champ « lien iCal » (masqué comme un mot de passe) avec son bouton. */
  const linkForm = (button: string, run: (url: string) => Promise<void>): HTMLElement => {
    const input = el("input", { type: "password", class: "text grow", placeholder: "Coller l'adresse secrète iCal (https://…)", autocomplete: "off", "aria-label": "Lien iCal" }) as HTMLInputElement;
    const go = async () => {
      msg.textContent = "";
      try {
        await run(input.value);
        input.value = "";
      } catch (err) {
        msg.textContent = errorText(err);
      }
    };
    input.addEventListener("keydown", (e) => e.key === "Enter" && void go());
    return el("div", { class: "inline cals-form" }, input, el("button", { class: "btn primary small", onclick: () => void go() }, button));
  };

  const remove = async (cal: CalendarEntry) => {
    msg.textContent = "";
    if (cal.kind === "link") {
      // Le lien part avec le calendrier : rien ne reste dans le Gestionnaire d'identifiants.
      try {
        await Bridge.credentialDelete(linkKey(cal.id));
        if (cal.id === "lien") await Bridge.credentialDelete(OLD_KEY);
      } catch (err) {
        msg.textContent = errorText(err);
      }
    }
    update(list.filter((c) => c.id !== cal.id));
  };

  const item = (cal: CalendarEntry): HTMLElement => {
    const color = el("input", { type: "color", class: "cals-color", value: cal.color, title: "Couleur", "aria-label": `Couleur de ${cal.name}` }) as HTMLInputElement;
    color.addEventListener("change", () => update(list.map((c) => (c.id === cal.id ? { ...c, color: color.value.toLowerCase() } : c)), false));
    const name = el("input", { type: "text", class: "text cals-name", maxlength: 60, value: cal.name, placeholder: "Nom", "aria-label": "Nom du calendrier" }) as HTMLInputElement;
    name.addEventListener("change", () => {
      const text = name.value.trim();
      if (!text) return void (name.value = cal.name);
      update(list.map((c) => (c.id === cal.id ? { ...c, name: text } : c)), false);
    });
    const source =
      cal.kind === "file"
        ? el("code", { class: "cals-source", title: cal.path ?? "" }, `📄 ${cal.path ?? ""}`)
        : el("span", { class: "cals-source" }, "🔗", el("span", {}, "Lien iCal"), linkStatus(cal));
    const row = el(
      "li",
      { class: "cals-item" },
      color,
      name,
      source,
      cal.kind === "link" ? el("button", { class: "btn small", onclick: () => toggleChange() }, "Changer le lien") : null,
      el("button", { class: "icon-btn", title: "Retirer ce calendrier", "aria-label": "Retirer ce calendrier", onclick: () => void remove(cal) }, "×"),
    );
    // « Changer le lien » : un champ apparaît sous la ligne.
    let form: HTMLElement | null = null;
    const toggleChange = () => {
      if (form) {
        form.remove();
        form = null;
        return;
      }
      form = el(
        "li",
        {},
        linkForm("Enregistrer", async (url) => {
          await Bridge.credentialSet(linkKey(cal.id), url);
          draw();
          msg.textContent = "Lien enregistré : l'agenda sera relu dans quelques secondes.";
        }),
      );
      row.after(form);
    };
    return row;
  };

  // « ＋ Lien iCal… » : nom + lien, puis « Ajouter ».
  let adding = false;
  const addLinkForm = (): HTMLElement => {
    const name = el("input", { type: "text", class: "text", maxlength: 60, placeholder: "Nom (ex. : Travail)", "aria-label": "Nom du calendrier" }) as HTMLInputElement;
    const form = linkForm("Ajouter", async (url) => {
      const id = newId(list);
      // D'abord le lien (il est vérifié : https seulement), ensuite la liste.
      await Bridge.credentialSet(linkKey(id), url);
      adding = false;
      update([...list, { id, name: name.value.trim().slice(0, 60) || "Agenda en ligne", color: nextColor(list), kind: "link" }]);
      msg.textContent = "Calendrier ajouté.";
    });
    form.prepend(name);
    return form;
  };

  const draw = () => {
    box.replaceChildren();
    const ul = el("ul", { class: "paths-list cals-list" });
    for (const cal of list) ul.append(item(cal));
    if (!list.length) ul.append(el("li", { class: "paths-empty" }, "Aucun calendrier."));
    const full = list.length >= max;
    const addFile = el(
      "button",
      {
        class: "btn small",
        disabled: !IS_TAURI || full,
        onclick: async () => {
          const picked = await Bridge.pickFile("Ajouter un fichier", ["ics"]);
          if (!picked || list.some((c) => c.kind === "file" && c.path === picked)) return;
          update([...list, { id: newId(list), name: stem(picked).slice(0, 60), color: nextColor(list), kind: "file", path: picked }]);
        },
      },
      "＋ Fichier .ics…",
    );
    const addLink = el(
      "button",
      {
        class: "btn small",
        disabled: !IS_TAURI || full,
        onclick: () => {
          adding = !adding;
          draw();
        },
      },
      adding ? "Annuler" : "＋ Lien iCal…",
    );
    box.append(ul, el("div", { class: "inline" }, addFile, addLink));
    if (adding && !full) box.append(addLinkForm());
    box.append(msg);
  };

  draw();
  return box;
}
