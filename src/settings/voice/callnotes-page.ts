// Page « Notes d'appel » du groupe Voix des Réglages (1.2.4), comme la
// maquette NotesAppel : la bande du haut (hero) et son bouton « Enregistrer un
// appel », la liste des notes à gauche, la note choisie à droite (titre, date,
// durée, personnes ; Résumé / Transcription ; points clés ; choses à faire en
// cases à cocher ; extrait coloré par personne), puis les réglages du module
// et ce qui part.
//
// Tout vient du module Rust « callnotes » (src-tauri/src/modules/callnotes.rs) :
// la page redemande la liste ou la note quand le bus dit `callnotes.changed`
// ou `callnotes.state` (le texte des appels ne passe jamais par le bus).

import { Bridge, IS_TAURI, onTauriEvent } from "../../core/bridge";
import type { BusMessage } from "../../core/bus";
import { errorText } from "../../core/log";
import type { ModuleManifest } from "../../core/module-types";
import { pacedInterval } from "../../core/perf";
import { settingsStore } from "../../core/settings-store";
import { el } from "../../island/dom";
import manifest from "../../modules/callnotes/manifest.json";
import { group, row, toggle, wideRow } from "../controls";
import { settingsRows } from "../form";
import { hero } from "../hero";
import {
  cleanName,
  elapsed,
  excerpt,
  itemMeta,
  noteMeta,
  summaryLeaves,
  transcriptionLeaves,
  who,
  type CallNote,
  type CallStatusInfo,
  type NoteItem,
} from "./callnotes-logic";
import { parakeetBlock } from "./parakeet-block";
import type { VoicePage } from "./pages";
import "../../styles/callnotes.css";

const ID = "callnotes";
const COLOR = "#ff8a6b";
const MANIFEST = manifest as ModuleManifest;

function invoke<T>(command: string, args?: unknown): Promise<T> {
  return Bridge.moduleInvoke<T>(ID, command, args ?? null);
}

function lang(): string {
  return document.documentElement.lang || "fr";
}

/** Le module allumé ou coupé (Réglages → son interrupteur, ici en tête des réglages). */
function setEnabled(on: boolean) {
  void settingsStore.update((d) => {
    const entry = (d.modules[ID] ??= { enabled: on, values: {} });
    entry.enabled = on;
  });
}

