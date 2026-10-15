// Les blocs « Micro » et « Dis Ondine » de Réglages → Parler à Ondine →
// Voix et sons (1.2.4). Logique sans page : mic-logic.ts.
//
//   - Micro : la liste des micros du PC (commande `mics` du module askclaude,
//     lue à l'affichage et par « Actualiser »), « Tester le micro » (quelques
//     secondes de niveau, événement Tauri « mic-test », rien n'est gardé ni
//     envoyé), et l'avertissement quand le moteur de Windows n'écoutera pas
//     le micro choisi ;
//   - Dis Ondine : le mot d'appel, COUPÉ par défaut ; l'allumer demande une
//     confirmation qui dit ce que ça fait. Son état (à l'écoute, en pause et
//     pourquoi) vient de la commande `wake_state`, relue toutes les 3 s tant
//     que le bloc est affiché ;
//   - les raccourcis : après un changement (événement DOM « hotkey-saved »),
//     ce que le Rust a refusé (déjà pris par un autre logiciel) s'écrit sous
//     le champ (commande `hotkeys`).

import { Bridge, IS_TAURI, onTauriEvent } from "../core/bridge";
import { errorText } from "../core/log";
import { settingsStore } from "../core/settings-store";
import { el } from "../island/dom";
import { group, inSub, row, select, toggle, wideRow } from "./controls";
import { showHotkeyProblem } from "./hotkey-input";
import { micEngineWarning, micOptions, micTestText, sentence, wakeText, type Mic, type MicList, type MicTestEnd, type WakeState } from "./mic-logic";

type Pick = (key: string, value: unknown) => void;

function values(): Record<string, unknown> {
  return settingsStore.current.modules.askclaude?.values ?? {};
}

/** Ouvre une page des Paramètres Windows (liste fixe côté Rust : « sound », « mic »…). */
function openFix(fix: string, say: (t: string) => void) {
  void Bridge.moduleInvoke("askclaude", "voice_fix", { fix }).catch((e: unknown) => say(errorText(e)));
}

/** Le bloc « Micro ». */
export function micBlock(pick: Pick): HTMLElement {
  let list: Mic[] = [];
  const chosen = () => String(values().micDevice ?? "");
  const box = el("div", { class: "mic-choice" });
  const refresh = el("button", { type: "button", class: "btn small" }, "Actualiser");
  const warning = el("div", { class: "row-help error-text", hidden: true });
  const warningButtons = el(
    "div",
    { class: "btn-row", hidden: true },
    el("button", { type: "button", class: "btn small", onclick: () => openFix("sound", (t) => (warning.textContent = t)) }, "Ouvrir les paramètres du son de Windows"),
    el("button", { type: "button", class: "btn small", onclick: () => pick("voiceEngine", "parakeet") }, "Passer à Parakeet"),
  );
  const note = el("div", { class: "row-help" });

  const drawWarning = () => {
    const w = micEngineWarning(String(values().voiceEngine ?? "windows"), chosen(), list);
    warning.textContent = w ?? "";
    warning.hidden = !w;
    warningButtons.hidden = !w;
  };
  const draw = (r: MicList | null) => {
    list = r?.mics ?? [];
    const s = select(chosen(), micOptions(list, chosen()), (v) => pick("micDevice", v));
    s.setAttribute("aria-label", "Micro");
    box.replaceChildren(s, refresh);
    note.textContent = !r ? "Activez le module pour choisir le micro." : !r.supported ? "Windows seulement." : list.length ? "" : "Aucun micro branché.";
    note.hidden = !note.textContent;
    drawWarning();
  };
  const load = () => {
    if (!IS_TAURI) return draw({ supported: false, mics: [], chosen: "" });
    refresh.disabled = true;
    void Bridge.moduleInvoke<MicList>("askclaude", "mics", null)
      .then(draw)
      .catch(() => draw(null))
      .finally(() => (refresh.disabled = false));
  };
  refresh.addEventListener("click", load);
  draw({ supported: true, mics: [], chosen: chosen() });
  load();
  // Le moteur change dans la liste juste en dessous : l'avertissement suit.
  const off = settingsStore.onChange(() => (warning.isConnected ? drawWarning() : off()));

  return inSub(
    "voice",
    group("Micro", [
      row(
        "Micro",
        box,
        "Le micro qu'Ondine écoute : Parler à Ondine (Parakeet, hors ligne, API), la dictée et le côté micro des notes d'appel. Débranché : celui par défaut de Windows.",
        // Sans clé : montré aussi en mode Simple (c'est la première chose à vérifier quand Ondine n'entend pas).
        "",
      ),
      wideRow(null, el("div", {}, note, warning, warningButtons)),
      testRow(chosen),
    ]),
  );
}

