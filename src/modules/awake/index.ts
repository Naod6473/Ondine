// Module « Rester éveillé » (id `awake`), côté île. Le travail est dans le
// Rust (src-tauri/src/modules/awake.rs : un fil qui tient la demande faite à
// Windows et fait avancer l'arrêt programmé). Ici :
//   - l'onglet : deux volets, « Éveil » (30 min, 1 h, 2 h, sans limite,
//     jusqu'à une heure, fin du téléchargement, fin de l'agent, écran allumé)
//     et « Arrêt programmé » (éteindre, veille, redémarrer, verrouiller ; dans
//     N min, à une heure, à la fin du téléchargement / de l'agent), toujours
//     avec une confirmation avant de programmer ;
//   - la mini-île : « Éveillé · 1:23:45 » (réglage `pill`) ou le compte à
//     rebours de l'arrêt programmé (toujours), annulable d'un clic ;
//   - le dernier avertissement (`awake.warn`, 60 s avant) : une alerte
//     « critical » qui compte les secondes, avec « Annuler » et « Encore 15 min ».
// La tasse d'Ondine : mascot-state.ts écoute `awake.state` (champ `coffee`).

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { pacedInterval, setText } from "../../core/perf";
import { el } from "../../island/dom";
import { reducedMotion, TabPill } from "../../island/tab-pill";
import {
  ACTION_ICONS,
  ACTION_LABELS,
  ACTIONS,
  type AwakeState,
  cleanState,
  compactLine,
  confirmText,
  countdown,
  IDLE_STATE,
  KEEP_PRESETS,
  keepText,
  nextClock,
  type PlanChoice,
  planArgs,
  planText,
  type PowerAction,
  warnTitle,
} from "./logic";
import "../../styles/awake.css";

let state: AwakeState = IDLE_STATE;
/** Les vues ouvertes qui se redessinent quand l'état change. */
const watchers = new Set<() => void>();
type Pane = "keep" | "plan";
let pane: Pane = "keep";

function fail(api: ModuleApi, err: unknown) {
  api.notify({ title: "Rester éveillé", body: errorText(err), icon: "⚠️", priority: "normal", key: "awake-error" });
}

/** Une commande du Rust, qui renvoie le nouvel état. */
async function run(api: ModuleApi, command: string, args?: unknown) {
  try {
    apply(api, await api.invoke<AwakeState>(command, args));
  } catch (err) {
    fail(api, err);
  }
}

function apply(api: ModuleApi, raw: unknown) {
  state = cleanState(raw);
  api.refreshCompact();
  for (const w of watchers) w();
}

/** Le dernier avertissement : les secondes défilent dans l'alerte. */
function warn(api: ModuleApi, action: PowerAction, at: number) {
  api.notify({
    title: warnTitle(action, (at - Date.now()) / 1000),
    icon: ACTION_ICONS[action],
    priority: "critical",
    sticky: true,
    key: "awake-warn",
    // Dans l'alerte, les secondes défilent (le titre seul reste en compact).
    content: (host) => {
      const left = el("strong", { class: "awake-warn-left" });
      const tick = () => setText(left, countdown(at - Date.now()));
      tick();
      host.append(left, el("span", { class: "awake-warn-note" }, "Enregistrez votre travail : les applis ne sont pas fermées de force."));
      const id = window.setInterval(tick, 1000);
      return () => window.clearInterval(id);
    },
    actions: [
      { label: "Annuler", run: () => run(api, "cancel_plan") },
      { label: "Encore 15 min", run: () => run(api, "snooze_plan") },
    ],
  });
}

