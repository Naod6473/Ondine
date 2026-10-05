// Module « Accès distants » : favoris Bureau à distance (RDP) et SSH.
//
// Le Rust (src-tauri/src/modules/remote.rs) enregistre les favoris, vérifie
// chaque adresse et lance mstsc.exe ou ssh.exe. Ici : la connexion rapide
// (on tape une adresse, on clique RDP ou SSH), la liste des favoris avec un
// point vert / rouge selon que le serveur répond, et le petit formulaire
// pour ajouter ou modifier un favori.

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";
import { reducedMotion } from "../../island/tab-pill";

type Kind = "rdp" | "ssh";

interface Favorite {
  id: number;
  name: string;
  kind: Kind;
  host: string;
  port: number | null;
  user: string;
}

/** Ce qu'on sait de chaque serveur : en ligne (avec le temps de réponse), hors ligne, en cours. */
type Probe = { state: "wait" } | { state: "up"; ms: number } | { state: "down" };

const KIND_ICON: Record<Kind, string> = { rdp: "🖥️", ssh: "⌨️" };
const KIND_LABEL: Record<Kind, string> = { rdp: "RDP", ssh: "SSH" };
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

let favorites: Favorite[] = [];
const probes = new Map<number, Probe>();
const redraws = new Set<() => void>();

async function refresh(api: ModuleApi) {
  try {
    favorites = (await api.invoke<{ favorites: Favorite[] }>("list")).favorites;
  } catch {
    return; // hors de l'appli (navigateur)
  }
  for (const r of redraws) r();
}

function fail(api: ModuleApi, err: unknown) {
  api.notify({ title: "Accès distants", body: errorText(err), icon: "⚠️", priority: "low", key: "remote-error" });
}

/** « admin@srv-01:2222 » */
function target(f: Pick<Favorite, "host" | "port" | "user">): string {
  return `${f.user ? `${f.user}@` : ""}${f.host}${f.port ? `:${f.port}` : ""}`;
}

/** Teste tous les favoris en même temps ; chaque point se met à jour dès sa réponse. */
function probeAll(api: ModuleApi) {
  for (const f of favorites) {
    probes.set(f.id, { state: "wait" });
    api
      .invoke<{ online: boolean; ms?: number }>("probe", { id: f.id })
      .then((r) => probes.set(f.id, r.online ? { state: "up", ms: r.ms ?? 0 } : { state: "down" }))
      .catch(() => probes.delete(f.id))
      .finally(() => redraws.forEach((r) => r()));
  }
  redraws.forEach((r) => r());
}