function render(root: HTMLElement): () => void {
  let status: CallStatusInfo | null = null;
  let items: NoteItem[] = [];
  let selected: string | null = null;
  let note: CallNote | null = null;
  let tab: "summary" | "transcript" = "summary";
  let message = "";
  let busy = false;
  let stopTick: (() => void) | null = null;
  let alive = true;

  const recordBtn = el("button", { class: "cn-record" }) as HTMLButtonElement;
  const band = hero({
    title: "Notes d'appel",
    subtitle: "Votre micro et le son du PC, écrits personne par personne. Prévenez les participants que vous enregistrez.",
    color: COLOR,
    mascots: ["gomme-dragee", "gomme-berlingot"],
    actions: [recordBtn],
  });
  const banner = el("div", { class: "cn-banner", role: "status", hidden: true });
  const notice = el("div", { class: "cn-notice", hidden: true, "aria-live": "polite" });
  const list = el("section", { class: "cn-list", "aria-label": "Vos notes" });
  const detail = el("section", { class: "cn-detail", "aria-live": "polite" });
  const settingsBox = el("div");
  const page = el("div", { class: "cn-page" }, band, banner, notice, el("div", { class: "cn-split" }, list, detail), settingsBox);
  root.append(page);

  // ── Le bouton principal et le bandeau rouge ──────────────────────────────

  const drawRecord = () => {
    const rec = status?.recording ?? false;
    const since = Date.now() - (status?.startedAt ?? Date.now());
    recordBtn.classList.toggle("on", rec);
    recordBtn.disabled = busy || !IS_TAURI;
    recordBtn.replaceChildren(
      rec ? el("span", { class: "callnotes-dot", "aria-hidden": "true" }) : el("span", { class: "cn-record-dot", "aria-hidden": "true" }),
      rec ? `Arrêter · ${elapsed(since)}` : "Enregistrer un appel",
    );
    banner.hidden = !rec;
    if (rec) {
      banner.replaceChildren(
        el("span", { class: "callnotes-dot", "aria-hidden": "true" }),
        el("b", {}, `Enregistrement en cours · ${elapsed(since)}`),
        el("span", {}, "Prévenez les participants que vous enregistrez."),
      );
    }
  };

  const tick = () => {
    if (status?.recording) drawRecord();
  };

  const setTicking = () => {
    if (status?.recording && !stopTick) stopTick = pacedInterval(tick, "mediaProgress", true);
    if (!status?.recording && stopTick) {
      stopTick();
      stopTick = null;
    }
  };

  const showMessage = (text: string, error = false) => {
    message = text;
    notice.hidden = !message;
    notice.classList.toggle("error", error);
    notice.textContent = message;
  };

  /** Ce qu'il faut dire avant de cliquer : Parakeet manquant, module coupé. */
  const drawNotice = () => {
    if (message) return;
    if (!settingsStore.moduleEnabled(ID)) {
      notice.hidden = false;
      notice.classList.remove("error");
      notice.textContent = "Le module Notes d'appel est désactivé : activez-le dans les réglages en bas de cette page.";
      return;
    }
    if (status && status.engine === "parakeet" && !status.parakeet) {
      notice.hidden = false;
      notice.classList.remove("error");
      notice.textContent = transcriptionLeaves(status);
      return;
    }
    notice.hidden = true;
  };

  recordBtn.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    showMessage("");
    drawRecord();
    try {
      if (status?.recording) {
        await invoke("stop");
      } else {
        const { id } = await invoke<{ id: string }>("start");
        selected = id;
        tab = "transcript";
      }
    } catch (err) {
      showMessage(errorText(err), true);
    } finally {
      busy = false;
      await refresh();
    }
  });

  // ── La liste ─────────────────────────────────────────────────────────────

  const drawList = () => {
    const now = Date.now();
    list.replaceChildren(el("span", { class: "cn-sec" }, "Vos notes"));
    if (!items.length) {
      list.append(el("p", { class: "cn-empty" }, "Vos appels s'afficheront ici. Cliquez sur « Enregistrer un appel » quand l'un commence."));
      return;
    }
    for (const n of items) {
      const meta = el("span", {}, itemMeta(n, now, lang()));
      if (n.status === "recording") meta.prepend(el("span", { class: "callnotes-dot", "aria-hidden": "true" }));
      const b = el(
        "button",
        { class: `cn-item${n.id === selected ? " on" : ""}`, "aria-pressed": String(n.id === selected) },
        el("b", { "data-no-i18n": "" }, n.title),
        meta,
      );
      b.addEventListener("click", () => {
        if (selected === n.id) return;
        selected = n.id;
        tab = n.status === "recording" ? "transcript" : "summary";
        drawList();
        void loadNote();
      });
      list.append(b);
    }
  };

  // ── La note choisie ──────────────────────────────────────────────────────

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) showMessage(done);
    } catch (err) {
      showMessage(errorText(err), true);
    }
  };

  const titleNode = (n: CallNote): HTMLElement => {
    const t = el("div", { class: "cn-title", tabindex: "0", role: "button", title: "Renommer", "data-no-i18n": "" }, n.title);
    const edit = () => {
      const input = el("input", { class: "text cn-title-input", maxlength: 120, "aria-label": "Titre de la note" }) as HTMLInputElement;
      input.value = n.title;
      let done = false;
      const finish = (save: boolean) => {
        if (done) return;
        done = true;
        const title = input.value.trim();
        if (save && title && title !== n.title) void act(() => invoke("rename", { id: n.id, title }));
        else drawDetail();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      });
      input.addEventListener("blur", () => finish(true));
      t.replaceWith(input);
      input.focus();
      input.select();
    };
    t.addEventListener("click", edit);
    t.addEventListener("keydown", (e) => {
      if (e.key === "Enter") edit();
    });
    return t;
  };

  const personChip = (n: CallNote, id: string): HTMLElement => {
    const w = who(n, id);
    const chip = el("button", { class: "cn-person", title: "Renommer" }, el("i", { style: `background:${w.color}` }), el("span", { "data-no-i18n": "" }, w.name));
    if (n.status === "recording") {
      chip.setAttribute("disabled", "");
      return chip;
    }
    chip.addEventListener("click", () => {
      const input = el("input", { class: "text cn-person-input", maxlength: 40, "aria-label": "Nom de la personne" }) as HTMLInputElement;
      input.value = w.name;
      let done = false;
      const finish = (save: boolean) => {
        if (done) return;
        done = true;
        const name = cleanName(input.value);
        if (save && name && name !== w.name) void act(() => invoke("rename_speaker", { id: n.id, speaker: id, name }));
        else drawDetail();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      });
      input.addEventListener("blur", () => finish(true));
      chip.replaceWith(input);
      input.focus();
      input.select();
    });
    return chip;
  };

  const lineNode = (n: CallNote, l: CallNote["lines"][number], clock: boolean): HTMLElement => {
    const w = who(n, l.speaker);
    return el(
      "div",
      { class: "cn-line" },
      el("span", { class: "cn-who", style: `color:${w.color}`, "data-no-i18n": "" }, w.name),
      el("span", { "data-no-i18n": "" }, clock ? el("span", { class: "cn-clock" }, elapsed(l.start * 1000)) : null, l.text),
    );
  };

  const summaryView = (n: CallNote): HTMLElement[] => {
    const out: HTMLElement[] = [];
    const leaves = el("p", { class: "cn-leaves" }, summaryLeaves(status?.ai ?? null));
    const write = el(
      "button",
      { class: n.summary ? "btn small" : "btn primary", disabled: n.working || !n.lines.length },
      n.summary ? "Réécrire le résumé" : "Écrire le résumé",
    );
    write.addEventListener("click", () => {
      void act(async () => {
        write.disabled = true;
        write.textContent = "Le résumé s'écrit…";
        await invoke("summarize", { id: n.id });
      });
    });
    if (n.summary) out.push(el("p", { class: "cn-summary", "data-no-i18n": "" }, n.summary));
    else if (n.lines.length) out.push(el("p", { class: "cn-summary muted" }, "Pas encore de résumé. Il s'écrit d'un clic, par l'IA de Parler à Ondine."));
    else out.push(el("p", { class: "cn-summary muted" }, "Personne n'a parlé pendant cet appel : rien à résumer."));
    if (n.keyPoints.length || n.todos.length) {
      const points = el("div", { class: "cn-col" }, el("span", { class: "cn-sec" }, "Points clés"), ...n.keyPoints.map((p) => el("div", { class: "cn-point", "data-no-i18n": "" }, p)));
      const todos = el(
        "div",
        { class: "cn-col" },
        el("span", { class: "cn-sec" }, "À faire"),
        ...n.todos.map((t) => {
          const box = el("input", { type: "checkbox", "aria-label": t.text }) as HTMLInputElement;
          box.checked = t.done;
          box.addEventListener("change", () => void act(() => invoke("toggle_todo", { id: n.id, todo: t.id })));
          return el(
            "label",
            { class: `cn-todo${t.done ? " done" : ""}` },
            box,
            el("span", { "data-no-i18n": "" }, el("span", { class: "cn-todo-text" }, t.text), t.owner ? " " : null, t.owner ? el("span", { class: "cn-owner" }, t.owner) : null, t.due ? ` · ${t.due}` : null),
          );
        }),
      );
      out.push(el("div", { class: "cn-cols" }, n.keyPoints.length ? points : null, n.todos.length ? todos : null));
    }
    if (n.lines.length) out.push(el("div", { class: "cn-actions" }, write), leaves);
    const lines = excerpt(n.lines);
    if (lines.length) {
      out.push(el("div", { class: "cn-rule" }), el("span", { class: "cn-sec" }, "Extrait de la transcription"), ...lines.map((l) => lineNode(n, l, false)));
    }
    return out;
  };

  const transcriptView = (n: CallNote): HTMLElement[] => {
    const out: HTMLElement[] = [];
    if (n.speakers.length) out.push(el("div", { class: "cn-people" }, el("span", { class: "cn-sec" }, "Personnes"), ...n.speakers.map((s) => personChip(n, s.id))));
    if (n.status === "recording") {
      out.push(
        el(
          "p",
          { class: "cn-leaves" },
          n.engine === "api" ? "Avec la transcription par l'API, les mots s'écrivent à la fin de l'appel." : "Les mots en direct, écrits toutes les quelques secondes. La transcription personne par personne s'écrit à la fin.",
        ),
      );
    }
    const box = el("div", { class: "cn-transcript" }, ...n.lines.map((l) => lineNode(n, l, true)));
    if (!n.lines.length && n.status !== "recording") box.append(el("p", { class: "cn-empty" }, "Personne n'a parlé pendant cet appel."));
    out.push(box);
    requestAnimationFrame(() => {
      if (n.status === "recording") box.scrollTop = box.scrollHeight;
    });
    return out;
  };

  const drawDetail = () => {
    if (!note) {
      detail.replaceChildren(el("p", { class: "cn-empty" }, items.length ? "Choisissez une note à gauche." : "Aucune note d'appel pour l'instant."));
      return;
    }
    const n = note;
    const now = Date.now();
    const head = el(
      "div",
      { class: "cn-head" },
      el("div", { class: "cn-head-text" }, titleNode(n), el("span", { class: "cn-meta" }, noteMeta(n, now, lang()))),
    );
    if (n.status === "ready") {
      head.append(
        el(
          "div",
          { class: "cn-actions" },
          el("button", { class: "btn small", onclick: () => void act(() => invoke("copy", { id: n.id }), "Copiée en Markdown.") }, "Copier en Markdown"),
          el(
            "button",
            {
              class: "btn small",
              onclick: () =>
                void act(async () => {
                  const r = await invoke<{ saved: string | null }>("export", { id: n.id });
                  if (r.saved) showMessage(`Exportée : ${r.saved}`);
                }),
            },
            "Exporter",
          ),
          el(
            "button",
            {
              class: "btn small",
              title: "Le résumé et les points clés deviennent une note ; les choses à faire, des tâches",
              onclick: () => void act(() => invoke("to_notes", { id: n.id }), "Envoyée vers Notes."),
            },
            "Envoyer vers Notes",
          ),
          el(
            "button",
            { class: "btn small danger", onclick: () => void act(() => invoke("delete", { id: n.id })) },
            "Supprimer",
          ),
        ),
      );
    }
    const parts: (HTMLElement | null)[] = [head];
    if (n.warning) parts.push(el("div", { class: "cn-notice" }, n.warning));
    if (n.status === "processing" || (n.working && n.status !== "ready")) {
      parts.push(el("p", { class: "cn-summary" }, "La transcription s'écrit… L'audio sera effacé dès qu'elle est écrite."));
    } else if (n.status === "failed") {
      parts.push(
        el("div", { class: "cn-notice error" }, n.error ?? "La transcription n'a pas pu s'écrire."),
        el(
          "div",
          { class: "cn-actions" },
          el("button", { class: "btn primary small", onclick: () => void act(() => invoke("retry", { id: n.id })) }, "Réessayer"),
          el("button", { class: "btn small danger", onclick: () => void act(() => invoke("delete", { id: n.id })) }, "Supprimer"),
        ),
      );
    }
    if (n.status === "ready" || n.status === "recording") {
      const tabs = el("div", { class: "cn-tabs", role: "tablist", "aria-label": "Affichage" });
      for (const [id, label] of [["summary", "Résumé"], ["transcript", "Transcription"]] as const) {
        if (n.status === "recording" && id === "summary") continue;
        const b = el("button", { class: "cn-tab", role: "tab", "aria-selected": String(tab === id || n.status === "recording") }, label);
        b.addEventListener("click", () => {
          tab = id;
          drawDetail();
        });
        tabs.append(b);
      }
      parts.push(tabs);
      const body = n.status === "recording" || tab === "transcript" ? transcriptView(n) : summaryView(n);
      parts.push(...body);
    }
    detail.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
  };

  const loadNote = async () => {
    if (!selected) {
      note = null;
      drawDetail();
      return;
    }
    try {
      note = await invoke<CallNote>("get", { id: selected });
    } catch {
      note = null;
    }
    // Un nom ou un titre en train d'être tapé n'est pas effacé par les mots en direct.
    const typing = document.activeElement instanceof HTMLInputElement && detail.contains(document.activeElement);
    if (alive && !typing) drawDetail();
  };

  // ── Les réglages du module ───────────────────────────────────────────────

  const drawSettings = () => {
    const values = settingsStore.moduleValues(MANIFEST);
    const rows = settingsRows(MANIFEST.settings?.fields ?? [], values, (key, value) =>
      void settingsStore
        .update((d) => {
          const entry = (d.modules[ID] ??= { enabled: settingsStore.moduleEnabled(ID), values: {} });
          entry.values[key] = value;
        })
        .then(() => refresh()),
    );
    const leaves = status
      ? [el("p", {}, transcriptionLeaves(status)), el("p", {}, summaryLeaves(status.ai)), el("p", {}, "Les notes restent sur votre ordinateur (%APPDATA%\\Ondine\\callnotes), une par fichier. Supprimer une note la met à la Corbeille.")]
      : [el("p", { class: "muted" }, "Activez le module pour voir ce qui part.")];
    settingsBox.replaceChildren(
      group("Réglages", [
        row("Activé", toggle(settingsStore.moduleEnabled(ID), (on) => {
          setEnabled(on);
          void refresh();
        }, "Activé"), "Rien n'est enregistré sans votre clic sur « Enregistrer un appel »."),
        ...rows,
      ]),
      group("Ce qui part", [wideRow(null, el("div", { class: "cn-leaves" }, ...leaves))]),
      parakeetBlock(),
    );
  };

  // ── Tout redemander ──────────────────────────────────────────────────────

  const refresh = async () => {
    if (!alive) return;
    if (IS_TAURI && settingsStore.moduleEnabled(ID)) {
      try {
        status = await invoke<CallStatusInfo>("status");
        items = (await invoke<{ notes: NoteItem[] }>("list")).notes;
      } catch {
        status = null;
        items = [];
      }
    } else {
      status = null;
      items = [];
    }
    if (!alive) return;
    if (!selected || !items.some((n) => n.id === selected)) selected = items[0]?.id ?? null;
    drawRecord();
    setTicking();
    drawNotice();
    drawList();
    drawSettings();
    await loadNote();
  };

  // Le Rust prévient : un appel commence ou s'arrête, une note change.
  let unlisten: (() => void) | null = null;
  void onTauriEvent<BusMessage>("bus", (msg) => {
    if (!alive || !msg.topic.startsWith("callnotes.")) return;
    if (msg.topic === "callnotes.error") {
      showMessage(String((msg.payload as { message?: string })?.message ?? ""), true);
      return;
    }
    if (msg.topic === "callnotes.changed") {
      const id = (msg.payload as { id?: string })?.id;
      // Les mots en direct de la note affichée : seulement elle.
      if (id && id === selected && status?.recording && note?.status === "recording") {
        void loadNote();
        return;
      }
    }
    void refresh();
  }).then((off) => {
    if (alive) unlisten = off;
    else off();
  });

  drawRecord();
  drawList();
  drawDetail();
  drawSettings();
  void refresh();

  return () => {
    alive = false;
    stopTick?.();
    unlisten?.();
  };
}

export const callnotesPage: VoicePage = {
  id: "voice:callnotes",
  label: "Notes d'appel",
  color: COLOR,
  module: ID,
  render,
};