export const awake: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    const offs = [
      api.on("awake.state", (msg) => {
        const before = state.plan;
        apply(api, msg.payload);
        // Annulé ailleurs (Réglages, autre bouton) pendant l'avertissement : on le retire.
        if (before?.warned && !state.plan) api.notify({ title: "Arrêt programmé annulé", icon: "✅", priority: "low", key: "awake-warn", durationMs: 2500 });
      }),
      api.on("awake.warn", (msg) => {
        const p = msg.payload as { action?: PowerAction; at?: number } | null;
        if (p?.action && ACTIONS.includes(p.action) && typeof p.at === "number") warn(api, p.action, p.at);
      }),
      api.on("awake.error", (msg) => fail(api, (msg.payload as { message?: string } | null)?.message ?? "")),
    ];
    // L'état actuel (fenêtre rechargée) ; publié pour la tasse d'Ondine.
    void api
      .invoke<AwakeState>("status")
      .then((s) => {
        apply(api, s);
        api.emit("awake.state", state);
      })
      .catch(() => {});
    return () => {
      offs.forEach((off) => off());
      state = IDLE_STATE;
      api.emit("awake.state", IDLE_STATE);
    };
  },

  views: {
    compactWhen: (api) => Boolean(state.plan) || (Boolean(state.keep) && api.settings().pill !== false),

    compact(root, api) {
      const icon = el("span", { class: "awake-compact-icon", "aria-hidden": "true" });
      const text = el("span", { class: "awake-compact-text" });
      const stop = el("button", { class: "awake-compact-stop" });
      stop.addEventListener(
        "click",
        api.handler(() => run(api, state.plan ? "cancel_plan" : "stop")),
      );
      const box = el("div", { class: "awake-compact", role: "status" }, icon, text, stop);
      root.append(box);
      const draw = () => {
        const line = compactLine(state, Date.now());
        if (!line) return;
        box.classList.toggle("plan", line.kind === "plan");
        setText(icon, line.icon);
        setText(text, line.text);
        setText(stop, line.kind === "plan" ? "Annuler" : "Arrêter");
      };
      draw();
      watchers.add(draw);
      const stopTick = pacedInterval(draw, "homeTick", true);
      return () => {
        watchers.delete(draw);
        stopTick();
      };
    },

    expanded(root, api) {
      const seg = el("div", { class: "segmented awake-seg" });
      const buttons = new Map<Pane, HTMLElement>();
      for (const [id, label] of [
        ["keep", "☕ Éveil"],
        ["plan", "📴 Arrêt programmé"],
      ] as [Pane, string][]) {
        const b = el("button", { class: "seg", onclick: api.handler(() => show(id)) }, label);
        buttons.set(id, b);
        seg.append(b);
      }
      const pill = new TabPill(seg);
      const body = el("div", { class: "awake-body" });
      root.append(seg, body);
      let tick: () => void = () => {};

      const show = (id: Pane, animate = true) => {
        pane = id;
        for (const [pid, b] of buttons) b.classList.toggle("active", pid === id);
        if (animate) pill.moveTo(buttons.get(id)!);
        redraw();
        if (animate && !reducedMotion()) {
          body.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
        }
      };
      const redraw = () => {
        body.replaceChildren();
        tick = pane === "keep" ? keepPane(api, body) : planPane(api, body, redraw);
      };
      show(pane, false);
      requestAnimationFrame(() => pill.jumpTo(buttons.get(pane)!));
      // Un changement d'état (ici ou ailleurs) : on redessine ; le temps qui reste avance seul.
      watchers.add(redraw);
      const stopTick = pacedInterval(() => tick(), "homeTick", true);
      return () => {
        watchers.delete(redraw);
        stopTick();
      };
    },
  },
};

/** Une rangée de boutons-pastilles. */
function chips(...children: (HTMLElement | null)[]): HTMLElement {
  return el("div", { class: "awake-chips" }, ...children);
}

/** Le volet « Éveil ». Renvoie ce qui fait avancer le temps qui reste. */
function keepPane(api: ModuleApi, body: HTMLElement): () => void {
  const k = state.keep;
  const settings = api.settings();
  const display = el("input", { type: "checkbox", class: "awake-check" });
  display.checked = k ? k.display : settings.display === true;
  const keep = (args: Record<string, unknown>) => run(api, "keep", { ...args, display: display.checked });
  // Allumé : on change l'écran sans changer la durée.
  display.addEventListener(
    "change",
    api.handler(() => {
      if (!state.keep) return;
      const s = state.keep;
      void keep(s.until === "at" ? { until: "at", at: s.at } : { until: s.until });
    }),
  );

  const left = el("span", { class: "awake-left" });
  const status = k
    ? el(
        "div",
        { class: "awake-status on" },
        el("span", { class: "awake-cup", "aria-hidden": "true" }, "☕"),
        el("div", { class: "awake-status-text" }, el("strong", {}, "Le PC reste éveillé"), el("span", {}, keepText(k)), left),
        el("button", { class: "btn", onclick: api.handler(() => run(api, "stop")) }, "Arrêter"),
      )
    : el("div", { class: "awake-status" }, el("div", { class: "awake-status-text" }, el("strong", {}, "Veille habituelle"), el("span", {}, "Le PC suit les réglages de veille de Windows.")));

  const presets = chips(
    ...KEEP_PRESETS.map((p) => el("button", { class: "btn", onclick: api.handler(() => keep(p.minutes ? { until: "minutes", minutes: p.minutes } : { until: "forever" })) }, p.label)),
  );
  const clock = el("input", { type: "time", class: "awake-time", "aria-label": "Jusqu'à quelle heure", value: "18:00" });
  const until = el(
    "button",
    {
      class: "btn",
      onclick: api.handler(() => {
        const at = nextClock(clock.value, Date.now());
        if (at === null) return fail(api, "Tapez une heure comme 18:30.");
        void keep({ until: "at", at });
      }),
    },
    "Jusqu'à cette heure",
  );
  const waitFor = chips(
    el("button", { class: "btn", disabled: !state.downloading, title: state.downloading ? "" : "Aucun téléchargement en cours", onclick: api.handler(() => keep({ until: "download" })) }, "⬇️ Fin du téléchargement"),
    el("button", { class: "btn", disabled: !state.agentBusy, title: state.agentBusy ? "" : "Aucun agent IA au travail", onclick: api.handler(() => keep({ until: "agent" })) }, "🤖 Fin de l'agent IA"),
  );
  body.append(
    status,
    presets,
    chips(clock, until),
    waitFor,
    el("label", { class: "awake-line" }, display, el("span", {}, "Garder aussi l'écran allumé")),
  );
  const tick = () => {
    const s = state.keep;
    setText(left, s?.until === "at" && s.at ? `Encore ${countdown(s.at - Date.now())}` : "");
  };
  tick();
  return tick;
}

