// Contrôles → Outils → « Mode nettoyage » (1.2.5) : pendant que le clavier et
// la souris sont bloqués (Rust : platform/clean_lock.rs), l'île montre le
// temps qui reste et Ondine qui passe le chiffon. "controls.clean" {left}
// arrive chaque seconde, puis {done, early}.

import type { ModuleApi } from "../../core/module-types";
import { el } from "../../island/dom";
import type { Page } from "./blocks";
import { fail } from "./extras";

export function cleanPage(api: ModuleApi, seconds: number, onDone: () => void): Page {
  const count = el("b", { class: "ctl-clean-count" }, `${seconds} s`);
  const bar = el("i");
  const node = el(
    "div",
    { class: "ctl-page ctl-clean", "data-island-fit": true, role: "status", "aria-live": "polite" },
    el("div", { class: "ctl-clean-drop", "aria-hidden": "true" }, el("i", { class: "eye l" }), el("i", { class: "eye r" }), el("span", { class: "ctl-clean-cloth" })),
    count,
    el("span", { class: "ctl-clean-bar", "aria-hidden": "true" }, bar),
    el("p", { class: "muted ctl-page-note" }, "Clavier et souris bloqués : vous pouvez les essuyer. Pour arrêter avant, maintenez Échap 2 secondes."),
  );
  let total = seconds;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    off();
    onDone();
  };
  const off = api.on("controls.clean", (msg) => {
    const p = (msg.payload ?? {}) as { left?: number; done?: boolean; early?: boolean };
    if (p.done) {
      api.notify({ title: p.early ? "Nettoyage arrêté : clavier et souris de retour" : "C'est propre ! Clavier et souris de retour", icon: "✨", priority: "low", key: "controls-clean" });
      finish();
      return;
    }
    if (typeof p.left === "number") {
      total = Math.max(total, p.left);
      count.textContent = `${p.left} s`;
      bar.style.width = `${Math.round(((total - p.left) / total) * 100)}%`;
    }
  });
  api
    .invoke<{ seconds: number }>("clean_start", { seconds })
    .then((r) => {
      total = r.seconds;
      count.textContent = `${r.seconds} s`;
    })
    .catch((err) => {
      fail(api, err);
      finish();
    });
  return { node, stop: () => off() };
}
