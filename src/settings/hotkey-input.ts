// Le champ « raccourci clavier » des réglages (type "hotkey" des manifestes,
// 1.2.4) : les choix proposés, et « Personnalisé… » qui enregistre la
// combinaison pressée. On clique sur « Enregistrer un raccourci », on appuie
// sur la combinaison (elle s'écrit au fur et à mesure), Échap annule,
// « Effacer » retire le raccourci. Les règles sont celles de
// src/core/hotkey.ts (les mêmes que côté Rust).
//
// Sous le champ, une ligne d'erreur (`[data-hotkey-error]`) : la règle non
// respectée, ou ce que le Rust a refusé (raccourci déjà pris par un autre
// logiciel), posé par `showHotkeyProblem`. Après chaque changement, le champ
// envoie l'événement DOM « hotkey-saved » ({key}) pour que la page redemande
// au Rust si le raccourci a bien été posé.

import { hotkeyFromEvent, hotkeyProblem, normalizeHotkey, prettyHotkey } from "../core/hotkey";
import { currentLang } from "../core/i18n";
import { el } from "../island/dom";
import { select } from "./controls";

const CUSTOM = "\u0000custom";

/** La commande du champ (à poser dans une ligne). */
export function hotkeyInput(key: string, value: string, presets: { value: string; label: string }[], onChange: (v: string) => void): HTMLElement {
  let current = value;
  const isPreset = (v: string) => presets.some((p) => p.value === v);
  const problem = el("div", { class: "row-help error-text hotkey-error", "data-hotkey-error": key, "aria-live": "polite", hidden: true });
  const shown = el("kbd", { class: "hotkey-keys", "data-no-i18n": "" });
  const record = el("button", { type: "button", class: "btn small hotkey-record" }, "Enregistrer un raccourci");
  const clear = el("button", { type: "button", class: "btn small" }, "Effacer");
  const recorder = el("div", { class: "hotkey-recorder" }, shown, record, clear);
  const options: [string, string][] = [...presets.map((p) => [p.value, p.label] as [string, string]), [CUSTOM, "Personnalisé…"]];
  let custom = !!current && !isPreset(current);
  const list = select(custom ? CUSTOM : current, options, (v) => {
    if (v === CUSTOM) {
      custom = true;
      draw();
      start();
      return;
    }
    custom = false;
    save(v);
  });

  const say = (text: string | null) => {
    problem.textContent = text ?? "";
    problem.hidden = !text;
  };
  const save = (v: string) => {
    current = v;
    say(null);
    draw();
    onChange(v);
    box.dispatchEvent(new CustomEvent("hotkey-saved", { bubbles: true, detail: { key } }));
  };
  const draw = () => {
    recorder.hidden = !custom;
    shown.textContent = current ? prettyHotkey(current, currentLang()) : "—";
    clear.disabled = !current;
  };

  // ── L'enregistrement ──
  let listening = false;
  const stopListening = () => {
    if (!listening) return;
    listening = false;
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keyup", onKeyUp, true);
    record.classList.remove("on");
    record.textContent = "Enregistrer un raccourci";
    draw();
  };
  const onKey = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const got = hotkeyFromEvent(e);
    if ("cancel" in got) {
      stopListening();
      return;
    }
    if ("partial" in got) {
      shown.textContent = got.partial ? `${prettyHotkey(`${got.partial}+A`, currentLang()).replace(/ \+ A$/, "")} + …` : "…";
      return;
    }
    const canonical = normalizeHotkey(got.value);
    const why = canonical ? hotkeyProblem(canonical) : "Raccourci illisible.";
    stopListening();
    if (why || !canonical) {
      shown.textContent = prettyHotkey(got.value, currentLang());
      say(why);
      return;
    }
    save(canonical);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const start = () => {
    if (listening) return;
    listening = true;
    say(null);
    record.classList.add("on");
    record.textContent = "Appuyez sur la combinaison (Échap pour annuler)";
    shown.textContent = "…";
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    record.focus();
  };
  record.addEventListener("click", () => (listening ? stopListening() : start()));
  record.addEventListener("blur", () => window.setTimeout(() => document.activeElement !== record && stopListening(), 0));
  clear.addEventListener("click", () => {
    stopListening();
    save("");
  });

  const box = el("div", { class: "hotkey-input" }, list, recorder, problem);
  draw();
  return box;
}

/** Affiche (ou efface) sous le champ `key` ce que le Rust a refusé. */
export function showHotkeyProblem(root: ParentNode, key: string, text: string | null): void {
  const box = root.querySelector<HTMLElement>(`[data-hotkey-error="${key}"]`);
  if (!box) return;
  // Une règle non respectée écrite par le champ lui-même reste là.
  if (!text && box.dataset.from !== "rust") return;
  box.dataset.from = text ? "rust" : "";
  box.textContent = text ?? "";
  box.hidden = !text;
}