/** Ce qui est en train d'être programmé (gardé d'un dessin à l'autre). */
let draft: PlanChoice | null = null;
let confirming = false;

/** Le volet « Arrêt programmé ». */
function planPane(api: ModuleApi, body: HTMLElement, redraw: () => void): () => void {
  const p = state.plan;
  if (p) {
    const left = el("span", { class: "awake-left" });
    body.append(
      el(
        "div",
        { class: "awake-status on plan" },
        el("span", { class: "awake-cup", "aria-hidden": "true" }, ACTION_ICONS[p.action]),
        el("div", { class: "awake-status-text" }, el("strong", {}, planText(p)), left),
      ),
      chips(
        el("button", { class: "btn primary", onclick: api.handler(() => run(api, "cancel_plan")) }, "Annuler l'arrêt programmé"),
        p.when === "at" ? el("button", { class: "btn", onclick: api.handler(() => run(api, "snooze_plan")) }, "Encore 15 min") : null,
      ),
    );
    const tick = () => setText(left, p.when === "at" && p.at ? `Dans ${countdown(p.at - Date.now())}` : "");
    tick();
    return tick;
  }

  const settings = api.settings();
  const action = (ACTIONS as string[]).includes(String(settings.planAction)) ? (settings.planAction as PowerAction) : "shutdown";
  const c: PlanChoice = (draft ??= { action, when: "minutes", minutes: Number(settings.planMinutes) || 60, clock: "23:00" });
  const pick = (patch: Partial<PlanChoice>) => {
    Object.assign(c, patch);
    confirming = false;
    redraw();
  };
  const actions = chips(
    ...ACTIONS.map((a) => el("button", { class: `btn${c.action === a ? " on" : ""}`, "aria-pressed": String(c.action === a), onclick: api.handler(() => pick({ action: a })) }, `${ACTION_ICONS[a]} ${ACTION_LABELS[a]}`)),
  );
  const minutes = el("input", { type: "number", class: "awake-num", min: "1", max: "1440", step: "5", value: String(c.minutes ?? 60), "aria-label": "Minutes" });
  minutes.addEventListener("input", () => (c.minutes = Number(minutes.value)));
  minutes.addEventListener("focus", () => c.when !== "minutes" && pick({ when: "minutes" }));
  const clock = el("input", { type: "time", class: "awake-time", value: c.clock ?? "23:00", "aria-label": "À quelle heure" });
  clock.addEventListener("input", () => (c.clock = clock.value));
  clock.addEventListener("focus", () => c.when !== "at" && pick({ when: "at" }));
  const whenBtn = (when: PlanChoice["when"], label: string, disabled = false, title = "") =>
    el("button", { class: `btn${c.when === when ? " on" : ""}`, "aria-pressed": String(c.when === when), disabled, title, onclick: api.handler(() => pick({ when })) }, label);
  const whens = el(
    "div",
    { class: "awake-whens" },
    chips(whenBtn("minutes", "Dans"), minutes, el("span", { class: "muted" }, "min")),
    chips(whenBtn("at", "À"), clock),
    chips(
      whenBtn("download", "⬇️ Fin du téléchargement", !state.downloading && c.when !== "download", state.downloading ? "" : "Aucun téléchargement en cours"),
      whenBtn("agent", "🤖 Fin de l'agent IA", !state.agentBusy && c.when !== "agent", state.agentBusy ? "" : "Aucun agent IA au travail"),
    ),
  );
  const error = el("p", { class: "awake-error", role: "alert" });
  let foot: HTMLElement;
  if (!confirming) {
    foot = chips(
      el(
        "button",
        {
          class: "btn primary",
          onclick: api.handler(() => {
            const check = planArgs(c, Date.now());
            if ("error" in check) return setText(error, check.error);
            confirming = true;
            redraw();
          }),
        },
        "Programmer…",
      ),
    );
  } else {
    // La confirmation, obligatoire : la question exacte, puis deux boutons.
    foot = el(
      "div",
      { class: "awake-confirm", role: "group", "aria-label": "Confirmation" },
      el("strong", {}, confirmText(c)),
      el("span", { class: "muted" }, "Un dernier avertissement une minute avant, annulable. Les applis ne sont pas fermées de force."),
      chips(
        el(
          "button",
          {
            class: "btn primary",
            onclick: api.handler(async () => {
              const check = planArgs(c, Date.now());
              if ("error" in check) return setText(error, check.error);
              confirming = false;
              draft = null;
              await run(api, "plan", check.args);
            }),
          },
          "Confirmer",
        ),
        el("button", { class: "btn", onclick: api.handler(() => ((confirming = false), redraw())) }, "Annuler"),
      ),
    );
  }
  body.append(actions, whens, foot, error);
  return () => {};
}
