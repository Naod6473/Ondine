// Module « Équipe » : le chat (1.2.2). L'icône 💬 de l'onglet ouvre la liste
// des conversations (le salon « Toute l'équipe », puis les collègues en ligne,
// avec leur pastille de présence), puis un fil en bulles, comme Parler à
// Ondine (mêmes classes .ask-bubble).
//
// Le Rust (team_chat.rs) envoie, reçoit et range les messages ; ici : la vue,
// et les notifications de ce qui arrive (sujet « team.chat ») :
//   - un message d'un collègue arrive directement (pas d'« Accepter ») ; une
//     notification dans l'île compacte, avec « Répondre » : la réponse se tape
//     sur place, dans l'alerte, sans ouvrir l'onglet ;
//   - en concentration ou en réunion : une notification discrète (basse
//     priorité, courte, sans réaction de la mascotte) ;
//   - un lien n'est jamais ouvert tout seul : c'est un bouton, qui demande au
//     Rust de l'ouvrir (http ou https seulement, et seulement s'il est dans la
//     conversation) ;
//   - une réaction reçue (👍 😂 ❤️) est jouée par la mascotte de l'île, sauf
//     en concentration, en réunion, avec Calme ou les animations réduites.
// Glisser un fichier sur l'île pendant qu'une conversation à deux est ouverte :
// la première cible est ce collègue (l'envoi de fichier habituel, à accepter).

import { Bridge } from "../../core/bridge";
import { errorText } from "../../core/log";
import type { DropTarget, ModuleApi } from "../../core/module-types";
import { settingsStore } from "../../core/settings-store";
import { el } from "../../island/dom";
import { reducedMotion } from "../../island/tab-pill";
import { discreet, GROUP, lastReadIndex, linkParts, MAX_CHAT, preview, reactionCounts, reactionEmotion, REACTIONS, roomOrder, timeLabel, typingLabel, unreadTotal, type ChatLine, type RoomView } from "./chat-logic";
import { STATUS_LABEL, type PeerView, type Status } from "./logic";

/** Ce que le chat demande au reste du module (index.ts). */
export interface ChatContext {
  peers(): PeerView[];
  myStatus(): Status;
}

/** Qui a écrit (dans « team.chat »). */
interface ChatFrom {
  id: string;
  name: string;
  color: string;
}

let rooms: RoomView[] = [];
let keep = false;
/** La conversation affichée dans l'île en ce moment (undefined : le chat n'est pas affiché). */
let viewing: string | null | undefined;
/** La dernière conversation à deux regardée, et quand (cible de dépôt). */
let lastRoom: { room: string; at: number } | null = null;
/** À ouvrir à la prochaine vue de l'onglet (« Ouvrir la conversation »). */
let pendingRoom: string | null = null;
/** Ce qui est tapé et pas encore envoyé, par conversation. */
const drafts = new Map<string, string>();
const listeners = new Set<() => void>();
/** L'onglet ouvert peut afficher tout de suite une conversation demandée. */
let openHandler: ((room: string) => void) | null = null;

async function refreshRooms(api: ModuleApi) {
  try {
    const s = await api.invoke<{ rooms: RoomView[]; keep: boolean; receipts: boolean }>("chat_state");
    rooms = s.rooms ?? [];
    keep = s.keep === true;
  } catch {
    return; // hors de l'appli (navigateur)
  }
  for (const l of listeners) l();
}

/** Les non lus en tout (la pastille de l'icône 💬). */
export function chatUnread(): number {
  return unreadTotal(rooms);
}

/** Animations calmes : animations réduites de Windows, ou réglage Calme de la mascotte. */
function still(): boolean {
  return reducedMotion() || settingsStore.current.mascot.calm === true;
}

function nameOf(ctx: ChatContext, id: string): string {
  return ctx.peers().find((p) => p.id === id)?.name ?? "Un collègue";
}

function roomTitle(ctx: ChatContext, room: string): string {
  return room === GROUP ? "Toute l'équipe" : nameOf(ctx, room);
}

/** Ouvre l'île sur une conversation. */
function openRoom(api: ModuleApi, room: string) {
  api.openIsland("team");
  // L'onglet est déjà affiché : il montre la conversation tout de suite ;
  // sinon il la lira en s'ouvrant (takePendingRoom).
  if (openHandler) openHandler(room);
  else pendingRoom = room;
}

/** L'onglet Équipe affiché sait ouvrir une conversation (null : il n'est plus affiché). */
export function setChatOpener(fn: ((room: string) => void) | null) {
  openHandler = fn;
}

