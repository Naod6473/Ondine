// L'onglet « Mises à jour des logiciels » : la liste de winget, la file, les
// résultats. Tout l'état vient du Rust (`status`) ; l'onglet se redessine à
// chaque « updates.changed » et suit l'avancement par « updates.progress »
// (seulement la barre de la ligne en cours, sans tout redessiner).
//
// Rien d'irréversible sans confirmation : « Mettre à jour » demande un second
// clic (« Confirmer ? », 4 s), « Tout mettre à jour » une bande de
// confirmation qui dit combien d'applis et ce qui peut se passer.

import { errorText } from "../../core/log";
import type { ModuleApi, ViewMount } from "../../core/module-types";
import { Bridge } from "../../core/bridge";
import { el } from "../../island/dom";
import {
  agoText,
  batchText,
  busy,
  countText,
  EMPTY_STATUS,
  finished,
  outcomeLine,
  PHASE_TEXT,
  rowState,
  succeeded,
  versionText,
  visible,
  type Phase,
  type Pkg,
  type Status,
} from "./logic";

/** Le temps laissé pour confirmer une mise à jour (second clic). */
const ARM_MS = 4000;

/** Réglages → Mises à jour des logiciels → Applis ignorées (« settings.goto », main.ts). */
function openIgnored() {
  try {
    localStorage.setItem("settings.goto", "module:updates#ignored");
  } catch {
    // Stockage indisponible : la fenêtre s'ouvre sur sa dernière page.
  }
  void Bridge.openSettingsWindow();
}

