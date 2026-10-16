// La carte « Brancher » d'un agent (onglet Agents IA, 1.2.5) : elle remplace
// l'ancien guide replié en bas de l'onglet. Au premier clic sur un agent pas
// encore branché, une phrase, « Brancher <agent> » (l'installation
// automatique : fusion dans le fichier de l'outil, copie .bak, voir
// src-tauri/src/modules/agents_hooks.rs) et « Plus tard ». Tout le reste
// (copier la configuration, serveur MCP, Autoriser / Refuser depuis l'île,
// retirer, essayer, brancher un autre outil) est replié dans « Options
// avancées », avec ses explications dans les bulles (title).
//
// La carte n'est redessinée que si son contenu change (index.ts compare une
// clé) : la confirmation en cours et les options ouvertes restent en place.

import { errorText } from "../../core/log";
import type { ModuleApi } from "../../core/module-types";
import { el } from "../../island/dom";
import { agentIcon, icon } from "../../island/icon";
import { hookKeyOf, type HookInfo, type Plug } from "./pills-logic";
import { HOOK_TOOLS } from "./tools";

/** L'état des hooks d'un outil tel que le Rust le rend (« hook_status »). */
export interface HookState extends HookInfo {
  file: string;
  permission: boolean;
  otherPermission: boolean;
}

export interface SetupContext {
  api: ModuleApi;
  /** L'état lu par « hook_status » (null : pas encore lu). */
  hooks(): Record<string, HookState | undefined> | null;
  /** Relit l'état des hooks puis redessine. */
  reload(): Promise<void>;
  /** « C:\…\ondine.exe notify » et la ligne pour un autre outil (« hook_config »). */
  exe(): string;
  otherLine(): string;
}

export interface SetupOptions {
  id: string;
  name: string;
  color: string;
  plug: Plug;
  /** Rouvert par « Configurer » (agent déjà branché ou sans hooks). */
  configOpen: boolean;
  /** Ajouté avec « + » : on peut le retirer de la rangée. */
  removable: boolean;
  later(): void;
  close(): void;
  remove(): void;
}

/** La copie de sécurité faite au dernier enregistrement, par outil. */
const backups: Record<string, string> = {};
/** La confirmation « Brancher » ouverte (par outil) et « Options avancées » dépliées. */
let confirming: string | null = null;
let advancedOpen = false;

/** Ce qu'il faut pour savoir si la carte doit être redessinée. */
export function setupKey(ctx: SetupContext, o: SetupOptions): string {
  const key = hookKeyOf(o.id);
  return JSON.stringify([o.id, o.name, o.plug, o.configOpen, o.removable, key ? ctx.hooks()?.[key] : null, key ? backups[key] : null, confirming, ctx.exe(), ctx.api.settings().permissions]);
}

/** Copie un texte de configuration (commande du Rust) et dit où le coller. */
function copyButton(ctx: SetupContext, label: string, title: string, args: Record<string, unknown>, command: string, done: () => { title: string; body?: string }) {
  return el(
    "button",
    {
      class: "btn small",
      title,
      onclick: ctx.api.handler(async () => {
        try {
          await ctx.api.invoke(command, args);
          ctx.api.notify({ ...done(), icon: "📋", priority: "low", key: "agents-copied" });
        } catch (err) {
          ctx.api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: "agents-error" });
        }
      }),
    },
    label,
  );
}

/** Ce que dit la carte, selon l'état des hooks. */
const PHRASE: Record<Plug, string> = {
  off: "L'île saura quand il attend ou a fini.",
  update: "Il manque une nouveauté : rebranchez-le.",
  stale: "Ses hooks visent un ancien ondine.exe.",
  broken: "Son fichier de réglages est illisible : Ondine n'y touche pas.",
  ready: "Branché.",
  unknown: "Lecture…",
  none: "Il ne prévient pas l'île tout seul.",
};