/** La conversation demandée par une notification (lue une fois). */
export function takePendingRoom(): string | null {
  const r = pendingRoom;
  pendingRoom = null;
  return r;
}

// ── Ce qui arrive ───────────────────────────────────────────────────────────

export function chatSetup(api: ModuleApi, ctx: ChatContext): () => void {
  const off = api.on("team.chat", (msg) => {
    const e = msg.payload as { kind: string; room?: string; line?: ChatLine; from?: ChatFrom; reaction?: string; added?: boolean };
    void refreshRooms(api);
    if (e.kind === "message" && e.room && e.line && e.from) {
      // Déjà sous les yeux : rien à notifier, c'est lu.
      if (viewing === e.room) void api.invoke("chat_read", { room: e.room }).catch(() => {});
      else notifyMessage(api, ctx, e.room, e.line, e.from);
    }
    if (e.kind === "react" && e.added && e.reaction && !discreet(ctx.myStatus()) && !still()) {
      api.emit("mascot.emote", { emotion: reactionEmotion(e.reaction) });
    }
  });
  void refreshRooms(api);
  return off;
}

function notifyMessage(api: ModuleApi, ctx: ChatContext, room: string, line: ChatLine, from: ChatFrom) {
  const title = room === GROUP ? `💬 ${from.name} · Toute l'équipe` : `💬 ${from.name}`;
  const quiet = discreet(ctx.myStatus());
  api.notify({
    title,
    body: preview(line.text),
    icon: "💬",
    // En concentration ou en réunion : discrète (l'île compacte, quelques secondes).
    priority: quiet ? "low" : "normal",
    durationMs: quiet ? 4000 : 8000,
    key: `team-chat-${room}`,
    actions: [
      { label: "Répondre", run: () => replyHere(api, ctx, room) },
      { label: "Ouvrir", run: () => openRoom(api, room) },
    ],
  });
}

/** « Répondre » : la réponse se tape dans l'alerte, sans ouvrir l'onglet. */
function replyHere(api: ModuleApi, ctx: ChatContext, room: string) {
  api.notify({
    title: room === GROUP ? "Répondre à toute l'équipe" : `Répondre à ${roomTitle(ctx, room)}`,
    icon: "💬",
    priority: "high",
    sticky: true,
    key: `team-chat-${room}`,
    content: (host) => mountReply(host, api, room),
    actions: [{ label: "Ouvrir la conversation", run: () => openRoom(api, room) }],
  });
}