export const remote: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    api.on("remote.changed", () => void refresh(api));
    // Le lanceur apprend la liste par le bus (numéro, nom, type ; pas l'adresse).
    void refresh(api).then(() =>
      api.emit("remote.changed", { favorites: favorites.map(({ id, name, kind }) => ({ id, name, kind })) }),
    );
  },

  views: {
    expanded(root, api) {
      // ── Connexion rapide ───────────────────────────────────────────────────
      const quick = el("input", {
        class: "clip-input remote-quick",
        type: "text",
        placeholder: "Serveur ou adresse IP…",
        spellcheck: "false",
        autocomplete: "off",
        maxlength: 253,
      }) as HTMLInputElement;
      const quickConnect = (kind: Kind) =>
        api.handler(async () => {
          const host = quick.value.trim();
          if (!host) return quick.focus();
          try {
            await api.invoke("connect", { kind, host });
          } catch (err) {
            fail(api, err);
          }
        });
      quick.addEventListener(
        "keydown",
        api.handler((e: KeyboardEvent) => {
          if (e.key === "Enter") return quickConnect("rdp")();
        }),
      );
      const head = el(
        "div",
        { class: "remote-head" },
        quick,
        el("button", { class: "btn small", title: "Bureau à distance (Entrée)", onclick: quickConnect("rdp") }, "🖥️ RDP"),
        el("button", { class: "btn small", title: "Terminal SSH", onclick: quickConnect("ssh") }, "⌨️ SSH"),
        el("button", { class: "btn small", title: "Enregistrer en favori", onclick: api.handler(() => openForm(null, quick.value.trim())) }, "★"),
      );
      const body = el("div", { class: "remote-body" });
      root.append(el("div", { class: "remote" }, head, body));

      let editing: Favorite | "new" | null = null;
      let prefill = "";

      // ── La liste ───────────────────────────────────────────────────────────
      const drawList = () => {
        if (!favorites.length) {
          body.replaceChildren(
            el("p", { class: "muted" }, "Aucun favori. Tape une adresse ci-dessus et clique ★ pour l'enregistrer, ou ajoute-en un :"),
            el("button", { class: "btn small", onclick: api.handler(() => openForm(null, "")) }, "＋ Ajouter un serveur"),
          );
          return;
        }
        const rows = favorites.map((f) => {
          const p = probes.get(f.id);
          const dot = el("span", {
            class: `remote-dot ${p?.state ?? "unknown"}`,
            title: !p ? "Pas encore testé" : p.state === "wait" ? "Test en cours…" : p.state === "up" ? `Répond (${p.ms} ms)` : "Ne répond pas",
          });
          return el(
            "li",
            { class: "remote-item" },
            el(
              "button",
              { class: "remote-main", title: `Se connecter à ${target(f)}`, onclick: api.handler(() => api.invoke("connect", { id: f.id }).catch((e) => fail(api, e))) },
              el("span", { class: "launch-icon" }, KIND_ICON[f.kind]),
              el("span", { class: "launch-text" }, el("b", {}, f.name), el("small", { class: "muted" }, target(f))),
              dot,
              el("span", { class: "launch-tag" }, KIND_LABEL[f.kind]),
            ),
            el("button", { class: "icon-btn", title: "Modifier", onclick: api.handler(() => openForm(f, "")) }, "✎"),
            el(
              "button",
              { class: "icon-btn", title: "Supprimer (Annuler possible)", onclick: api.handler(() => api.invoke("delete", { id: f.id }).catch((e) => fail(api, e))) },
              "🗑",
            ),
          );
        });
        body.replaceChildren(
          el("ul", { class: "remote-list" }, ...rows),
          el(
            "div",
            { class: "btn-row" },
            el("button", { class: "btn small", onclick: api.handler(() => openForm(null, "")) }, "＋ Ajouter"),
            el("button", { class: "btn small", title: "Vérifie que chaque serveur répond sur son port", onclick: api.handler(() => probeAll(api)) }, "↻ Tester"),
          ),
        );
      };

      // ── Le formulaire ──────────────────────────────────────────────────────
      const drawForm = (f: Favorite | null) => {
        const field = (label: string, input: HTMLElement) => el("label", { class: "remote-field" }, el("span", { class: "muted" }, label), input);
        const input = (value: string, placeholder: string, max: number) =>
          el("input", { class: "clip-input", type: "text", value, placeholder, spellcheck: "false", autocomplete: "off", maxlength: max }) as HTMLInputElement;
        const name = input(f?.name ?? "", "Serveur de fichiers", 60);
        const host = input(f?.host ?? prefill, "srv-01.domaine.local ou 192.168.1.10", 253);
        const port = input(f?.port ? String(f.port) : "", "par défaut", 5);
        const user = input(f?.user ?? "", "admin (facultatif)", 100);
        const kind = el(
          "select",
          { class: "clip-input" },
          el("option", { value: "rdp" }, "Bureau à distance (RDP)"),
          el("option", { value: "ssh" }, "SSH"),
        ) as HTMLSelectElement;
        kind.value = f?.kind ?? "rdp";
        const userField = field("Utilisateur", user);
        const syncKind = () => {
          userField.hidden = kind.value !== "ssh"; // RDP demande l'utilisateur dans sa propre fenêtre
          port.placeholder = kind.value === "ssh" ? "22" : "3389";
        };
        kind.addEventListener("change", syncKind);
        syncKind();

        const save = api.handler(async () => {
          try {
            await api.invoke("save", { id: f?.id, name: name.value, kind: kind.value, host: host.value, port: port.value, user: user.value });
            editing = null;
            quick.value = "";
            await refresh(api);
          } catch (err) {
            fail(api, err);
          }
        });
        body.replaceChildren(
          el(
            "form",
            { class: "remote-form", onsubmit: (e: Event) => (e.preventDefault(), save()) },
            field("Type", kind),
            field("Nom", name),
            field("Adresse", host),
            field("Port", port),
            userField,
            el(
              "div",
              { class: "btn-row remote-actions" },
              el("button", { class: "btn small primary", type: "submit" }, f ? "Enregistrer" : "Ajouter"),
              el("button", { class: "btn small", type: "button", onclick: api.handler(() => ((editing = null), draw())) }, "Annuler"),
              el("small", { class: "muted", title: "Windows ou ssh le demandent à la connexion." }, "🔒 aucun mot de passe enregistré"),
            ),
          ),
        );
        (f ? name : prefill ? name : host).focus();
      };

      const draw = () => (editing ? drawForm(editing === "new" ? null : editing) : drawList());
      const openForm = (f: Favorite | null, hostPrefill: string) => {
        editing = f ?? "new";
        prefill = hostPrefill;
        draw();
        if (!reducedMotion()) {
          body.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: EASE });
        }
      };

      // Pendant qu'on remplit le formulaire, une mise à jour de la liste ne l'efface pas.
      const redraw = () => {
        if (!editing) drawList();
      };
      redraws.add(redraw);
      drawList();
      void refresh(api).then(() => {
        if (api.settings().probeOnOpen !== false) probeAll(api);
      });
      return () => {
        redraws.delete(redraw);
      };
    },
  },
};
