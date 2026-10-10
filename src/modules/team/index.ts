// Module « Équipe » : les Ondine du même réseau local.
//
// Le Rust (src-tauri/src/modules/team.rs, team_net.rs, team_proto.rs) fait
// tout le réseau et le chiffrement ; ici : l'onglet (mon statut, mon code,
// mes collègues, les demandes à accepter, les actions de groupe) et les
// notifications de ce qui arrive (sujet « team.event »).
//
// Rien de ce qui arrive n'est exécuté : un fichier ou un texte reçu attend
// « Accepter » ; un texte accepté va dans le presse-papiers, un fichier dans
// Téléchargements\Ondine.
//
// Envoyer des fichiers : glisser sur l'île (une cible par collègue en ligne),
// ou « Fichier… » / « Dossier… » dans la fiche d'un collègue. Un texte est
// toujours montré dans sa zone avant l'envoi.

import manifest from "./manifest.json";
import { Bridge } from "../../core/bridge";
import { errorText } from "../../core/log";
import type { DropTarget, IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { settingsStore } from "../../core/settings-store";
import { el } from "../../island/dom";
import { sizeText } from "../shelf/phone-text";
import { ANSWER_LABEL, codeText, diskLow, isLink, isPrivateIp, lookColor, PINGS, pingText, pollChoices, sortPeers, STATUS_LABEL, type PeerView, type Status } from "./logic";
import { mountVisit } from "./visit";

interface Me {
  id: string;
  fingerprint: string;
  name: string;
  ip: string | null;
  status: Status;
  statusText: string;
  auto: boolean;
  visible: boolean;
}

interface PendingView {
  id: number;
  peer: string;
  kind: "text" | "file" | "help" | "status" | "rdp";
  text: string;
  name: string;
  size: number;
  folder: boolean;
  at: number;
}

interface TeamState {
  me: Me;
  peers: PeerView[];
  nearby: { id: string; name: string; color: string; addr: string }[];
  pending: PendingView[];
  code: { code: string; seconds: number; mine: boolean } | null;
  polls: { poll: number; question: string; choices: string[]; counts: number[] }[];
}

/** Qui a envoyé (dans « team.event »). */
interface From {
  id: string;
  name: string;
  color: string;
  mascot: string;
  mine: boolean;
  it: boolean;
}

let state: TeamState | null = null;
/** Fin du code affiché (horloge du front). */
let codeUntil = 0;
const redraws = new Set<() => void>();

async function refresh(api: ModuleApi) {
  try {
    state = await api.invoke<TeamState>("state");
    codeUntil = state.code ? Date.now() + state.code.seconds * 1000 : 0;
  } catch {
    return; // hors de l'appli (navigateur)
  }
  for (const r of redraws) r();
}

function fail(api: ModuleApi, err: unknown) {
  api.notify({ title: "Équipe", body: errorText(err), icon: "⚠️", priority: "normal", key: "team-error" });
}

/** Appelle le Rust ; une erreur devient une notification. */
async function run<T>(api: ModuleApi, command: string, args?: unknown): Promise<T | null> {
  try {
    return await api.invoke<T>(command, args);
  } catch (err) {
    fail(api, err);
    return null;
  }
}

function peerName(id: string): string {
  return state?.peers.find((p) => p.id === id)?.name ?? "Un collègue";
}

/** Donne au Rust la couleur et la mascotte de l'île (montrées aux collègues). */
function sendLook(api: ModuleApi) {
  const m = settingsStore.current.mascot as { id: string; color?: string; customColor?: string };
  void api.invoke("set_look", { color: lookColor(m.color, m.customColor), mascot: m.id }).catch(() => {});
}

// ── Ce qui arrive (notifications) ───────────────────────────────────────────

function listen(api: ModuleApi) {
  api.on("team.changed", () => void refresh(api));
  api.on("team.progress", (msg) => {
    const p = msg.payload as { id: number; name: string; percent: number; dir: "in" | "out"; peerName: string };
    if (p.percent >= 100) return; // la fin a sa propre notification
    api.notify({
      title: p.dir === "in" ? "Réception en cours" : "Envoi en cours",
      body: `${p.name} · ${p.percent} %`,
      icon: p.dir === "in" ? "📥" : "📤",
      priority: "low",
      key: `team-progress-${p.id}`,
      durationMs: 2500,
    });
  });
  api.on("team.event", (msg) => {
    const e = msg.payload as Record<string, unknown> & { kind: string; from: From | null };
    const from = e.from;
    const who = from?.name ?? "Un collègue";
    const key = (k: string) => `team-${k}-${from?.id ?? ""}`;
    switch (e.kind) {
      case "paired":
        api.notify({ title: "Nouveau collègue", body: who, icon: "🤝", priority: "normal", key: "team-paired" });
        api.emit("mascot.emote", { emotion: "cheer" });
        break;
      case "pair-failed":
        api.notify({ title: "Appairage refusé", body: String(e.error ?? ""), icon: "⚠️", priority: "normal", key: "team-paired" });
        break;
      case "ping":
        api.notify({ title: who, body: pingText(String(e.ping)), icon: "🤝", priority: "normal", key: key("ping") });
        break;
      case "ask":
        api.notify({
          title: who,
          body: "Vous êtes disponible ?",
          icon: "🔔",
          priority: "high",
          key: key("ask"),
          actions: (["yes", "later", "no"] as const).map((answer) => ({
            label: ANSWER_LABEL[answer],
            run: () => void run(api, "answer", { id: from?.id, ask: e.ask, answer }),
          })),
        });
        break;
      case "answer":
        api.notify({ title: who, body: ANSWER_LABEL[String(e.answer)] ?? "", icon: "🔔", priority: "normal", key: key("answer") });
        break;
      case "visit":
        if (!from) break;
        api.notify({
          title: "Visite d'Ondine",
          body: String(e.note ?? ""),
          icon: "🫧",
          priority: "high",
          key: key("visit"),
          durationMs: 9000,
          content: (host) => mountVisit(host, from, String(e.note ?? "")),
          actions: [
            { label: "👋 Coucou", run: () => void run(api, "ping", { id: from.id, kind: "wave" }) },
            { label: "Fermer", run: () => undefined },
          ],
        });
        break;
      case "incoming":
        incoming(api, e, who);
        break;
      case "received":
        api.notify({
          title: "Fichier reçu",
          body: `${who} · ${String(e.name)}`,
          icon: "📥",
          priority: "normal",
          key: key("file"),
          actions: [
            { label: "Montrer", run: () => void run(api, "reveal", { path: e.path }) },
            { label: "Ouvrir le dossier", run: () => void run(api, "open_inbox") },
          ],
        });
        api.emit("mascot.emote", { emotion: "happy" });
        break;
      case "sent":
        api.notify({ title: "Fichier envoyé", body: `${who} · ${String(e.name)}`, icon: "📤", priority: "low", key: key("file") });
        break;
      case "declined":
        api.notify({ title: "Fichier refusé", body: `${who} · ${String(e.name)}`, icon: "📤", priority: "low", key: key("file") });
        break;
      case "send-failed":
      case "receive-failed":
        api.notify({ title: "Transfert interrompu", body: `${String(e.name)} · ${String(e.error)}`, icon: "⚠️", priority: "normal", key: key("file") });
        break;
      case "invite": {
        const lunch = e.type === "lunch";
        api.notify({
          title: who,
          body: `${lunch ? "🍽️ Déjeuner" : "☕ Café"} · ${Number(e.minutes) > 0 ? `${Number(e.minutes)} min` : "maintenant"}`,
          icon: lunch ? "🍽️" : "☕",
          priority: "high",
          key: key("invite"),
          actions: [
            { label: "J'arrive", run: () => void run(api, "invite_reply", { id: from?.id, invite: e.invite, answer: "yes" }) },
            { label: "Pas cette fois", run: () => void run(api, "invite_reply", { id: from?.id, invite: e.invite, answer: "no" }) },
          ],
        });
        break;
      }
      case "invite-reply":
        api.notify({ title: who, body: e.answer === "yes" ? "J'arrive !" : "Pas cette fois", icon: "☕", priority: "normal", key: key("invite-reply") });
        break;
      case "poll": {
        const choices = (e.choices as string[]) ?? [];
        api.notify({
          title: `📊 ${who}`,
          body: String(e.question ?? ""),
          icon: "📊",
          priority: "high",
          key: key("poll"),
          sticky: true,
          actions: choices.map((label, choice) => ({ label, run: () => void run(api, "vote", { id: from?.id, poll: e.poll, choice }) })),
        });
        break;
      }
      case "vote": {
        const choices = (e.choices as string[]) ?? [];
        const counts = (e.counts as number[]) ?? [];
        api.notify({ title: String(e.question ?? ""), body: choices.map((c, i) => `${c} ${counts[i] ?? 0}`).join(" · "), icon: "📊", priority: "low", key: `team-poll-${String(e.poll)}` });
        void refresh(api);
        break;
      }
      case "pomodoro":
        api.notify({
          title: "Pomodoro d'équipe",
          body: `${who} · ${Number(e.minutes)} min`,
          icon: "🍅",
          priority: "high",
          key: "team-pomodoro",
          actions: [
            { label: "Rejoindre", run: () => api.emit("timer.start", { minutes: Number(e.minutes) }) },
            { label: "Plus tard", run: () => undefined },
          ],
        });
        break;
      case "announce":
        api.notify({ title: `📣 ${who}`, body: String(e.text ?? ""), icon: "📣", priority: "high", key: key("announce"), sticky: true, actions: [{ label: "OK", run: () => undefined }] });
        break;
      case "status-report":
        api.notify({ title: "État du PC reçu", body: who, icon: "🛠️", priority: "normal", key: key("status"), actions: [{ label: "Voir", run: () => api.openIsland("team") }] });
        break;
      case "rdp-reply":
        api.notify({
          title: e.ok ? "Bureau à distance autorisé" : "Bureau à distance refusé",
          body: e.error ? String(e.error) : who,
          icon: "🖥️",
          priority: "normal",
          key: key("rdp"),
        });
        break;
    }
  });
}

/** Une demande à accepter : notification avec « Accepter » / « Refuser ». */
function incoming(api: ModuleApi, e: Record<string, unknown>, who: string) {
  const id = Number(e.id);
  const kind = String(e.type);
  const titles: Record<string, string> = {
    text: "Texte proposé",
    file: "Fichier proposé",
    help: "Demande d'aide",
    status: "L'IT demande l'état du PC",
    rdp: "Demande de Bureau à distance",
  };
  const bodies: Record<string, string> = {
    text: `${who} · ${String(e.text ?? "").slice(0, 200)}`,
    file: `${who} · ${String(e.name)} · ${sizeText(Number(e.size))}`,
    help: who,
    status: `${who} · processeur, mémoire, disques, redémarrage en attente`,
    rdp: `${who} · le Bureau à distance doit être activé dans Windows`,
  };
  api.notify({
    title: titles[kind] ?? "Équipe",
    body: bodies[kind] ?? who,
    icon: kind === "file" ? "📥" : kind === "help" ? "🆘" : kind === "text" ? "💬" : "🛠️",
    priority: "high",
    sticky: true,
    key: `team-pending-${id}`,
    actions: [
      { label: kind === "text" || kind === "help" ? "Accepter et copier" : kind === "status" || kind === "rdp" ? "Autoriser" : "Accepter", run: () => void decide(api, id, true) },
      { label: "Refuser", run: () => void decide(api, id, false) },
    ],
  });
}

async function decide(api: ModuleApi, id: number, ok: boolean) {
  const r = await run<{ copied?: boolean; receiving?: boolean }>(api, ok ? "accept" : "decline", { id });
  if (r?.copied) api.notify({ title: "Copié dans le presse-papiers", icon: "📋", priority: "low", key: "team-copied" });
  void refresh(api);
}

// ── Les cibles de dépôt : une par collègue en ligne ─────────────────────────

function dropTargets(): DropTarget[] {
  return sortPeers(state?.peers ?? [])
    .filter((p) => p.online)
    .slice(0, 6)
    .map((p) => ({
      id: `team-${p.id}`,
      label: p.name,
      icon: "🤝",
      onDrop: async (paths, api) => {
        const r = await run<{ name: string }>(api, "send_files", { id: p.id, paths });
        if (r) api.notify({ title: "Proposé", body: `${p.name} · ${r.name}`, icon: "📤", priority: "low", key: `team-file-${p.id}` });
      },
    }));
}

// ── L'onglet ────────────────────────────────────────────────────────────────

function dot(color: string, status: Status): HTMLElement {
  const d = el("span", { class: `team-dot team-st-${status}`, title: STATUS_LABEL[status] });
  d.style.setProperty("--peer", /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#5cc8ff");
  return d;
}

function expanded(root: HTMLElement, api: ModuleApi): () => void {
  const body = el("div", { class: "team" });
  root.append(body);
  /** La fiche ouverte (un collègue), ou le formulaire d'ajout. */
  let open: { kind: "peer"; id: string } | { kind: "add"; addr: string; name: string } | { kind: "group"; what: string } | null = null;
  let tick = 0;

  const draw = () => {
    if (!state) {
      body.replaceChildren(el("p", { class: "muted" }, "Chargement…"));
      return;
    }
    const s = state;
    body.replaceChildren(head(s), ...codePanel(s), ...pendingList(s), main(s));
  };

  // ── En-tête : mon statut, visible, mon code, ajouter ──
  const head = (s: TeamState) => {
    const select = el("select", { class: "team-status", "aria-label": "Mon statut" }) as HTMLSelectElement;
    const options: [string, string][] = [["", "Automatique"], ["available", "Disponible"], ["meeting", "En réunion"], ["focus", "Concentration"], ["away", "Absent"]];
    for (const [value, label] of options) select.append(el("option", { value }, label));
    select.value = s.me.auto ? "" : s.me.status;
    select.addEventListener(
      "change",
      api.handler(() => run(api, "set_status", { status: select.value || null, text: "" }).then(() => refresh(api))),
    );
    const visible = el(
      "button",
      { class: `btn small ${s.me.visible ? "primary" : ""}`, title: "Visible : les Ondine voisines vous voient et peuvent vous ajouter", onclick: api.handler(() => toggleVisible(api, !s.me.visible)) },
      s.me.visible ? "👁 Visible" : "🙈 Invisible",
    );
    return el(
      "div",
      { class: "team-head" },
      dot("#5cc8ff", s.me.status),
      el("b", { "data-no-i18n": true }, s.me.name),
      select,
      el("span", { class: "team-grow" }),
      visible,
      el("button", { class: "btn small", title: "Afficher un code à taper sur l'autre PC", onclick: api.handler(() => showCode(api, false)) }, "🔢 Mon code"),
      el("button", { class: "btn small", onclick: api.handler(() => ((open = { kind: "add", addr: "", name: "" }), draw())) }, "＋ Ajouter"),
    );
  };

  // ── Mon code d'appairage ──
  const codePanel = (s: TeamState) => {
    if (!s.code || Date.now() > codeUntil) return [];
    const secs = Math.max(0, Math.round((codeUntil - Date.now()) / 1000));
    const mine = el("input", { type: "checkbox" }) as HTMLInputElement;
    mine.checked = s.code.mine;
    mine.addEventListener("change", api.handler(() => showCode(api, mine.checked)));
    return [
      el(
        "div",
        { class: "team-code", "data-island-fit": true },
        el("div", { class: "team-code-digits", "data-no-i18n": true }, codeText(s.code.code)),
        el("div", { class: "muted" }, "Tapez ce code sur l'autre PC (onglet Équipe, « Ajouter »). Un seul essai."),
        el("div", { class: "team-code-meta" }, el("span", { "data-no-i18n": true }, s.me.ip ? `IP ${s.me.ip}` : ""), el("span", { class: "team-clock", "data-no-i18n": true }, `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`)),
        el("label", { class: "team-check" }, mine, "C'est un de mes PC"),
        el("button", { class: "btn small", onclick: api.handler(() => run(api, "hide_code").then(() => refresh(api))) }, "Masquer"),
      ),
    ];
  };

  // ── Les demandes en attente ──
  const pendingList = (s: TeamState) => {
    if (!s.pending.length) return [];
    const label: Record<string, string> = { text: "💬 Texte", file: "📥 Fichier", help: "🆘 Aide", status: "🛠️ État du PC", rdp: "🖥️ Bureau à distance" };
    return [
      el(
        "div",
        { class: "team-pending" },
        ...s.pending.map((p) =>
          el(
            "div",
            { class: "team-req" },
            el("span", { class: "team-req-kind" }, label[p.kind] ?? p.kind),
            el("span", { class: "team-req-who", "data-no-i18n": true }, peerName(p.peer)),
            el("span", { class: "team-req-what", "data-no-i18n": true }, p.kind === "file" ? `${p.name} · ${sizeText(p.size)}` : p.text.slice(0, 120)),
            el("button", { class: "btn small primary", onclick: api.handler(() => decide(api, p.id, true)) }, p.kind === "status" || p.kind === "rdp" ? "Autoriser" : "Accepter"),
            el("button", { class: "btn small", onclick: api.handler(() => decide(api, p.id, false)) }, "Refuser"),
          ),
        ),
      ),
    ];
  };

  // ── La partie principale : la fiche ouverte, ou la liste ──
  const main = (s: TeamState) => {
    if (open?.kind === "add") return addForm(s, open);
    if (open?.kind === "peer") {
      const id = open.id;
      const p = s.peers.find((x) => x.id === id);
      if (p) return peerSheet(p);
      open = null;
    }
    if (open?.kind === "group") return groupForm(s, open.what);
    return list(s);
  };

  const list = (s: TeamState) => {
    const rows = sortPeers(s.peers).map((p) => {
      const status = p.status;
      const quick = PINGS.slice(0, 3).map((g) =>
        el("button", { class: "icon-btn", title: g.label, disabled: !p.online, onclick: api.handler(() => run(api, "ping", { id: p.id, kind: g.kind })) }, g.icon),
      );
      return el(
        "div",
        { class: `team-peer ${p.online ? "" : "off"}` },
        el(
          "button",
          { class: "team-peer-main", onclick: api.handler(() => ((open = { kind: "peer", id: p.id }), draw())) },
          dot(p.color, status),
          el("span", { class: "team-peer-name", "data-no-i18n": true }, p.name),
          el("small", { class: "muted" }, STATUS_LABEL[status]),
          p.statusText ? el("small", { class: "muted", "data-no-i18n": true }, p.statusText) : null,
          p.mine ? el("span", { class: "team-tag" }, "mon PC") : null,
          p.it ? el("span", { class: "team-tag" }, "IT") : null,
          p.battery ? el("small", { class: "team-tag", "data-no-i18n": true }, `${p.battery.charging ? "⚡" : "🔋"} ${p.battery.percent} %`) : null,
        ),
        ...quick,
        el("button", { class: "btn small", disabled: !p.online, onclick: api.handler(() => ask(api, p)) }, "Dispo ?"),
      );
    });
    const nearby = s.nearby.map((n) =>
      el(
        "div",
        { class: "team-peer near" },
        dot(n.color, "available"),
        el("span", { class: "team-peer-name", "data-no-i18n": true }, n.name),
        el("small", { class: "muted", "data-no-i18n": true }, n.addr),
        el("span", { class: "team-grow" }),
        el("button", { class: "btn small", onclick: api.handler(() => ((open = { kind: "add", addr: n.addr, name: n.name }), draw())) }, "＋ Ajouter"),
      ),
    );
    const group = el(
      "div",
      { class: "team-group" },
      el("button", { class: "btn small", onclick: api.handler(() => invite(api, "coffee", 5)) }, "☕ Café dans 5 min"),
      el("button", { class: "btn small", onclick: api.handler(() => invite(api, "lunch", 10)) }, "🍽️ Déjeuner"),
      el("button", { class: "btn small", onclick: api.handler(() => ((open = { kind: "group", what: "poll" }), draw())) }, "📊 Sondage"),
      el("button", { class: "btn small", onclick: api.handler(() => teamPomodoro(api)) }, "🍅 Pomodoro d'équipe"),
      el("button", { class: "btn small", onclick: api.handler(() => ((open = { kind: "group", what: "announce" }), draw())) }, "📣 Annonce"),
      el("button", { class: "btn small", onclick: api.handler(() => ((open = { kind: "group", what: "inventory" }), draw(), run(api, "inventory").then(() => refresh(api)))) }, "🛠️ Inventaire"),
    );
    if (!s.peers.length && !s.nearby.length) {
      return el(
        "div",
        { class: "team-list" },
        el("p", { class: "muted" }, "Aucun collègue pour l'instant. Sur l'autre PC, activez le module Équipe et cliquez sur « Mon code » ; ici, cliquez sur « Ajouter » et tapez ce code."),
        el("p", { class: "muted" }, "Tout reste sur le réseau local, chiffré. Rien ne passe par Internet."),
        el("button", { class: "btn small", onclick: api.handler(() => run(api, "search")) }, "🔎 Chercher sur le réseau"),
      );
    }
    return el(
      "div",
      { class: "team-list" },
      ...rows,
      nearby.length ? el("small", { class: "muted team-sub" }, "À proximité") : null,
      ...nearby,
      s.peers.length ? group : null,
    );
  };

  // ── Ajouter un collègue (code tapé, adresse trouvée ou tapée) ──
  const addForm = (s: TeamState, o: { addr: string; name: string }) => {
    const addr = el("input", { class: "clip-input", type: "text", placeholder: "Adresse IP (ex. 192.168.1.20)", value: o.addr, spellcheck: "false", maxlength: 15 }) as HTMLInputElement;
    const code = el("input", { class: "clip-input team-code-input", type: "text", inputmode: "numeric", placeholder: "Code à 6 chiffres", maxlength: 7, autocomplete: "off" }) as HTMLInputElement;
    const mine = el("input", { type: "checkbox" }) as HTMLInputElement;
    const status = el("small", { class: "muted" });
    const go = api.handler(async () => {
      if (!isPrivateIp(addr.value)) {
        status.textContent = "Adresse du réseau local attendue (192.168.x.x, 10.x.x.x, 172.16-31.x.x).";
        return addr.focus();
      }
      status.textContent = "Appairage…";
      try {
        const p = await api.invoke<{ name: string }>("pair", { addr: addr.value.trim(), code: code.value, mine: mine.checked });
        open = null;
        api.notify({ title: "Nouveau collègue", body: p.name, icon: "🤝", priority: "normal", key: "team-paired" });
        await refresh(api);
      } catch (err) {
        status.textContent = errorText(err);
      }
    });
    code.addEventListener("keydown", api.handler((e: KeyboardEvent) => e.key === "Enter" && go()));
    const near = s.nearby.map((n) =>
      el("button", { class: `btn small ${n.addr === addr.value ? "primary" : ""}`, onclick: api.handler(() => ((addr.value = n.addr), code.focus())) }, n.name),
    );
    queueMicrotask(() => (o.addr ? code : addr).focus());
    return el(
      "div",
      { class: "team-sheet" },
      el("div", { class: "team-sheet-head" }, el("button", { class: "icon-btn", title: "Retour", onclick: api.handler(() => ((open = null), draw())) }, "←"), el("b", {}, "Ajouter un collègue")),
      el("p", { class: "muted" }, "Sur l'autre PC : onglet Équipe, « Mon code ». Tapez ici le code affiché."),
      near.length ? el("div", { class: "chips" }, ...near) : el("button", { class: "btn small", onclick: api.handler(() => run(api, "search")) }, "🔎 Chercher sur le réseau"),
      addr,
      code,
      el("label", { class: "team-check" }, mine, "C'est un de mes PC (presse-papiers, batterie, mascotte)"),
      el("div", { class: "btn-row" }, el("button", { class: "btn small primary", onclick: go }, "Ajouter"), status),
    );
  };

  // ── La fiche d'un collègue ──
  const peerSheet = (p: PeerView) => {
    const text = el("textarea", { class: "clip-input team-text", rows: 3, maxlength: 20000, placeholder: "Texte ou lien à envoyer (montré ici avant l'envoi)" }) as HTMLTextAreaElement;
    const note = el("input", { class: "clip-input", type: "text", maxlength: 280, placeholder: "Un petit mot pour la visite" }) as HTMLInputElement;
    const kindHint = el("small", { class: "muted" });
    text.addEventListener("input", () => (kindHint.textContent = isLink(text.value) ? "🔗 Lien" : text.value ? `${text.value.length} car.` : ""));
    const off = !p.online;
    const pings = PINGS.map((g) => el("button", { class: "btn small", disabled: off, onclick: api.handler(() => run(api, "ping", { id: p.id, kind: g.kind })) }, `${g.icon} ${g.label}`));
    const sendText = api.handler(async () => {
      if (!text.value.trim()) return text.focus();
      if (await run(api, "send_text", { id: p.id, text: text.value })) {
        text.value = "";
        api.notify({ title: "Proposé", body: p.name, icon: "💬", priority: "low", key: `team-text-${p.id}` });
      }
    });
    const pick = (folder: boolean) =>
      api.handler(async () => {
        const path = folder ? await Bridge.pickFolder("Dossier à envoyer") : await Bridge.pickFile("Fichier à envoyer", []);
        if (!path) return;
        const r = await run<{ name: string }>(api, "send_files", { id: p.id, paths: [path] });
        if (r) api.notify({ title: "Proposé", body: `${p.name} · ${r.name}`, icon: "📤", priority: "low", key: `team-file-${p.id}` });
      });
    const opt = (label: string, value: boolean, key: "mine" | "it") => {
      const box = el("input", { type: "checkbox" }) as HTMLInputElement;
      box.checked = value;
      box.addEventListener("change", api.handler(() => run(api, "set_peer", { id: p.id, [key]: box.checked }).then(() => refresh(api))));
      return el("label", { class: "team-check" }, box, label);
    };
    const report = p.report?.data;
    return el(
      "div",
      { class: "team-sheet" },
      el(
        "div",
        { class: "team-sheet-head" },
        el("button", { class: "icon-btn", title: "Retour", onclick: api.handler(() => ((open = null), draw())) }, "←"),
        dot(p.color, p.status),
        el("b", { "data-no-i18n": true }, p.name),
        el("small", { class: "muted" }, STATUS_LABEL[p.status]),
        p.battery ? el("small", { class: "team-tag", "data-no-i18n": true }, `${p.battery.charging ? "⚡" : "🔋"} ${p.battery.percent} %`) : null,
      ),
      el("div", { class: "chips" }, ...pings, el("button", { class: "btn small", disabled: off, onclick: api.handler(() => ask(api, p)) }, "🔔 Tu es dispo ?")),
      el("div", { class: "team-line" }, note, el("button", { class: "btn small", disabled: off || !p.visits, title: p.visits ? "" : "Ce collègue n'accepte pas les visites", onclick: api.handler(() => run(api, "visit", { id: p.id, note: note.value.trim() }).then((r) => r !== null && (note.value = ""))) }, "🫧 Visite d'Ondine")),
      text,
      el(
        "div",
        { class: "btn-row" },
        el("button", { class: "btn small primary", disabled: off, onclick: sendText }, "💬 Envoyer le texte"),
        kindHint,
        el("span", { class: "team-grow" }),
        el("button", { class: "btn small", disabled: off, onclick: pick(false) }, "📄 Fichier…"),
        el("button", { class: "btn small", disabled: off, onclick: pick(true) }, "📁 Dossier…"),
      ),
      el(
        "div",
        { class: "chips" },
        el("button", { class: "btn small", disabled: off, onclick: api.handler(() => helpRequest(api, p)) }, "🆘 Demander de l'aide"),
        el("button", { class: "btn small", disabled: off, onclick: api.handler(() => run(api, "status_ask", { id: p.id }).then((r) => r !== null && api.notify({ title: "Demande envoyée", body: p.name, icon: "🛠️", priority: "low", key: "team-it" }))) }, "🛠️ État du PC"),
        el("button", { class: "btn small", disabled: off, onclick: api.handler(() => run(api, "rdp_ask", { id: p.id }).then((r) => r !== null && api.notify({ title: "Demande envoyée", body: p.name, icon: "🖥️", priority: "low", key: "team-it" }))) }, "🖥️ Bureau à distance"),
      ),
      report ? reportBox(report) : null,
      el("div", { class: "chips" }, opt("Mon PC", p.mine, "mine"), opt("Collègue IT", p.it, "it")),
      el(
        "small",
        { class: "muted team-fp" },
        el("span", {}, "Empreinte"),
        el("span", { "data-no-i18n": true }, ` ${p.fingerprint}`),
        p.addr ? el("span", { "data-no-i18n": true }, ` · ${p.addr}`) : null,
        p.version ? el("span", { "data-no-i18n": true }, ` · Ondine ${p.version}`) : null,
      ),
      el(
        "button",
        {
          class: "btn small team-remove",
          onclick: api.handler(async () => {
            if (await run(api, "remove", { id: p.id }) !== null) {
              open = null;
              await refresh(api);
            }
          }),
        },
        "Retirer de mes collègues",
      ),
    );
  };

  // ── Sondage, annonce, inventaire ──
  const groupForm = (s: TeamState, what: string) => {
    const back = el("button", { class: "icon-btn", title: "Retour", onclick: api.handler(() => ((open = null), draw())) }, "←");
    if (what === "poll") {
      const question = el("input", { class: "clip-input", type: "text", maxlength: 200, placeholder: "La question (ex. Pizza ou sushi ?)" }) as HTMLInputElement;
      const choices = [0, 1, 2, 3].map((i) => el("input", { class: "clip-input", type: "text", maxlength: 60, placeholder: i < 2 ? "Choix" : "Choix (facultatif)" }) as HTMLInputElement);
      const go = api.handler(async () => {
        const list = pollChoices(choices.map((c) => c.value));
        if (!question.value.trim() || !list) return question.focus();
        const r = await run<{ sent: number }>(api, "poll", { question: question.value.trim(), choices: list, ids: [] });
        if (r) {
          open = null;
          api.notify({ title: "Sondage envoyé", body: `${r.sent}`, icon: "📊", priority: "low", key: "team-poll" });
          await refresh(api);
        }
      });
      return el("div", { class: "team-sheet" }, el("div", { class: "team-sheet-head" }, back, el("b", {}, "📊 Sondage express")), question, el("div", { class: "team-choices" }, ...choices), el("button", { class: "btn small primary", onclick: go }, "Envoyer à tous"));
    }
    if (what === "announce") {
      const text = el("textarea", { class: "clip-input team-text", rows: 2, maxlength: 280, placeholder: "Ex. Le serveur redémarre à 18 h" }) as HTMLTextAreaElement;
      const go = api.handler(async () => {
        if (!text.value.trim()) return text.focus();
        const r = await run<{ sent: number }>(api, "announce", { text: text.value.trim(), ids: [] });
        if (r) {
          open = null;
          draw();
        }
      });
      return el("div", { class: "team-sheet" }, el("div", { class: "team-sheet-head" }, back, el("b", {}, "📣 Annonce au groupe")), text, el("button", { class: "btn small primary", onclick: go }, "Envoyer à tous"));
    }
    // L'inventaire : les PC qui l'acceptent.
    const rows = s.peers
      .filter((p) => p.report)
      .map((p) => {
        const r = p.report!.data;
        return el(
          "div",
          { class: "team-inv" },
          el("b", { "data-no-i18n": true }, p.name),
          el("small", { class: "muted", "data-no-i18n": true }, `${r.os} · Ondine ${r.ondine}`),
          r.rebootPending ? el("span", { class: "team-tag warn" }, "Redémarrage en attente") : null,
          ...r.disks.filter(diskLow).map((d) => el("span", { class: "team-tag warn", "data-no-i18n": true }, `💽 ${d.mount} ${d.freeGb} Go`)),
        );
      });
    return el(
      "div",
      { class: "team-sheet" },
      el("div", { class: "team-sheet-head" }, back, el("b", {}, "🛠️ Inventaire de l'équipe")),
      el("p", { class: "muted" }, "Seulement les PC qui l'acceptent (réglage « Partager l'inventaire » chez eux, et vous marqué « IT » de leur côté)."),
      ...(rows.length ? rows : [el("p", { class: "muted" }, "Aucune réponse pour l'instant.")]),
      el("button", { class: "btn small", onclick: api.handler(() => run(api, "inventory").then(() => refresh(api))) }, "↻ Redemander"),
    );
  };

  const redraw = () => draw();
  redraws.add(redraw);
  void refresh(api);
  draw();
  // Le compte à rebours du code : une fois par seconde, seulement le chiffre.
  tick = window.setInterval(() => {
    const clock = body.querySelector(".team-clock");
    if (!clock) return;
    const secs = Math.max(0, Math.round((codeUntil - Date.now()) / 1000));
    if (secs <= 0) return draw();
    clock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  }, 1000);
  return () => {
    redraws.delete(redraw);
    window.clearInterval(tick);
  };
}

function reportBox(r: NonNullable<PeerView["report"]>["data"]): HTMLElement {
  return el(
    "div",
    { class: "team-report" },
    el("small", { "data-no-i18n": true }, `${r.host} · ${r.os}`),
    el("small", { "data-no-i18n": true }, `CPU ${Math.round(r.cpuPct)} % · RAM ${Math.round(r.memPct)} %`),
    ...r.disks.map((d) => el("small", { class: diskLow(d) ? "team-warn" : "", "data-no-i18n": true }, `💽 ${d.mount} ${d.freeGb} / ${d.totalGb} Go`)),
    r.rebootPending ? el("small", { class: "team-warn" }, "Redémarrage en attente") : null,
  );
}

async function toggleVisible(api: ModuleApi, on: boolean) {
  await settingsStore.update((d) => {
    const entry = (d.modules.team ??= { enabled: true, values: {} });
    entry.values.visible = on;
  });
  if (on) void run(api, "search");
  await refresh(api);
}

async function showCode(api: ModuleApi, mine: boolean) {
  if (await run(api, "show_code", { mine })) await refresh(api);
}

async function ask(api: ModuleApi, p: PeerView) {
  if (await run(api, "ask", { id: p.id })) api.notify({ title: "Sonnette envoyée", body: p.name, icon: "🔔", priority: "low", key: `team-ask-${p.id}` });
}

async function invite(api: ModuleApi, kind: "coffee" | "lunch", minutes: number) {
  const r = await run<{ sent: number }>(api, "invite", { kind, minutes, ids: [] });
  if (r) api.notify({ title: kind === "lunch" ? "Invitation au déjeuner envoyée" : "Invitation au café envoyée", body: `${r.sent}`, icon: kind === "lunch" ? "🍽️" : "☕", priority: "low", key: "team-invite" });
}

/** Pomodoro d'équipe : je lance le mien, les collègues peuvent rejoindre. */
async function teamPomodoro(api: ModuleApi) {
  const minutes = 25;
  const r = await run<{ sent: number }>(api, "pomodoro", { minutes, ids: [] });
  if (!r) return;
  api.emit("timer.start", { minutes });
  api.notify({ title: "Pomodoro d'équipe", body: `${minutes} min`, icon: "🍅", priority: "low", key: "team-pomodoro" });
}

async function helpRequest(api: ModuleApi, p: PeerView) {
  // L'image copiée (Win+Maj+S) est jointe si le presse-papiers en a une ; sinon le résumé seul.
  try {
    await api.invoke("help", { id: p.id, note: "", withImage: true });
  } catch {
    if ((await run(api, "help", { id: p.id, note: "", withImage: false })) === null) return;
  }
  api.notify({ title: "Demande d'aide envoyée", body: p.name, icon: "🆘", priority: "normal", key: "team-help" });
}

export const team: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    listen(api);
    sendLook(api);
    const stop = settingsStore.onChange(() => sendLook(api));
    void refresh(api);
    return stop;
  },

  views: {
    expanded,
    drop: dropTargets,
  },
};