export const mount: ViewMount = (root, api: ModuleApi) => {
  let st: Status = EMPTY_STATUS;
  let alive = true;
  /** L'appli dont le bouton attend sa confirmation. */
  let armed = "";
  let armTimer = 0;
  /** La bande « Tout mettre à jour ? » est ouverte. */
  let confirmAll = false;
  let problem = "";

  const box = el("div", { class: "upd" });
  root.append(box);

  const run = (fn: () => Promise<unknown>) =>
    api.handler(async () => {
      problem = "";
      try {
        await fn();
      } catch (err) {
        problem = errorText(err);
        draw();
      }
    });

  const refresh = async () => {
    try {
      const next = await api.invoke<Status>("status");
      if (!alive) return;
      st = next;
      draw();
    } catch (err) {
      problem = errorText(err);
      draw();
    }
  };

  const disarm = () => {
    armed = "";
    window.clearTimeout(armTimer);
  };

  // ── Une ligne de la liste ─────────────────────────────────────────────────
  const item = (p: Pkg) => {
    const state = rowState(st, p.id);
    const info = el("small", { class: "upd-sub muted" }, el("span", { "data-no-i18n": "" }, p.id), " · ", el("span", { "data-no-i18n": "" }, versionText(p)));
    const lines: HTMLElement[] = [el("b", { class: "upd-name", "data-no-i18n": "", title: p.name }, p.name), info];
    const actions: (HTMLElement | null)[] = [];
    if (state.kind === "queued") {
      lines.push(el("small", { class: "upd-state" }, state.position === 1 && !st.current ? "Va commencer" : `En attente (${state.position})`));
      actions.push(el("button", { class: "btn small", title: "Retirer de la file : elle n'a pas encore commencé", onclick: run(() => api.invoke("cancel", { id: p.id })) }, "Retirer"));
    } else if (state.kind === "running") {
      lines.push(progressLine(state.phase, state.pct));
    } else {
      if (state.kind === "done") lines.push(el("small", { class: `upd-state ${succeeded(state.outcome) ? "good" : "bad"}`, title: state.code || undefined }, outcomeLine(state)));
      const isArmed = armed === p.id;
      const go = el(
        "button",
        {
          class: `btn small${isArmed ? " primary upd-armed" : ""}`,
          title: isArmed ? "Cliquez encore pour lancer la mise à jour" : "Mettre à jour cette appli (après confirmation)",
          onclick: run(async () => {
            if (armed !== p.id) {
              disarm();
              armed = p.id;
              armTimer = window.setTimeout(() => {
                armed = "";
                draw();
              }, ARM_MS);
              draw();
              return;
            }
            disarm();
            await api.invoke("upgrade", { ids: [p.id] });
          }),
        },
        isArmed ? "Confirmer ?" : state.kind === "done" && !succeeded(state.outcome) ? "Réessayer" : "Mettre à jour",
      );
      actions.push(go);
      // Les droits d'administrateur : la même mise à jour dans une console que Windows élève.
      if (state.kind === "done" && state.outcome === "admin") {
        actions.push(
          el(
            "button",
            { class: "btn small", title: "Ouvre une console en administrateur : Windows demande votre accord, puis winget fait la mise à jour", onclick: run(() => api.invoke("upgrade_admin", { id: p.id })) },
            "En administrateur",
          ),
        );
      }
      actions.push(el("button", { class: "icon-btn upd-hide", title: "Ne plus proposer cette appli", "aria-label": "Ne plus proposer cette appli", onclick: run(() => api.invoke("ignore", { id: p.id, ignore: true })) }, "🙈"));
    }
    return el(
      "li",
      { class: `upd-item${state.kind === "running" ? " running" : ""}`, "data-id": p.id },
      el("div", { class: "upd-main" }, ...lines),
      el("div", { class: "upd-actions" }, ...actions),
    );
  };

  /** La barre de la ligne en cours (mise à jour en place par « updates.progress »). */
  const progressLine = (phase: Phase, pct: number | null) => {
    const bar = el("i", { class: `upd-bar-fill${pct == null ? " indeterminate" : ""}` });
    if (pct != null) bar.style.width = `${Math.round(pct)}%`;
    const text = el("small", { class: "upd-state upd-phase" }, pct == null ? PHASE_TEXT[phase] : `${PHASE_TEXT[phase]} ${Math.round(pct)} %`);
    return el("div", { class: "upd-progress" }, el("div", { class: "upd-bar", role: "progressbar", "aria-label": "Avancement" }, bar), text);
  };

  // ── Toute la vue ──────────────────────────────────────────────────────────
  const draw = () => {
    if (!alive) return;
    const list = visible(st);
    const nowSecs = Date.now() / 1000;
    const working = busy(st);

    const checkBtn = el(
      "button",
      { class: "btn small", disabled: st.checking || working, title: "Demander à winget quelles applis ont une nouvelle version (contacte ses sources sur Internet)", onclick: run(() => api.invoke("check")) },
      st.checking ? "Vérification…" : "🔄 Vérifier",
    );
    const waiting = list.filter((p) => rowState(st, p.id).kind === "idle" || rowState(st, p.id).kind === "done").length;
    const allBtn =
      list.length > 1 && waiting > 0 && !st.missing
        ? el("button", { class: "btn small primary", disabled: st.checking || confirmAll, onclick: api.handler(() => ((confirmAll = true), draw())) }, `Tout mettre à jour (${waiting})`)
        : null;
    const head = el(
      "div",
      { class: "upd-head" },
      el("div", { class: "upd-title" }, el("b", {}, st.lastCheck ? countText(list.length) : "Mises à jour des logiciels"), el("small", { class: "muted" }, st.checking ? "winget lit ses sources…" : agoText(st.lastCheck, nowSecs))),
      checkBtn,
      allBtn,
    );

    const parts: (HTMLElement | null)[] = [head];

    if (confirmAll) {
      parts.push(
        el(
          "div",
          { class: "upd-confirm", role: "alertdialog", "aria-label": "Confirmer" },
          el("p", {}, waiting === 1 ? "Mettre à jour 1 appli ?" : `Mettre à jour ${waiting} applis ?`),
          el("small", { class: "muted" }, "Une à la fois. Une appli ouverte peut se fermer le temps de sa mise à jour ; certaines demandent l'autorisation de l'administrateur."),
          el(
            "div",
            { class: "btn-row" },
            el("button", { class: "btn small primary", onclick: run(async () => ((confirmAll = false), await api.invoke("upgrade_all"))) }, "Tout mettre à jour"),
            el("button", { class: "btn small", onclick: api.handler(() => ((confirmAll = false), draw())) }, "Annuler"),
          ),
        ),
      );
    }

    // La file en cours : « 2 sur 5 », et vider ce qui n'a pas commencé.
    if (working) {
      const name = st.current?.name ?? st.queue[0]?.name ?? "";
      parts.push(
        el(
          "div",
          { class: "upd-run" },
          el("span", { class: "upd-run-dot" }),
          el("small", {}, batchText(st) ? `${batchText(st)} · ` : "", el("span", { "data-no-i18n": "" }, name)),
          st.queue.length ? el("button", { class: "btn small", title: "Retirer de la file ce qui n'a pas commencé (celle en cours continue)", onclick: run(() => api.invoke("cancel_all")) }, "Vider la file") : null,
        ),
      );
    }

    if (st.missing) {
      parts.push(
        el(
          "div",
          { class: "upd-missing" },
          el("p", {}, "winget n'est pas installé sur ce PC."),
          el("small", { class: "muted" }, "Il vient avec « App Installer », gratuit sur le Microsoft Store (déjà là sur Windows 11 et Windows 10 à jour)."),
          el("div", { class: "btn-row" }, el("button", { class: "btn small primary", onclick: run(() => api.invoke("get_winget")) }, "Installer App Installer")),
        ),
      );
    }
    if (st.error) parts.push(el("p", { class: "upd-error" }, "⚠️ ", el("span", {}, st.error)));
    if (problem) parts.push(el("p", { class: "upd-error" }, "⚠️ ", el("span", {}, problem)));

    if (list.length) parts.push(el("ul", { class: "upd-list" }, ...list.map(item)));
    else if (!st.missing && !st.checking && !st.error) {
      parts.push(
        el(
          "p",
          { class: "upd-empty muted" },
          st.lastCheck ? "✅ Toutes vos applis connues de winget sont à jour." : "Cliquez sur « Vérifier » pour voir les applis qui ont une nouvelle version.",
        ),
      );
    }

    // Les réussies (sorties de la liste), les plus récentes d'abord.
    const doneList = finished(st);
    if (doneList.length) {
      parts.push(
        el(
          "div",
          { class: "upd-done" },
          el("div", { class: "upd-done-head" }, el("small", { class: "muted" }, "Terminées"), el("button", { class: "link-btn", onclick: run(() => api.invoke("clear_done")) }, "Effacer")),
          el(
            "ul",
            { class: "upd-list" },
            ...doneList.slice(0, 8).map((d) =>
              el(
                "li",
                { class: "upd-item done" },
                el("div", { class: "upd-main" }, el("b", { class: "upd-name", "data-no-i18n": "" }, d.name), el("small", { class: `upd-state ${succeeded(d.outcome) ? "good" : "bad"}` }, outcomeLine(d))),
              ),
            ),
          ),
        ),
      );
    }

    // Le pied : l'honnêteté sur l'administrateur, et les applis ignorées.
    const ignoredN = st.ignored.length;
    parts.push(
      el(
        "p",
        { class: "upd-foot muted" },
        el("span", {}, "ℹ️ Une appli installée pour tous les utilisateurs peut demander l'administrateur : Windows affiche alors sa fenêtre, qu'Ondine ne peut pas valider à votre place."),
        ignoredN
          ? el(
              "button",
              { class: "link-btn", title: "Réglages → Mises à jour des logiciels → Applis ignorées", onclick: api.handler(openIgnored) },
              ignoredN === 1 ? "1 appli ignorée" : `${ignoredN} applis ignorées`,
            )
          : null,
      ),
    );
    box.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
  };

  // Seulement la barre de la ligne en cours : pas de redessin complet 4 fois par seconde.
  const onProgress = (p: { id?: string; phase?: Phase; pct?: number | null }) => {
    if (!st.current || !p.id || st.current.id.toLowerCase() !== p.id.toLowerCase()) return;
    st = { ...st, current: { ...st.current, phase: p.phase ?? st.current.phase, pct: p.pct ?? null } };
    const row = [...box.querySelectorAll<HTMLElement>(".upd-item.running")].find((r) => r.dataset.id === st.current?.id);
    const old = row?.querySelector(".upd-progress");
    const cur = st.current;
    if (old && cur) old.replaceWith(progressLine(cur.phase, cur.pct));
  };

  let pending = 0;
  const offs = [
    api.on("updates.changed", () => {
      // Plusieurs nouvelles d'un coup : un seul `status`.
      window.clearTimeout(pending);
      pending = window.setTimeout(() => void refresh(), 60);
    }),
    api.on("updates.progress", (msg) => onProgress((msg.payload ?? {}) as { id?: string; phase?: Phase; pct?: number | null })),
  ];
  draw();
  void refresh();
  // « Vérifié il y a 5 min » avance tout seul tant que l'onglet est ouvert.
  const tick = window.setInterval(() => {
    if (!document.hidden && !busy(st)) draw();
  }, 60_000);

  return () => {
    alive = false;
    disarm();
    window.clearTimeout(pending);
    window.clearInterval(tick);
    offs.forEach((off) => off());
  };
};
