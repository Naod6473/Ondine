// Le panneau de l'assistant de premier lancement, dans l'alerte de l'île
// (la logique et les réglages : src/core/setup.ts ; les cartes :
// src/core/setup-plan.ts).
//
// Mise en page : cinq points d'étape en haut (une pastille à ressorts glisse
// de l'un à l'autre, comme celle des onglets : tab-pill.ts), le contenu de
// l'étape, puis Retour / Passer / Continuer. Chaque étape a sa hauteur
// (island.css, `data-step`) : l'île s'y ajuste avec ses ressorts (jelly.ts),
// en gardant son élan. L'étape qui s'en va glisse et s'efface d'un côté
// pendant que la suivante arrive en cascade de l'autre (motion.ts), comme un
// changement d'onglet.
//
// « Réduire les animations » de Windows ou le mode Calme de la mascotte :
// tout change d'un coup, sans glissement ni rebond.
//
// Le panneau ne touche jamais les réglages : il demande au contrôleur.
// Il prend le focus clavier de l'île le temps de l'assistant (le prénom, la
// clé), et le rend quand il disparaît.

import { Bridge, IS_TAURI } from "../core/bridge";
import { settingsStore } from "../core/settings-store";
import { SETUP_CARDS, tabsForCards } from "../core/setup-plan";
import { SETUP_STEPS, type SetupController } from "../core/setup";
import type { Settings } from "../core/types";
import { GUM_FAMILY } from "../mascot/gum-family";
import { el } from "./dom";
import { icon } from "./icon";
import { staggerIn, tabOut } from "./motion";
import { reducedMotion, TabPill } from "./tab-pill";
import { mountWhatsNewPanel } from "./whats-new-panel";

/** Animations coupées : Windows le demande, ou la mascotte est en mode Calme. */
function quiet(): boolean {
  return reducedMotion() || settingsStore.current.mascot.calm === true;
}

/** Une courbe « ressort » (dépasse un peu, revient se poser), comme motion.ts. */
const SPRING = "cubic-bezier(0.34, 1.45, 0.5, 1)";

/** Une rangée de choix (« segmented » de l'île) dont la pastille glisse au ressort. */
function choices<T extends string>(options: [T, string][], value: T, onPick: (v: T) => void, label: string): HTMLElement {
  const box = el("div", { class: "segmented setup-seg", role: "radiogroup", "aria-label": label });
  const pill = new TabPill(box);
  const buttons = options.map(([v, text]) => {
    const b = el("button", { class: "seg", role: "radio", onclick: () => pick(v, true) }, text);
    box.append(b);
    return [v, b] as const;
  });
  const pick = (v: T, user: boolean) => {
    for (const [k, b] of buttons) {
      b.classList.toggle("active", k === v);
      b.setAttribute("aria-checked", String(k === v));
    }
    const target = buttons.find(([k]) => k === v)?.[1];
    if (target) {
      if (user && !quiet()) pill.moveTo(target);
      else pill.jumpTo(target);
    }
    if (user) onPick(v);
  };
  // La pastille se place une fois la mise en page faite.
  requestAnimationFrame(() => pick(value, false));
  return box;
}

/** Comment rouvrir l'île ensuite (l'ancien mot de bienvenue le disait). */
function openHint(): string {
  const key = settingsStore.current.island.hotkey;
  return key
    ? `Pour m'ouvrir : la souris sur l'île, ou ${key}. Mon icône est près de l'horloge (clic droit : Réglages, Quitter).`
    : "Pour m'ouvrir : la souris sur l'île. Mon icône est près de l'horloge (clic droit : Réglages, Quitter).";
}

/** Une icône d'onglet qui arrive avec un petit rebond. */
function popIcon(node: HTMLElement, delay: number) {
  if (quiet()) return;
  node.animate([{ opacity: 0, transform: "scale(0.4)" }, { opacity: 1, transform: "none" }], { duration: 420, delay, easing: SPRING, fill: "backwards" });
}