function mountReply(host: HTMLElement, api: ModuleApi, room: string): () => void {
  const recent = el("div", { class: "team-chat-recent" });
  const input = el("textarea", { class: "clip-input team-chat-input", rows: 1, maxlength: MAX_CHAT, placeholder: "Votre réponse…", "aria-label": "Votre réponse" }) as HTMLTextAreaElement;
  input.value = drafts.get(room) ?? "";
  const status = el("small", { class: "muted" });
  const send = api.handler(async () => {
    const text = input.value.trim();
    if (!text) return input.focus();
    try {
      await api.invoke("chat_send", { room, text });
      drafts.delete(room);
      // Même clé : l'alerte de réponse est remplacée par un petit « Envoyé ».
      api.notify({ title: "Envoyé", body: preview(text, 60), icon: "💬", priority: "low", durationMs: 2000, key: `team-chat-${room}` });
      void refreshRooms(api);
    } catch (err) {
      status.textContent = errorText(err);
    }
  });
  input.addEventListener("input", () => {
    drafts.set(room, input.value);
    void api.invoke("chat_typing", { room }).catch(() => {});
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  host.append(recent, el("div", { class: "team-chat-compose" }, input, el("button", { class: "btn small primary", onclick: send }, "Envoyer")), status);
  // Les deux derniers messages, pour répondre en connaissant le contexte.
  void api
    .invoke<{ lines: ChatLine[] }>("chat_history", { room })
    .then((h) => {
      const last = h.lines.filter((l) => l.kind === "text").slice(-2);
      recent.replaceChildren(...last.map((l) => el("div", { class: `ask-bubble ${l.from ? "ondine" : "me"}` }, el("div", { class: "ask-bubble-text", "data-no-i18n": "" }, preview(l.text, 200)))));
      void api.invoke("chat_read", { room }).catch(() => {});
    })
    .catch(() => {});
  // Le clavier va à l'île le temps de répondre ; rendu à l'appli d'avant ensuite.
  void Bridge.islandSetFocus(true);
  queueMicrotask(() => input.focus());
  return () => {
    window.setTimeout(() => {
      if (document.querySelector(".island")?.getAttribute("data-state") !== "expanded") void Bridge.islandSetFocus(false);
    }, 50);
  };
}

// ── La cible de dépôt : le collègue de la conversation ouverte ──────────────

/** Une conversation à deux regardée il y a moins de 2 minutes : sa cible passe en premier. */
export function chatDropTarget(ctx: ChatContext): DropTarget | null {
  if (!lastRoom || Date.now() - lastRoom.at > 2 * 60_000) return null;
  const room = lastRoom.room;
  const p = ctx.peers().find((x) => x.id === room && x.online);
  if (!p) return null;
  return {
    id: `team-chat-${p.id}`,
    label: `💬 ${p.name}`,
    icon: "💬",
    onDrop: async (paths, api) => {
      try {
        const r = await api.invoke<{ name: string }>("chat_files", { room, paths });
        api.notify({ title: "Proposé", body: `${p.name} · ${r.name}`, icon: "📤", priority: "low", key: `team-file-${p.id}` });
        void refreshRooms(api);
      } catch (err) {
        api.notify({ title: "Équipe", body: errorText(err), icon: "⚠️", priority: "normal", key: "team-error" });
      }
    },
  };
}

// ── La vue : la liste, puis le fil ──────────────────────────────────────────

export interface ChatPane {
  node: HTMLElement;
  /** null : la liste des conversations. */
  show(room: string | null): void;
  /** Les collègues ont changé (présence) : on redessine. */
  refresh(): void;
  destroy(): void;
}

function dot(color: string, status: Status): HTMLElement {
  const d = el("span", { class: `team-dot team-st-${status}`, title: STATUS_LABEL[status] });
  d.style.setProperty("--peer", /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#5cc8ff");
  return d;
}

export function chatPane(api: ModuleApi, ctx: ChatContext, back: () => void): ChatPane {
  const node = el("div", { class: "team-chat" });
  let room: string | null = null;
  let lines: ChatLine[] = [];
  let typing: string[] = [];
  /** Les messages déjà montrés (les nouveaux arrivent avec une petite animation). */
  let seen = new Set<number>();
  let thread: HTMLElement | null = null;
  let input: HTMLTextAreaElement | null = null;
  let typingTimer = 0;

  const load = async () => {
    if (room === null) return;
    const r = room;
    try {
      const h = await api.invoke<{ lines: ChatLine[]; typing: string[] }>("chat_history", { room: r });
      if (room !== r) return;
      lines = h.lines ?? [];
      typing = h.typing ?? [];
    } catch {
      return;
    }
    drawThread();
    void api.invoke("chat_read", { room: r }).catch(() => {});
    // « … écrit » s'efface tout seul au bout de quelques secondes.
    window.clearTimeout(typingTimer);
    if (typing.length) typingTimer = window.setTimeout(() => void load(), 6500);
  };

  // ── La liste ──
  const drawList = () => {
    const info = new Map(rooms.map((r) => [r.room, r]));
    const badge = (n: number) => (n > 0 ? el("span", { class: "team-chat-badge", "data-no-i18n": true }, n > 99 ? "99+" : String(n)) : null);
    const last = (r: RoomView | undefined) => {
      if (!r) return null;
      if (r.typing.length) return el("small", { class: "muted team-chat-prev" }, typingLabel(r.typing.map((id) => nameOf(ctx, id))));
      if (!r.last) return null;
      const text = r.last.kind === "text" ? r.last.text : `📎 ${r.last.text}`;
      const who = r.last.from === "" ? el("span", {}, "Vous :") : r.room === GROUP ? el("span", { "data-no-i18n": true }, `${nameOf(ctx, r.last.from)} :`) : null;
      return el("small", { class: "muted team-chat-prev" }, who, who ? " " : null, el("span", { "data-no-i18n": true }, preview(text, 60)));
    };
    const online = ctx.peers().filter((p) => p.online).length;
    const group = el(
      "button",
      { class: "team-chat-room", onclick: api.handler(() => show(GROUP)) },
      el("span", { class: "team-chat-avatar" }, "👥"),
      el("span", { class: "team-chat-room-main" }, el("b", {}, "Toute l'équipe"), last(info.get(GROUP)) ?? el("small", { class: "muted" }, `${online} en ligne`)),
      badge(info.get(GROUP)?.unread ?? 0),
    );
    const people = roomOrder(ctx.peers(), rooms).map((p) =>
      el(
        "button",
        { class: `team-chat-room ${p.online ? "" : "off"}`, onclick: api.handler(() => show(p.id)) },
        dot(p.color, p.status),
        el("span", { class: "team-chat-room-main" }, el("b", { "data-no-i18n": true }, p.name), last(info.get(p.id)) ?? el("small", { class: "muted" }, STATUS_LABEL[p.status])),
        badge(info.get(p.id)?.unread ?? 0),
      ),
    );
    node.replaceChildren(
      el("div", { class: "team-sheet-head" }, el("button", { class: "icon-btn", title: "Retour", onclick: api.handler(back) }, "←"), el("b", {}, "💬 Chat d'équipe")),
      el("div", { class: "team-chat-rooms" }, group, ...people),
      ...(people.length ? [] : [el("p", { class: "muted" }, "Aucun collègue en ligne pour l'instant.")]),
      el("small", { class: "muted team-chat-foot" }, keep ? "🔒 Historique gardé 7 jours sur ce PC, chiffré." : "🔒 Chiffré de bout en bout. Historique en mémoire seulement : effacé quand vous quittez Ondine."),
    );
    thread = null;
    input = null;
  };

  // ── Le fil ──
  const bubble = (l: ChatLine, i: number, readAt: number): HTMLElement => {
    const fresh = !seen.has(l.id) && seen.size > 0 && !still() ? " fresh" : "";
    if (l.kind !== "text") {
      const out = l.kind === "file-out";
      return el(
        "div",
        { class: `team-chat-note${fresh}` },
        el("span", {}, out ? "📤 Fichier proposé" : "📥 Fichier reçu, à accepter"),
        el("span", { "data-no-i18n": true }, ` · ${l.text}`),
      );
    }
    const mine = l.from === "";
    const parts = linkParts(l.text).map((p) =>
      p.link
        ? el(
            "button",
            {
              class: "team-chat-link",
              "data-no-i18n": true,
              title: "Ouvrir le lien (jamais ouvert tout seul)",
              onclick: api.handler(async () => {
                try {
                  await api.invoke("chat_open_link", { room, url: p.link });
                } catch (err) {
                  api.notify({ title: "Équipe", body: errorText(err), icon: "⚠️", priority: "normal", key: "team-error" });
                }
              }),
            },
            `🔗 ${p.text}`,
          )
        : document.createTextNode(p.text),
    );
    const counts = reactionCounts(l.reactions ?? []);
    const peer = !mine ? ctx.peers().find((p) => p.id === l.from) : undefined;
    const author = room === GROUP && !mine ? el("small", { class: "team-chat-author", "data-no-i18n": true }, peer?.name ?? "Un collègue") : null;
    if (author && peer) author.style.color = peer.color;
    const bar = el(
      "span",
      { class: "team-chat-react" },
      ...REACTIONS.map((r) => el("button", { class: "icon-btn", title: r.label, "aria-label": r.label, onclick: api.handler(() => react(l.id, r.kind)) }, r.icon)),
    );
    return el(
      "div",
      { class: `ask-bubble team-chat-bubble ${mine ? "me" : "ondine"}${fresh}` },
      author,
      el("div", { class: "ask-bubble-text", "data-no-i18n": "" }, ...parts),
      el(
        "div",
        { class: "ask-bubble-meta" },
        el("small", { class: "muted", "data-no-i18n": true }, timeLabel(l.at)),
        ...counts.map((c) => el("span", { class: `team-chat-count ${c.mine ? "mine" : ""}`, "data-no-i18n": true }, c.count > 1 ? `${c.icon} ${c.count}` : c.icon)),
        i === readAt ? el("small", { class: "team-chat-read" }, "Lu") : null,
        bar,
      ),
    );
  };

  const drawThread = () => {
    if (room === null || !thread) return;
    const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40;
    const readAt = room === GROUP ? -1 : lastReadIndex(lines);
    const items: HTMLElement[] = lines.map((l, i) => bubble(l, i, readAt));
    if (typing.length) {
      const dots = el("div", { class: `ask-bubble ondine typing ${still() ? "still" : ""}`, "aria-hidden": "true" }, el("span"), el("span"), el("span"));
      items.push(el("div", { class: "team-chat-typing" }, dots, el("small", { class: "muted" }, typingLabel(typing.map((id) => nameOf(ctx, id))))));
    }
    if (!lines.length && !typing.length) items.push(el("p", { class: "muted team-chat-empty" }, room === GROUP ? "Écrivez à tous les collègues en ligne." : "Aucun message pour l'instant."));
    thread.replaceChildren(...items);
    seen = new Set(lines.map((l) => l.id));
    if (atBottom || !thread.dataset.scrolled) {
      thread.scrollTop = thread.scrollHeight;
      thread.dataset.scrolled = "1";
    }
  };

  const react = async (id: number, kind: string) => {
    try {
      await api.invoke("chat_react", { room, id, kind });
      await load();
    } catch (err) {
      api.notify({ title: "Équipe", body: errorText(err), icon: "⚠️", priority: "normal", key: "team-error" });
    }
  };

  const send = async () => {
    if (room === null || !input) return;
    const text = input.value.trim();
    if (!text) return input.focus();
    const box = input;
    box.disabled = true;
    try {
      await api.invoke("chat_send", { room, text });
      box.value = "";
      drafts.delete(room);
      await load();
    } catch (err) {
      api.notify({ title: "Message non envoyé", body: errorText(err), icon: "⚠️", priority: "normal", key: "team-error" });
    } finally {
      box.disabled = false;
      box.focus();
    }
  };

  const drawRoom = () => {
    if (room === null) return;
    const r = room;
    const peer = r === GROUP ? null : ctx.peers().find((p) => p.id === r);
    const offline = r === GROUP ? !ctx.peers().some((p) => p.online) : !peer?.online;
    const head = el(
      "div",
      { class: "team-sheet-head" },
      el("button", { class: "icon-btn", title: "Retour", onclick: api.handler(() => show(null)) }, "←"),
      peer ? dot(peer.color, peer.status) : el("span", {}, "👥"),
      el("b", { "data-no-i18n": r !== GROUP }, roomTitle(ctx, r)),
      peer ? el("small", { class: "muted" }, STATUS_LABEL[peer.status]) : null,
      el("span", { class: "team-grow" }),
      el(
        "button",
        {
          class: "icon-btn",
          title: "Effacer cette conversation",
          "aria-label": "Effacer cette conversation",
          onclick: api.handler(async () => {
            await api.invoke("chat_clear", { room: r }).catch(() => {});
            await load();
            void refreshRooms(api);
          }),
        },
        "🧹",
      ),
    );
    thread = el("div", { class: "team-chat-thread", role: "log", "aria-live": "polite" });
    const box = el("textarea", {
      class: "clip-input team-chat-input",
      rows: 1,
      maxlength: MAX_CHAT,
      disabled: offline,
      placeholder: offline ? "Hors ligne : le message ne peut pas partir" : r === GROUP ? "Écrire à toute l'équipe…" : "Écrire un message…",
      "aria-label": "Message",
    }) as HTMLTextAreaElement;
    box.value = drafts.get(r) ?? "";
    box.addEventListener("input", () => {
      drafts.set(r, box.value);
      if (box.value.trim()) void api.invoke("chat_typing", { room: r }).catch(() => {});
    });
    box.addEventListener(
      "keydown",
      api.handler((e: KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          void send();
        }
      }),
    );
    input = box;
    node.replaceChildren(
      head,
      thread,
      el("div", { class: "team-chat-compose" }, box, el("button", { class: "btn small primary", disabled: offline, onclick: api.handler(send) }, "Envoyer")),
      r === GROUP ? el("small", { class: "muted team-chat-foot" }, "Chacun voit les messages des collègues avec qui il est appairé.") : el("small", { class: "muted team-chat-foot" }, "Glissez un fichier sur l'île pour le proposer (toujours à accepter)."),
    );
    seen = new Set();
    drawThread();
    void load();
    if (!offline) queueMicrotask(() => box.focus());
  };

  const show = (next: string | null) => {
    room = next;
    viewing = next;
    lines = [];
    typing = [];
    if (next !== null && next !== GROUP) lastRoom = { room: next, at: Date.now() };
    if (next === null) drawList();
    else drawRoom();
  };

  const onRooms = () => {
    if (room === null) drawList();
    else void load();
    if (room !== null && room !== GROUP) lastRoom = { room, at: Date.now() };
  };
  listeners.add(onRooms);
  viewing = null;
  show(null);

  return {
    node,
    show,
    refresh: () => {
      // Pas de redessin complet dans le fil : la zone de saisie garde sa place et son texte.
      if (room === null) drawList();
    },
    destroy: () => {
      listeners.delete(onRooms);
      window.clearTimeout(typingTimer);
      viewing = undefined;
    },
  };
}

/** Le bouton 💬 de l'en-tête, avec la pastille des non lus. */
export function chatButton(api: ModuleApi, onClick: () => void): HTMLElement {
  const n = chatUnread();
  return el(
    "button",
    { class: "btn small team-chat-btn", title: "Discuter avec vos collègues", "aria-label": "Discuter avec vos collègues", onclick: api.handler(onClick) },
    "💬",
    n > 0 ? el("span", { class: "team-chat-badge", "data-no-i18n": true }, n > 99 ? "99+" : String(n)) : null,
  );
}

/** Le bouton 💬 se redessine quand les non lus changent. */
export function onChatChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
