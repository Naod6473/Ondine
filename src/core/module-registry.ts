// Le registre des modules, côté front.
//
// Il démarre les modules activés, leur donne leur `ModuleApi`, monte leurs vues,
// et les isole : toute erreur d'un module (dans setup, une vue, un abonné du bus,
// une cible de dépôt) est rattrapée, notée dans le journal et comptée. Après
// MAX_FAILURES erreurs, le module est arrêté jusqu'au prochain démarrage et
// l'île l'annonce. Le reste de l'île continue normalement.

import { Bridge } from "./bridge";
import { Bus, topicMatches } from "./bus";
import { errorText, logger } from "./log";
import type { DropTarget, IslandModule, ModuleApi, ViewKind } from "./module-types";
import type { NotificationQueue } from "./notifications";
import { settingsStore } from "./settings-store";

const MAX_FAILURES = 3;
const log = logger("modules");

interface Running {
  module: IslandModule;
  api: ModuleApi;
  /** Nettoyages à faire à l'arrêt (setup, abonnements…). */
  cleanups: (() => void)[];
}

export class ModuleRegistry {
  private running = new Map<string, Running>();
  private failures = new Map<string, number>();
  /** Modules mis à l'écart pendant cette session. */
  private benched = new Set<string>();
  /** Prévient l'île quand la liste des modules actifs change (pour redessiner). */
  onChange: () => void = () => {};
  /** Prévient l'île qu'un module veut peut-être (ou ne veut plus) la vue compacte. */
  onCompactChange: () => void = () => {};
  /** Un module demande à refermer l'île. */
  onCloseRequest: () => void = () => {};

  constructor(
    private readonly all: IslandModule[],
    private readonly bus: Bus,
    private readonly notifications: NotificationQueue,
  ) {
    // Erreurs dans un abonné du bus : on les attribue à son propriétaire.
    bus.onHandlerError = (owner, err, msg) => this.fail(owner, err, `bus « ${msg.topic} »`);
    // Un module Rust qui plante : le Rust prévient par le bus.
    bus.on("module.crashed", (msg) => {
      const p = msg.payload as { module: string; disabled: boolean };
      const name = this.all.find((m) => m.manifest.id === p.module)?.manifest.name ?? p.module;
      this.notifications.push({
        moduleId: "island",
        title: p.disabled ? `${name} a été mis à l'écart` : `${name} a rencontré une erreur`,
        body: p.disabled ? "Trop de plantages côté Rust. Il revient au prochain démarrage." : "L'île continue normalement.",
        icon: "⚠️",
        priority: p.disabled ? "high" : "normal",
        key: `crash-${p.module}`,
      });
    });
    settingsStore.onChange(() => this.sync());
  }

  /** Démarre les modules activés, arrête les autres. Appelé aussi à chaque changement de réglages. */
  sync() {
    for (const module of this.all) {
      const id = module.manifest.id;
      const wanted = settingsStore.moduleEnabled(id) && !this.benched.has(id);
      if (wanted && !this.running.has(id)) this.start(module);
      if (!wanted && this.running.has(id)) this.stop(id);
    }
    this.onChange();
  }

  /** Modules actifs ayant une vue de ce type, dans l'ordre de déclaration. */
  withView(kind: Exclude<ViewKind, "drop">): Running[] {
    return [...this.running.values()].filter((r) => {
      if (!r.module.views?.[kind]) return false;
      const when = r.module.views.compactWhen;
      if (kind !== "compact" || !when) return true;
      try {
        return when(r.api);
      } catch (err) {
        this.fail(r.module.manifest.id, err, "compactWhen");
        return false;
      }
    });
  }

  /** Noms des modules mis à l'écart pendant cette session (trop de plantages). */
  benchedNames(): string[] {
    return this.all.filter((m) => this.benched.has(m.manifest.id)).map((m) => m.manifest.name);
  }

  /** Toutes les cibles de dépôt des modules actifs. */
  dropTargets(): { target: DropTarget; moduleId: string }[] {
    const out: { target: DropTarget; moduleId: string }[] = [];
    for (const r of this.running.values()) {
      const id = r.module.manifest.id;
      const drop = r.module.views?.drop;
      let targets: DropTarget[] = [];
      try {
        targets = typeof drop === "function" ? drop(r.api) : (drop ?? []);
      } catch (err) {
        this.fail(id, err, "cibles de dépôt");
      }
      for (const target of targets) out.push({ target, moduleId: id });
    }
    return out;
  }