/** « Tester le micro » : quelques secondes de niveau, puis le bilan. */
function testRow(chosen: () => string): HTMLElement {
  const fill = el("span", { class: "mic-meter-fill" });
  const meter = el("div", { class: "mic-meter", role: "meter", "aria-label": "Niveau du micro", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" }, fill);
  const result = el("div", { class: "row-help", "aria-live": "polite" });
  const fixes = el("div", { class: "btn-row" });
  const start = el("button", { type: "button", class: "btn small" }, "Tester le micro");
  let off: (() => void) | null = null;
  const setLevel = (l: number) => {
    fill.style.transform = `scaleX(${Math.max(0, Math.min(1, l))})`;
    meter.setAttribute("aria-valuenow", String(Math.round(l * 100)));
  };
  const finish = () => {
    off?.();
    off = null;
    start.disabled = false;
    setLevel(0);
  };
  start.addEventListener("click", async () => {
    start.disabled = true;
    fixes.replaceChildren();
    result.className = "row-help";
    result.textContent = "Parlez quelques secondes…";
    off = await onTauriEvent<{ level?: number } & Partial<MicTestEnd>>("mic-test", (p) => {
      if (!p.done) {
        setLevel(p.level ?? 0);
        return;
      }
      const r = micTestText(p as MicTestEnd);
      result.className = r.ok ? "row-help" : "row-help error-text";
      result.textContent = r.text;
      if (r.note) result.append(el("span", {}, ` ${r.note}`));
      if (p.info) result.append(el("small", { class: "muted mic-format", "data-no-i18n": "" }, ` ${p.info.format}`));
      if (p.fix === "sound") fixes.append(el("button", { type: "button", class: "btn small", onclick: () => openFix("sound", (t) => (result.textContent = t)) }, "Ouvrir les paramètres du son de Windows"));
      if (p.fix === "mic") fixes.append(el("button", { type: "button", class: "btn small", onclick: () => openFix("mic", (t) => (result.textContent = t)) }, "Ouvrir les paramètres Windows"));
      finish();
    });
    try {
      await Bridge.moduleInvoke("askclaude", "mic_test", { device: chosen() });
    } catch (e) {
      result.className = "row-help error-text";
      result.textContent = sentence(errorText(e));
      finish();
    }
  });
  return wideRow("Tester le micro", el("div", { class: "mic-test" }, el("div", { class: "btn-row" }, start, meter), result, fixes), "Ondine écoute quelques secondes le micro choisi et montre le niveau : rien n'est gardé ni envoyé.", "");
}

/** Le bloc « Dis Ondine » (mot d'appel), coupé par défaut. */
export function wakeBlock(pick: Pick): HTMLElement {
  const wanted = values().wakeWord === true;
  const status = el("div", { class: "row-help", "aria-live": "polite" });
  const confirmBox = el(
    "div",
    { class: "wake-confirm", hidden: true, role: "alertdialog", "aria-label": "Activer « Dis Ondine »" },
    el("p", {}, "Avec « Dis Ondine », le micro reste ouvert en permanence. L'écoute se fait entièrement sur ce PC : rien n'est enregistré ni envoyé tant que vous n'avez pas dit « Dis Ondine » ou « Hey Ondine ». Un point rouge reste visible sur l'île tant qu'elle écoute. Elle se met en pause en visio, en présentation, en concentration, quand le PC est verrouillé et en mode Économie d'énergie."),
  );
  let state: WakeState | null = null;
  const sw = toggle(wanted, (v) => {
    if (!v) {
      confirmBox.hidden = true;
      pick("wakeWord", false);
      return;
    }
    // Pas encore : la confirmation d'abord.
    input.checked = false;
    confirmBox.hidden = false;
    yes.focus();
  }, "« Dis Ondine » pour lui parler");
  const input = sw.querySelector("input") as HTMLInputElement;
  const yes = el("button", { type: "button", class: "btn primary small" }, "Activer l'écoute permanente");
  const no = el("button", { type: "button", class: "btn small" }, "Annuler");
  yes.addEventListener("click", () => {
    confirmBox.hidden = true;
    input.checked = true;
    pick("wakeWord", true);
  });
  no.addEventListener("click", () => {
    confirmBox.hidden = true;
    input.focus();
  });
  confirmBox.append(el("div", { class: "btn-row" }, yes, no));

  const draw = () => {
    status.textContent = wakeText(state, values().wakeWord === true);
    // Sans Parakeet (ou hors Windows) : on ne peut pas l'allumer (on peut toujours l'éteindre).
    input.disabled = !input.checked && (!state?.supported || !state.parakeet);
  };
  const load = () =>
    void Bridge.moduleInvoke<WakeState>("askclaude", "wake_state", null)
      .then((s) => (state = s))
      .catch(() => (state = null))
      .finally(draw);
  draw();
  load();
  const timer = window.setInterval(() => (status.isConnected ? load() : window.clearInterval(timer)), 3000);

  return inSub(
    "voice",
    group("« Dis Ondine »", [
      row(
        "« Dis Ondine » pour lui parler",
        sw,
        "Quand vous dites « Dis Ondine » ou « Hey Ondine », Parler à Ondine s'ouvre et écoute la suite (ou prend la question dite d'une traite). Coupé par défaut. Il faut le modèle Parakeet ; la détection se fait sur le PC, avec le micro choisi.",
        "« Dis Ondine » pour lui parler",
      ),
      wideRow(null, el("div", {}, status, confirmBox)),
    ]),
  );
}

let hotkeyWatch = false;

/** Sous chaque champ de raccourci : ce que le Rust a refusé (déjà pris…). */
export function watchHotkeyProblems(): void {
  const ask = () =>
    void Bridge.moduleInvoke<Record<string, string>>("askclaude", "hotkeys", null)
      .then((errors) => {
        for (const key of ["voiceHotkey", "lookHotkey"]) showHotkeyProblem(document, key, errors[key] ? sentence(errors[key]) : null);
      })
      .catch(() => {
        /* module coupé : rien à dire */
      });
  // Le fil des raccourcis les pose chaque seconde : on demande un peu après.
  window.setTimeout(ask, 300);
  if (hotkeyWatch) return;
  hotkeyWatch = true;
  document.addEventListener("hotkey-saved", () => window.setTimeout(ask, 1600));
}
