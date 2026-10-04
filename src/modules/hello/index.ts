// Module d'exemple « hello ». Il montre, en petit, tout ce qu'un module peut faire :
//   - une vue compacte et une vue agrandie ;
//   - une cible de dépôt (fichiers glissés sur l'île) ;
//   - appeler son code Rust (api.invoke) ;
//   - publier et écouter sur le bus (api.emit / api.on) ;
//   - demander l'attention de l'île (api.notify) avec différentes priorités ;
//   - utiliser ses réglages (générés depuis manifest.json) ;
//   - proposer « Annuler » (service d'annulation, côté Rust) ;
//   - planter sans faire tomber l'île.

import manifest from "./manifest.json";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { errorText } from "../../core/log";
import { el } from "../../island/dom";

function greeting(api: ModuleApi): string {
  const s = api.settings();
  return s.tone === "formal" ? `Bonjour ${s.name}.` : `Salut ${s.name} 👋`;
}

export const hello: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    if (api.settings().greetOnStart) {
      api.notify({ title: greeting(api), body: "L'île est prête.", icon: "👋", priority: "low" });
    }
    // Le Rust répond "hello.pong" quand on publie "hello.ping".
    api.on("hello.pong", (msg) => {
      const p = msg.payload as { counter: number };
      api.notify({ title: "Pong !", body: `Le Rust a répondu (compteur : ${p.counter}).`, icon: "🏓" });
    });
  },

  views: {
    compact(root, api) {
      root.append(el("span", { class: "hello-compact" }, greeting(api)));
      const off = api.onSettingsChange(() => {
        root.textContent = "";
        root.append(el("span", { class: "hello-compact" }, greeting(api)));
      });
      return off;
    },

    expanded(root, api) {
      const out = el("div", { class: "hello-out" }, "Clique sur un bouton pour essayer le socle.");
      const show = (text: string) => (out.textContent = text);

      // api.handler : une erreur dans un clic est attribuée au module (et comptée).
      // Ici on affiche aussi l'erreur dans la vue, puis on la relance pour le registre.
      const button = (label: string, run: () => void | Promise<void>) =>
        el(
          "button",
          {
            class: "btn",
            onclick: api.handler(async () => {
              try {
                await run();
              } catch (e) {
                show(`Erreur : ${errorText(e)}`);
                throw e;
              }
            }),
          },
          label,
        );

      root.append(
        el("h3", {}, greeting(api)),
        el(
          "div",
          { class: "btn-row" },
          button("Appeler le Rust", async () => {
            const r = await api.invoke<{ message: string }>("greet", { name: api.settings().name });
            show(r.message);
          }),
          button("Ping sur le bus", () => {
            api.emit("hello.ping");
            show("« hello.ping » publié, le Rust va répondre « hello.pong ».");
          }),
          button("Tâche simulée", () => {
            const secs = Number(api.settings().taskSeconds) || 2;
            api.emit("task.started", { label: "Tâche d'exemple" });
            show(`La mascotte travaille pendant ${secs} s…`);
            setTimeout(() => {
              api.emit("task.finished", { label: "Tâche d'exemple" });
              show("Tâche terminée : la mascotte fête ça.");
            }, secs * 1000);
          }),
          button("Compteur +1 (annulable)", async () => {
            const r = await api.invoke<{ value: number }>("bump");
            show(`Compteur : ${r.value}. Tu as quelques secondes pour annuler.`);
          }),
        ),
        el(
          "div",
          { class: "btn-row" },
          button("Notif. basse", () => void api.notify({ title: "Notification basse", icon: "💬", priority: "low" })),
          button("Notif. haute", () =>
            void api.notify({ title: "Notification haute", body: "Elle passe devant et ouvre l'île en alerte.", icon: "🔔", priority: "high" }),
          ),
          button("Alerte critique", () =>
            void api.notify({
              title: "Alerte critique",
              body: "Reste affichée jusqu'à ce que tu la fermes.",
              icon: "🚨",
              priority: "critical",
              sticky: true,
              actions: [{ label: "Compris", run: () => void show("Alerte fermée.") }],
            }),
          ),
          button("Faire planter (front)", () => {
            throw new Error("plantage volontaire côté front");
          }),
          button("Faire planter (Rust)", async () => {
            await api.invoke("crash");
          }),
        ),
        out,
      );
    },

    drop: [
      {
        id: "hello-count",
        label: "Compter",
        icon: "🔢",
        async onDrop(paths, api) {
          const r = await api.invoke<{ count: number; names: string[] }>("count", { paths });
          api.notify({
            title: `${r.count} élément(s) reçu(s)`,
            body: r.names.slice(0, 3).join(", ") + (r.count > 3 ? "…" : ""),
            icon: "🔢",
          });
        },
      },
    ],
  },
};