  /** Monte la vue `kind` d'un module dans `el`, à l'abri de ses erreurs. Renvoie le démontage. */
  mountView(moduleId: string, kind: Exclude<ViewKind, "drop">, el: HTMLElement): () => void {
    const r = this.running.get(moduleId);
    const mount = r?.module.views?.[kind];
    if (!r || !mount) return () => {};
    try {
      const cleanup = mount(el, r.api);
      return () => this.guard(moduleId, `démontage ${kind}`, () => cleanup?.());
    } catch (err) {
      this.fail(moduleId, err, `vue ${kind}`);
      el.textContent = "Cette vue a rencontré une erreur.";
      return () => {};
    }
  }

  /** Fichiers lâchés sur une cible de dépôt. */
  async drop(moduleId: string, target: DropTarget, paths: string[]) {
    const r = this.running.get(moduleId);
    if (!r) return;
    try {
      await target.onDrop(paths, r.api);
    } catch (err) {
      this.fail(moduleId, err, `dépôt ${target.id}`);
    }
  }

  private start(module: IslandModule) {
    const id = module.manifest.id;
    const api = this.makeApi(module);
    const running: Running = { module, api, cleanups: [] };
    this.running.set(id, running);
    try {
      const cleanup = module.setup?.(api);
      if (cleanup) running.cleanups.push(cleanup);
      log.info(`module démarré : ${id}`);
    } catch (err) {
      this.fail(id, err, "démarrage");
    }
  }

  private stop(id: string) {
    const r = this.running.get(id);
    if (!r) return;
    this.running.delete(id);
    for (const c of r.cleanups) this.guard(id, "arrêt", c);
    log.info(`module arrêté : ${id}`);
  }

  private guard(id: string, what: string, fn: () => void) {
    try {
      fn();
    } catch (err) {
      this.fail(id, err, what);
    }
  }

  private fail(id: string, err: unknown, what: string) {
    const n = (this.failures.get(id) ?? 0) + 1;
    this.failures.set(id, n);
    log.error(`${id} : erreur pendant ${what} (${n}/${MAX_FAILURES}) : ${errorText(err)}`);
    const name = this.all.find((m) => m.manifest.id === id)?.manifest.name ?? id;
    if (n < MAX_FAILURES) {
      this.notifications.push({
        moduleId: "island",
        title: `${name} a rencontré une erreur (${n}/${MAX_FAILURES})`,
        body: "L'île continue normalement.",
        icon: "⚠️",
        priority: "normal",
        key: `crash-${id}`,
      });
    }
    if (n >= MAX_FAILURES && !this.benched.has(id) && this.running.has(id)) {
      this.benched.add(id);
      this.stop(id);
      this.onChange();
      this.notifications.push({
        moduleId: "island",
        title: `${name} a été mis à l'écart`,
        body: "Il a planté plusieurs fois. Il revient au prochain démarrage.",
        icon: "⚠️",
        priority: "high",
        key: `crash-${id}`,
      });
    }
  }

  /** L'API d'un module : chaque appel vérifie ce que son manifeste déclare. */
  private makeApi(module: IslandModule): ModuleApi {
    const m = module.manifest;
    const id = m.id;
    const self = this;
    const own = () => self.running.get(id)?.cleanups ?? [];
    return {
      manifest: m,
      emit(topic, payload = null) {
        if (!m.events.emits.some((p) => topicMatches(p, topic))) {
          log.warn(`${id} publie « ${topic} » sans l'avoir déclaré : ignoré`);
          return;
        }
        self.bus.emit(topic, payload, id);
      },
      on(pattern, handler) {
        // Le motif demandé doit être couvert par un motif déclaré.
        const declared = m.events.listens.some((p) => p === pattern || topicMatches(p, pattern.replace(/\*$/, "")));
        if (!declared) {
          log.warn(`${id} écoute « ${pattern} » sans l'avoir déclaré : refusé`);
          return () => {};
        }
        const off = self.bus.on(pattern, handler, id);
        own().push(off);
        return off;
      },
      async invoke<T>(command: string, args?: unknown) {
        if (!m.commands.includes(command)) throw new Error(`commande non déclarée : ${command}`);
        return Bridge.moduleInvoke<T>(id, command, args ?? null);
      },
      settings: () => settingsStore.moduleValues(m),
      onSettingsChange(fn) {
        const off = settingsStore.onChange(() => self.guard(id, "réglages", () => fn(settingsStore.moduleValues(m))));
        own().push(off);
        return off;
      },
      notify: (req) => self.notifications.push({ ...req, moduleId: id }),
      handler(fn) {
        return (...args) => {
          try {
            const r = fn(...args);
            if (r instanceof Promise) r.catch((err) => self.fail(id, err, "action"));
          } catch (err) {
            self.fail(id, err, "action");
          }
        };
      },
      refreshCompact: () => self.onCompactChange(),
      closeIsland: () => self.onCloseRequest(),
      log: logger(id),
    };
  }
}