/** Monte le panneau dans `host` ; renvoie la fonction qui défait tout. */
export function mountSetupPanel(host: HTMLElement, ctrl: SetupController): () => void {
  const st = ctrl.state;
  const dots = el("div", { class: "setup-dots", "aria-hidden": "true" });
  const dotEls = SETUP_STEPS.slice(0, 5).map(() => {
    const d = el("span", { class: "setup-dot" });
    dots.append(d);
    return d;
  });
  const pill = new TabPill(dots);
  const counter = el("span", { class: "setup-count" });
  const stage = el("div", { class: "setup-stage" });
  const back = el("button", { class: "btn small ghost", onclick: () => go(-1, false) }, "Retour");
  const skip = el("button", { class: "btn small ghost", onclick: () => go(1, false) }, "Passer");
  const next = el("button", { class: "btn small primary", onclick: () => go(1, true) }, "Continuer");
  const foot = el("div", { class: "setup-foot" }, el("span", { class: "spacer" }), back, skip, next);
  const panel = el("div", { class: "setup" }, el("div", { class: "setup-head" }, dots, counter), stage, foot);
  // Un clic dans le panneau ne doit ni refermer ni ouvrir l'île.
  panel.addEventListener("click", (e) => e.stopPropagation());
  host.append(panel);

  let body: HTMLElement | null = null;
  let undoStep: () => void = () => {};
  /** Le panneau a pris le focus clavier de l'île (à rendre en partant). */
  let focused = false;

  /** Avance (1) ou recule (−1) ; `apply` : enregistrer le choix de l'étape (« Continuer »). */
  function go(dir: number, apply: boolean) {
    if (dir > 0) ctrl.next(apply);
    else ctrl.back();
    draw(dir);
  }

  /** Dessine l'étape courante ; `dir` : d'où elle arrive (0 = sans animation). */
  function draw(dir: number) {
    const step = SETUP_STEPS[st.step];
    const done = step === "done";
    panel.dataset.step = step;
    counter.textContent = done ? "" : `Étape ${st.step + 1} sur 5`;
    dotEls.forEach((d, i) => {
      d.classList.toggle("on", i <= st.step);
    });
    dots.hidden = done;
    const target = dotEls[Math.min(st.step, 4)];
    if (dir && !quiet()) pill.moveTo(target);
    else requestAnimationFrame(() => pill.jumpTo(target));
    back.hidden = st.step === 0 || done;
    skip.hidden = done;
    next.hidden = done;

    undoStep();
    undoStep = () => {};
    const old = body;
    body = el("div", { class: `setup-step step-${step}` });
    undoStep = STEP_VIEWS[step](body) ?? (() => {});
    stage.append(body);
    if (old) {
      if (!dir || quiet()) old.remove();
      else {
        old.style.pointerEvents = "none";
        tabOut(old, dir).finished.then(
          () => old.remove(),
          () => old.remove(),
        );
      }
    }
    if (dir && !quiet()) {
      const fresh = body;
      requestAnimationFrame(() => staggerIn(fresh, 50));
    }
    focusFirst();
  }

  /** Le premier champ de l'étape reçoit le focus (prénom, clé). */
  function focusFirst() {
    const field = body?.querySelector<HTMLInputElement>("input");
    if (!field) return;
    if (IS_TAURI && !focused) {
      focused = true;
      void Bridge.islandSetFocus(true);
    }
    window.setTimeout(() => field.focus({ preventScroll: true }), quiet() ? 0 : 220);
  }

  // ── Les étapes ─────────────────────────────────────────────────────────────

  const STEP_VIEWS: Record<(typeof SETUP_STEPS)[number], (root: HTMLElement) => (() => void) | void> = {
    hello(root) {
      const input = el("input", { type: "text", class: "setup-name", maxlength: 40, placeholder: "Votre prénom", "aria-label": "Votre prénom", autocomplete: "given-name", spellcheck: "false" }) as HTMLInputElement;
      input.value = st.name;
      input.addEventListener("input", () => (st.name = input.value));
      input.addEventListener("focus", () => ctrl.emote("listening"));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") go(1, true);
      });
      const address = el(
        "div",
        { class: "setup-row" },
        el("span", { class: "setup-label" }, "Je vous parle"),
        choices<"vous" | "tu">([["vous", "en vous vouvoyant"], ["tu", "en vous tutoyant"]], st.address, (v) => ctrl.setAddress(v), "Vous / Tu"),
      );
      address.hidden = st.lang !== "fr";
      const status = el("div", { class: "setup-note", "aria-live": "polite" });
      const other = el(
        "button",
        {
          class: "link-btn",
          onclick: async () => {
            status.textContent = "";
            const err = await ctrl.importOther();
            if (err) status.textContent = err;
            else if (st.imported) draw(1);
          },
        },
        "Reprendre la configuration de mon autre PC",
      );
      root.append(
        el("div", { class: "setup-title" }, "Bonjour, je suis Ondine. Et vous ?"),
        input,
        el(
          "div",
          { class: "setup-row" },
          el("span", { class: "setup-label" }, "Langue"),
          choices([["fr", "Français"], ["en", "English"]], st.lang === "en" ? "en" : "fr", (v) => {
            ctrl.setLang(v);
            address.hidden = v !== "fr";
          }, "Langue"),
        ),
        address,
        el("div", { class: "setup-row" }, other),
        status,
      );
    },

    cards(root) {
      const grid = el("div", { class: "setup-cards" });
      const preview = el("div", { class: "setup-preview", "aria-live": "polite" });
      const note = el("div", { class: "setup-note" });
      const shownIcons = new Set<string>();
      const paint = () => {
        grid.replaceChildren();
        for (const card of SETUP_CARDS) {
          const on = st.cards.includes(card.id);
          const found = !!st.detected?.includes(card.id);
          const b = el(
            "button",
            {
              class: `setup-card ${on ? "on" : ""}`,
              "aria-pressed": String(on),
              title: card.desc,
              onclick: () => {
                ctrl.toggleCard(card.id);
                b.classList.toggle("on", st.cards.includes(card.id));
                b.setAttribute("aria-pressed", String(st.cards.includes(card.id)));
                if (!quiet()) b.animate([{ transform: "scale(0.94)" }, { transform: "none" }], { duration: 380, easing: SPRING });
                tabsPreview();
              },
            },
            el("span", { class: "setup-card-icon", "aria-hidden": "true" }, icon(card.icon)),
            el("span", { class: "setup-card-text" }, el("span", { class: "setup-card-label" }, card.label), el("span", { class: "setup-card-desc" }, card.desc)),
            found ? el("span", { class: "setup-found", title: "Trouvé sur ce PC" }, "✓") : null,
          );
          grid.append(b);
        }
        note.textContent =
          st.detected === null
            ? "Je regarde les logiciels de ce PC…"
            : st.detected.length
              ? "Pré-cochées d'après les logiciels de ce PC : rien n'est envoyé."
              : "Cochez ce qui vous ressemble. Le reste se rallume dans Réglages → Onglets.";
        tabsPreview();
      };
      // Les onglets qu'aura l'île (ceux des cartes, ou les 3 de l'île minimale).
      const tabsPreview = () => {
        const ids = tabsForCards(st.cards, ctrl.tabs.map((t) => t.id));
        preview.replaceChildren(el("span", { class: "setup-label" }, `${ids.length} onglets`));
        ids.forEach((id, i) => {
          const t = ctrl.tabs.find((x) => x.id === id);
          if (!t) return;
          const chip = el("span", { class: "setup-tab", title: t.name }, icon(t.icon));
          preview.append(chip);
          // Seuls les nouveaux arrivent avec un rebond.
          if (!shownIcons.has(id)) popIcon(chip, i * 25);
        });
        shownIcons.clear();
        ids.forEach((id) => shownIcons.add(id));
      };
      root.append(el("div", { class: "setup-title" }, "Vous faites quoi sur ce PC ?"), grid, preview, note);
      paint();
      // La détection des logiciels arrive après : les cartes se cochent.
      return ctrl.onChange(() => paint());
    },

    mascot(root) {
      root.append(el("div", { class: "setup-title" }, "Qui vit dans l'île ?"));
      const slot = el("div", { class: "setup-mascots" });
      root.append(slot);
      return mountWhatsNewPanel(slot, {
        mascots: ["goutte-gomme", ...GUM_FAMILY.map((c) => c.id)],
        text: "",
        hint: "Cliquez sur une mascotte, puis « Adopter ». Vous la changerez quand vous voudrez dans Réglages → Mascotte.",
        onAdopt: () => window.setTimeout(() => ctrl.emote("wave"), 400),
      });
    },

    place(root) {
      const s = settingsStore.current.island;
      const sample = el("div", { class: "setup-preview" });
      for (const t of ctrl.tabs.slice(0, 6)) sample.append(el("span", { class: "setup-tab", title: t.name }, icon(t.icon)));
      root.append(
        el("div", { class: "setup-title" }, "Où vit l'île ?"),
        el(
          "div",
          { class: "setup-row" },
          el("span", { class: "setup-label" }, "Bord de l'écran"),
          choices<Settings["island"]["edge"]>([["top", "En haut"], ["bottom", "En bas"], ["left", "À gauche"], ["right", "À droite"]], s.edge, (v) => ctrl.setEdge(v), "Bord de l'écran"),
        ),
        el(
          "div",
          { class: "setup-row" },
          el("span", { class: "setup-label" }, "Style des icônes"),
          choices<Settings["island"]["iconPack"]>([["color", "En couleur"], ["line", "Épurées"]], s.iconPack === "line" ? "line" : "color", (v) => ctrl.setIcons(v), "Style des icônes"),
        ),
        sample,
        el("div", { class: "setup-note" }, "Vous pourrez aussi attraper l'île par son bord et la poser ailleurs."),
      );
    },

    key(root) {
      const input = el("input", { type: "password", class: "setup-name", placeholder: "sk-ant-…", "aria-label": "Clé de l'API de Claude", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
      const status = el("div", { class: "setup-note", "aria-live": "polite" }, st.keySaved ? "Une clé est déjà enregistrée sur ce PC." : "");
      const save = async () => {
        const err = await ctrl.saveKey(input.value);
        input.value = "";
        status.textContent = err ?? "Clé enregistrée dans le Gestionnaire d'identifiants de Windows.";
        if (!err) ctrl.emote("success");
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void save();
      });
      root.append(
        el("div", { class: "setup-title" }, "Parler à Ondine"),
        el("div", { class: "setup-text" }, "Ondine répond grâce à l'API de Claude. Collez votre clé maintenant, ou plus tard dans Réglages → Parler à Ondine."),
        el("div", { class: "setup-row" }, input, el("button", { class: "btn small", onclick: () => void save() }, "Enregistrer")),
        status,
        el("div", { class: "setup-note" }, "La clé reste sur ce PC, dans le coffre de Windows, jamais dans les réglages."),
      );
    },

    done(root) {
      const name = st.name.trim();
      const ids = ctrl.shownTabs();
      const row = el("div", { class: "setup-preview" });
      ids.forEach((id, i) => {
        const t = ctrl.tabs.find((x) => x.id === id);
        if (!t) return;
        const chip = el("span", { class: "setup-tab", title: t.name }, icon(t.icon));
        row.append(chip);
        popIcon(chip, 120 + i * 40);
      });
      root.append(
        el("div", { class: "setup-title" }, name ? `C'est prêt, ${name} !` : "C'est prêt !"),
        el("div", { class: "setup-text" }, st.imported ? "Vos réglages de l'autre PC sont là." : "Ondine vous proposera d'autres onglets au bon moment, jamais sans vous demander."),
        row,
        el("div", { class: "setup-note" }, openHint()),
        el(
          "div",
          { class: "setup-row end" },
          el("button", { class: "btn small ghost", onclick: () => ctrl.finish(false) }, "Fermer"),
          el("button", { class: "btn small primary", onclick: () => ctrl.finish(true) }, "Ouvrir l'île"),
        ),
      );
      ctrl.emote(st.imported ? "success" : "celebrate");
    },
  };

  draw(0);

  return () => {
    undoStep();
    pill.stop();
    panel.remove();
    // Le focus clavier revient à la fenêtre d'avant (sauf si l'île s'ouvre : elle le reprend).
    if (focused) void Bridge.islandSetFocus(false);
  };
}