export function setupCard(ctx: SetupContext, o: SetupOptions): HTMLElement {
  const { api } = ctx;
  const key = hookKeyOf(o.id);
  const guide = key ? HOOK_TOOLS[key] : undefined;
  const state = key ? ctx.hooks()?.[key] : undefined;
  const file = state?.file || guide?.file || "";
  const redraw = () => void ctx.reload();

  // ── Brancher : l'installation automatique, après une confirmation sur place.
  const install = async () => {
    if (!key) return;
    confirming = null;
    try {
      const r = await api.invoke<{ backup: string | null; changed: boolean; otherPermission: boolean } | null>("hook_install", { tool: key });
      if (r?.backup) backups[key] = r.backup;
      api.notify(
        r && !r.changed
          ? { title: "Hooks déjà installés", body: "Rien à changer.", icon: "✔️", priority: "low", key: "agents-hooks" }
          : { title: "Hooks installés", body: guide?.restart, icon: "✅", priority: "normal", key: "agents-hooks" },
      );
      // Claude Code : un autre programme répond aussi aux demandes de permission.
      if (r?.otherPermission)
        api.notify({
          title: "Deux réponses aux permissions",
          body: "Un autre programme a aussi un hook PermissionRequest dans Claude Code : il peut répondre avant l'île, ou l'inverse. Ondine ne l'a pas retiré.",
          icon: "⚠️",
          priority: "normal",
          key: "agents-hooks-perm",
        });
    } catch (err) {
      api.notify({ title: "Installation impossible", body: errorText(err), icon: "⚠️", priority: "normal", key: "agents-hooks" });
    }
    await ctx.reload();
  };
  const uninstall = async () => {
    if (!key) return;
    try {
      const r = await api.invoke<{ backup: string | null; removed: number } | null>("hook_remove", { tool: key });
      if (r?.backup) backups[key] = r.backup;
      api.notify(
        r && !r.removed
          ? { title: "Aucun hook d'Ondine dans ce fichier", icon: "ℹ️", priority: "low", key: "agents-hooks" }
          : { title: "Hooks d'Ondine retirés", body: "Les autres réglages et hooks du fichier sont gardés.", icon: "🧹", priority: "low", key: "agents-hooks" },
      );
    } catch (err) {
      api.notify({ title: "Retrait impossible", body: errorText(err), icon: "⚠️", priority: "normal", key: "agents-hooks" });
    }
    await ctx.reload();
  };

  const head = el(
    "div",
    { class: "agents-setup-head" },
    el("span", { class: "agents-setup-logo", "aria-hidden": "true" }, icon(agentIcon(o.id))),
    el("b", { "data-no-i18n": true }, o.name),
    el("small", { class: "muted" }, PHRASE[o.plug]),
  );

  // Les boutons principaux : Brancher (ou sa confirmation), Plus tard / Fermer.
  const main = el("div", { class: "btn-row agents-setup-main" });
  const verb = o.plug === "off" ? "Brancher" : "Rebrancher";
  if (key && confirming === o.id) {
    main.append(
      el("span", { class: "agents-confirm", title: `Ondine ajoute ses hooks à ${file}, sans toucher au reste. Copie .bak avant.` }, "Modifier son fichier de réglages ?"),
      el("button", { class: "btn small primary", onclick: api.handler(install) }, "Confirmer"),
      el("button", { class: "btn small", onclick: api.handler(() => ((confirming = null), redraw())) }, "Annuler"),
    );
  } else {
    if (key && o.plug !== "ready" && o.plug !== "unknown")
      main.append(
        el(
          "button",
          {
            class: "btn small primary",
            title: `Ajoute les hooks d'Ondine à ${file} (copie .bak avant)`,
            disabled: o.plug === "broken",
            onclick: api.handler(() => ((confirming = o.id), redraw())),
          },
          `${verb} ${o.name}`,
        ),
      );
    if (o.configOpen || !key || o.plug === "ready") main.append(el("button", { class: "btn small", onclick: api.handler(o.close) }, "Fermer"));
    else main.append(el("button", { class: "btn small", title: "Garder la vue de l'agent sans le brancher", onclick: api.handler(o.later) }, "Plus tard"));
  }

  // ── Options avancées
  const adv = el("details", { class: "agents-advanced" });
  adv.open = advancedOpen;
  adv.addEventListener("toggle", () => (advancedOpen = adv.open));
  adv.append(el("summary", {}, "Options avancées"));
  if (key && guide) {
    const permOn = api.settings().permissions === true;
    const stateText = {
      installed: "Installé",
      stale: "Ancien chemin : à rebrancher",
      absent: "Non installé",
      unreadable: "Fichier illisible",
    }[state?.state ?? "absent"];
    adv.append(
      el(
        "div",
        { class: "agents-adv-state muted" },
        el("span", {}, stateText),
        " · ",
        el("code", { "data-no-i18n": true, title: "Le fichier de réglages de l'outil" }, file),
      ),
    );
    if (state?.otherPermission && state.permission) adv.append(el("div", { class: "muted", title: "Un autre programme a aussi un hook PermissionRequest : il peut répondre avant l'île, ou l'inverse." }, "Deux réponses aux permissions"));
    if (backups[key]) adv.append(el("div", { class: "muted" }, "Copie : ", el("code", { "data-no-i18n": true }, backups[key])));
    const row = el("div", { class: "btn-row" });
    row.append(
      copyButton(ctx, "Copier la configuration", guide.steps, { tool: key }, "copy_config", () => ({ title: "Configuration copiée", body: `Collez-la dans ${file}.` })),
    );
    if (guide.mcp) {
      const MCP_STEPS: Record<string, string> = {
        "claude-code": "Collez la commande dans un terminal (une seule fois), puis relancez Claude Code.",
        codex: "Collez les lignes à la fin de %USERPROFILE%\\.codex\\config.toml, puis relancez Codex.",
        gemini: "Fusionnez le bloc « mcpServers » dans %USERPROFILE%\\.gemini\\settings.json, puis relancez Gemini CLI.",
      };
      row.append(
        copyButton(
          ctx,
          "Copier la config MCP",
          "Serveur MCP (facultatif) : l'agent peut vous envoyer un message, sa progression, lancer le minuteur, vous poser une question, ajouter une note, déposer un fichier ou demander une capture (toujours après votre clic).",
          { tool: key },
          "copy_mcp",
          () => ({ title: "Configuration MCP copiée", body: MCP_STEPS[key] ?? "" }),
        ),
      );
    }
    if (guide.mcp && key !== "gemini")
      row.append(
        copyButton(
          ctx,
          "Copier le hook d'autorisation",
          permOn
            ? "Autoriser / Refuser depuis l'île (activé) : l'île montre la commande avec « Autoriser » (à confirmer) et « Refuser ». Sans réponse à temps, la question passe au terminal."
            : "Autoriser / Refuser depuis l'île (désactivé dans les réglages) : l'île montre la commande avec « Autoriser » (à confirmer) et « Refuser ». Sans réponse à temps, la question passe au terminal.",
          { tool: key, permission: true },
          "copy_config",
          () => ({ title: "Hook d'autorisation copié", body: `Collez-le dans ${file}, puis activez le réglage « Autoriser / Refuser depuis l'île ».` }),
        ),
      );
    if (state?.state === "installed" || state?.state === "stale")
      row.append(el("button", { class: "btn small", title: "Retire seulement les hooks d'Ondine de ce fichier", onclick: api.handler(uninstall) }, "Retirer"));
    row.append(el("button", { class: "btn small", title: "Fait comme si Claude venait de finir : une notification doit apparaître", onclick: api.handler(() => api.invoke("test")) }, "Essayer"));
    adv.append(row);
    adv.append(el("div", { class: "muted agents-adv-exe", title: "Ce que lance chaque hook" }, el("code", { "data-no-i18n": true }, ctx.exe())));
  } else {
    // Pas de hooks d'ici : la ligne à donner à l'outil, s'il sait lancer une commande en fin de tâche.
    adv.append(
      el("div", { class: "muted", title: "« --event done », ou « waiting » quand il attend votre réponse, « working » quand il repart. Rien n'est exécuté à sa demande." }, "À lancer en fin de tâche :"),
      el("code", { class: "agents-exe", "data-no-i18n": true }, ctx.otherLine()),
    );
    if (o.id === "other") adv.append(el("div", { class: "muted" }, "Son mot de commande : réglage « Autre outil »."));
  }
  if (o.removable) adv.append(el("div", { class: "btn-row" }, el("button", { class: "btn small", onclick: api.handler(o.remove) }, "Retirer de la rangée")));
  return el("div", { class: "agents-card agents-setup", style: `--agent: ${o.color}` }, head, main, adv);
}
