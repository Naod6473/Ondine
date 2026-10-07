// Module « Accès distants » : favoris Bureau à distance (RDP) et SSH.
//
// Le Rust (src-tauri/src/modules/remote.rs) enregistre les favoris, vérifie
// chaque adresse et lance mstsc.exe ou ssh.exe. Ici : la connexion rapide
// (on tape une adresse, on clique RDP ou SSH), la liste des favoris avec un
// point vert / rouge selon que le serveur répond, et le petit formulaire
// pour ajouter ou modifier un favori.
//
// « Réveiller » (⏰, favori avec une adresse MAC) : le Rust envoie le paquet
// Wake-on-LAN, puis teste le serveur toutes les 5 s (2 min au plus). Les
// nouvelles arrivent par le bus : « remote.waking », puis « remote.wake-done ».

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
  /** « AA:BB:CC:DD:EE:FF » pour le réveiller (Wake-on-LAN), absente sinon. */
  mac?: string;
}

/** Ce qu'on sait de chaque serveur : en ligne (avec le temps de réponse), hors ligne, en cours. */
type Probe = { state: "wait" } | { state: "up"; ms: number } | { state: "down" };

const KIND_ICON: Record<Kind, string> = { rdp: "🖥️", ssh: "⌨️" };
const KIND_LABEL: Record<Kind, string> = { rdp: "RDP", ssh: "SSH" };
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

let favorites: Favorite[] = [];
const probes = new Map<number, Probe>();
const redraws = new Set<() => void>();
/** Les favoris en cours de réveil (le Rust attend qu'ils répondent). */
const waking = new Set<number>();

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
    if (waking.has(f.id)) continue; // le réveil teste déjà ce serveur
    probes.set(f.id, { state: "wait" });
    api
      .invoke<{ online: boolean; ms?: number }>("probe", { id: f.id })
      .then((r) => probes.set(f.id, r.online ? { state: "up", ms: r.ms ?? 0 } : { state: "down" }))
      .catch(() => probes.delete(f.id))
      .finally(() => redraws.forEach((r) => r()));
  }
  redraws.forEach((r) => r());
}

/** « Réveiller » : le Rust envoie le paquet ; la suite arrive par le bus. */
async function wake(api: ModuleApi, f: Favorite) {
  try {
    await api.invoke("wake", { id: f.id });
  } catch (err) {
    api.notify({ title: "Réveil impossible", body: errorText(err), icon: "⚠️", priority: "normal", key: `remote-wake-${f.id}` });
  }
}

/** Les nouvelles du réveil (bouton de l'onglet ou lanceur) : notifications et point d'état. */
function listenWake(api: ModuleApi) {
  api.on("remote.waking", (msg) => {
    const p = msg.payload as { id: number; name: string };
    waking.add(p.id);
    probes.set(p.id, { state: "wait" });
    redraws.forEach((r) => r());
    api.notify({
      title: `Réveil de ${p.name}…`,
      body: "Paquet envoyé sur le réseau local. Test toutes les 5 s, 2 min au plus.",
      icon: "⏰",
      priority: "low",
      key: `remote-wake-${p.id}`,
    });
  });
  api.on("remote.wake-done", (msg) => {
    const p = msg.payload as { id?: number; name?: string; awake?: boolean; secs?: number; ms?: number; error?: string };
    if (p.error) {
      api.notify({ title: "Réveil impossible", body: p.error, icon: "⚠️", priority: "normal", key: "remote-wake-error" });
      return;
    }
    if (p.id === undefined) return;
    waking.delete(p.id);
    probes.set(p.id, p.awake ? { state: "up", ms: p.ms ?? 0 } : { state: "down" });
    redraws.forEach((r) => r());
    if (p.awake) {
      const secs = p.secs ?? 0;
      api.notify({
        title: `${p.name} est réveillé`,
        body: secs > 0 ? `Il répond après ${secs} s.` : "Il répondait déjà.",
        icon: "✅",
        priority: "normal",
        key: `remote-wake-${p.id}`,
      });
    } else {
      api.notify({
        title: `${p.name} ne répond toujours pas`,
        body: "Vérifiez que le Wake-on-LAN est activé (BIOS et carte réseau) et que le serveur est sur le même réseau local.",
        icon: "⚠️",
        priority: "normal",
        key: `remote-wake-${p.id}`,
      });
    }
  });
}

export const remote: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    api.on("remote.changed", () => void refresh(api));
    listenWake(api);
    // Le lanceur apprend la liste par le bus (numéro, nom, type, réveil possible ; ni l'adresse ni la MAC).
    void refresh(api).then(() =>
      api.emit("remote.changed", { favorites: favorites.map(({ id, name, kind, mac }) => ({ id, name, kind, wake: !!mac })) }),
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
            el("p", { class: "muted" }, "Aucun favori. Tapez une adresse ci-dessus et cliquez sur ★ pour l'enregistrer, ou ajoutez-en un :"),
            el("button", { class: "btn small", onclick: api.handler(() => openForm(null, "")) }, "＋ Ajouter un serveur"),
          );
          return;
        }
        const rows = favorites.map((f) => {
          const p = probes.get(f.id);
          const dot = el("span", {
            class: `remote-dot ${p?.state ?? "unknown"}`,
            title: waking.has(f.id)
              ? "Réveil en cours…"
              : !p
                ? "Pas encore testé"
                : p.state === "wait"
                  ? "Test en cours…"
                  : p.state === "up"
                    ? `Répond (${p.ms} ms)`
                    : "Ne répond pas",
          });
          // ⏰ Réveiller : seulement avec une adresse MAC.
          const wakeBtn = f.mac
            ? el(
                "button",
                {
                  class: `icon-btn remote-wake${waking.has(f.id) ? " busy" : ""}`,
                  title: waking.has(f.id) ? "Réveil en cours… (cliquer renvoie le paquet)" : "Réveiller (Wake-on-LAN)",
                  onclick: api.handler(() => wake(api, f)),
                },
                "⏰",
              )
            : null;
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
            wakeBtn,
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
        const mac = el("input", {
          class: "clip-input",
          type: "text",
          value: f?.mac ?? "",
          placeholder: "AA:BB:CC:DD:EE:FF (facultatif)",
          title: "Pour « Réveiller » (Wake-on-LAN). Serveur allumé, « arp -a » dans un terminal la donne.",
          spellcheck: "false",
          autocomplete: "off",
          maxlength: 17,
        }) as HTMLInputElement;
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
            await api.invoke("save", { id: f?.id, name: name.value, kind: kind.value, host: host.value, port: port.value, user: user.value, mac: mac.value });
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
            field("Adresse MAC (réveil)", mac),
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
