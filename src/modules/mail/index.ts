// Module « Mail » (prototype) : les derniers mails dans l'île, un résumé et
// une réponse proposés par Ondine, et l'envoi d'un mail avec une pièce jointe.
//
// Le Rust (src-tauri/src/modules/mail.rs) parle à Gmail ou à Outlook et à
// l'IA de « Parler à Ondine ». Ici, quatre écrans :
//   - la liste des derniers mails ;
//   - un mail ouvert (son texte n'est demandé qu'à ce moment), avec
//     « Résumer » et « Proposer une réponse » ;
//   - la rédaction (nouveau mail ou réponse), avec une pièce jointe ;
//   - l'aperçu de l'envoi : TOUT ce qui part, et le bouton « Envoyer ».
// Le Rust n'envoie que l'aperçu montré (`prepare` puis `send` avec son numéro).
//
// `mail.new` (Rust) : un nouveau mail est arrivé → notification (expéditeur et
// objet). `mail.changed` : la connexion a changé → l'onglet se redessine.

import manifest from "./manifest.json";
import { Bridge } from "../../core/bridge";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";
import { fileName, shortDate, sizeText } from "./format";

interface Status {
  provider: "gmail" | "outlook";
  label: string;
  configured: boolean;
  secretMissing: boolean;
  connected: boolean;
  account: string;
  connecting: boolean;
  error: string | null;
  destination: string;
  ai: string | null;
}

interface Summary {
  id: string;
  from: string;
  fromAddr: string;
  subject: string;
  at: number;
  unread: boolean;
}

interface Message extends Summary {
  to: string;
  body: string;
  cut: boolean;
}

interface Draft {
  to: string;
  subject: string;
  body: string;
  path: string;
  /** Réponse à ce mail (son identifiant), sinon "". */
  replyTo: string;
}

interface Preview {
  id: number;
  to: string[];
  subject: string;
  body: string;
  attachment: { name: string; size: number } | null;
  reply: boolean;
  from: string;
  destination: string;
}

type Screen = { kind: "list" } | { kind: "read"; id: string } | { kind: "compose" } | { kind: "preview"; preview: Preview };

let status: Status | null = null;
let items: Summary[] = [];
let screen: Screen = { kind: "list" };
let draft: Draft = emptyDraft();
/** Le résumé ou la réponse proposée pour le mail ouvert. */
let aiText: { id: string; kind: "summary" | "reply"; text: string; destination: string } | null = null;
let busy = "";
let error = "";
const redraws = new Set<() => void>();

function emptyDraft(): Draft {
  return { to: "", subject: "", body: "", path: "", replyTo: "" };
}

const redraw = () => redraws.forEach((r) => r());

async function refreshStatus(api: ModuleApi) {
  try {
    status = await api.invoke<Status>("status");
  } catch {
    status = null; // hors de l'appli (navigateur) : rien à montrer
  }
}

async function refreshList(api: ModuleApi) {
  if (!status?.connected) return;
  busy = "list";
  redraw();
  try {
    items = (await api.invoke<{ items: Summary[] }>("list")).items;
    error = "";
  } catch (e) {
    error = errorText(e);
  } finally {
    busy = "";
    redraw();
  }
}

/** Lance une commande en montrant « … » et l'erreur éventuelle. */
async function attempt<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
  busy = what;
  error = "";
  redraw();
  try {
    return await fn();
  } catch (e) {
    error = errorText(e);
    return undefined;
  } finally {
    busy = "";
    redraw();
  }
}

export const mail: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    const offNew = api.on("mail.new", (msg) => {
      const p = msg.payload as { count: number; id: string; from: string; subject: string };
      api.notify({
        title: p.count > 1 ? `${p.count} nouveaux mails` : `Mail de ${p.from}`,
        body: p.subject || "(sans objet)",
        icon: "✉️",
        priority: "normal",
        key: "mail-new",
        actions: [
          {
            label: "Ouvrir",
            run: () => {
              screen = p.count > 1 ? { kind: "list" } : { kind: "read", id: p.id };
              api.openIsland("mail");
              void refreshList(api);
            },
          },
        ],
      });
      if (redraws.size) void refreshList(api);
    });
    const offChanged = api.on("mail.changed", () => {
      void refreshStatus(api).then(() => {
        redraw();
        void refreshList(api);
      });
    });
    void refreshStatus(api);
    return () => {
      offNew();
      offChanged();
    };
  },

  views: {
    expanded(root, api) {
      const host = el("div", { class: "mail" });
      root.append(host);

      const draw = () => {
        host.replaceChildren();
        if (!status) {
          host.append(el("p", { class: "muted" }, "La messagerie n'est disponible que dans l'appli Ondine."));
          return;
        }
        if (!status.connected) return host.append(...connectPane(api, status));
        const top = el(
          "div",
          { class: "mail-top" },
          el("small", { class: "muted", "data-no-i18n": "" }, status.account || status.label),
          el("span", { class: "mail-spacer" }),
          screen.kind === "list"
            ? el("button", { class: "btn small", title: "Recharger la liste", disabled: busy !== "", onclick: api.handler(() => refreshList(api)) }, "⟳")
            : el("button", { class: "btn small", onclick: api.handler(() => go({ kind: "list" })) }, "← Mails"),
          screen.kind === "list"
            ? el("button", { class: "btn small primary", onclick: api.handler(() => compose(emptyDraft())) }, "✏️ Écrire")
            : null,
          screen.kind === "list"
            ? el(
                "button",
                {
                  class: "icon-btn",
                  title: "Déconnecter le compte",
                  onclick: api.handler(async () => {
                    const s = await attempt("disconnect", () => api.invoke<Status>("disconnect"));
                    if (s) status = s;
                    items = [];
                    draw();
                  }),
                },
                "⏏",
              )
            : null,
        );
        host.append(top);
        if (error) host.append(el("p", { class: "mail-error", role: "alert", "data-no-i18n": "" }, `⚠️ ${error}`));
        if (screen.kind === "list") host.append(listPane());
        else if (screen.kind === "read") host.append(readPane(screen.id));
        else if (screen.kind === "compose") host.append(composePane());
        else host.append(previewPane(screen.preview));
      };

      const go = (s: Screen) => {
        if (screen.kind === "preview") void api.invoke("cancel").catch(() => undefined);
        screen = s;
        error = "";
        draw();
      };

      const compose = (d: Draft) => {
        draft = d;
        go({ kind: "compose" });
      };

      // ── La liste ─────────────────────────────────────────────────────────
      const listPane = () => {
        if (busy === "list" && !items.length) return el("p", { class: "muted" }, "Lecture des derniers mails…");
        if (!items.length) return el("p", { class: "muted" }, "Aucun mail dans la boîte de réception.");
        return el(
          "ul",
          { class: "mail-list" },
          ...items.map((m) =>
            el(
              "li",
              {},
              el(
                "button",
                { class: `mail-row${m.unread ? " unread" : ""}`, onclick: api.handler(() => go({ kind: "read", id: m.id })) },
                el("span", { class: "mail-from", "data-no-i18n": "" }, m.from),
                el("span", { class: "mail-date", "data-no-i18n": "" }, shortDate(m.at)),
                el("span", { class: "mail-subject", "data-no-i18n": "" }, m.subject || "(sans objet)"),
              ),
            ),
          ),
        );
      };

      // ── Un mail ouvert ───────────────────────────────────────────────────
      const opened = new Map<string, Message>();
      const readPane = (id: string) => {
        const box = el("div", { class: "mail-read" });
        const m = opened.get(id);
        if (!m) {
          box.append(el("p", { class: "muted" }, "Ouverture du mail…"));
          void attempt("read", () => api.invoke<Message>("read", { id })).then((got) => {
            if (got) opened.set(id, got);
            if (screen.kind === "read" && screen.id === id) draw();
          });
          return box;
        }
        const ai = aiText?.id === id ? aiText : null;
        const ask = (kind: "summary" | "reply") =>
          api.handler(async () => {
            const got = await attempt(kind, () => api.invoke<{ text: string; destination: string }>(kind === "summary" ? "summarize" : "draft", { id, hint: hint.value }));
            if (got) aiText = { id, kind, text: got.text, destination: got.destination };
            draw();
          });
        const hint = el("input", { class: "clip-input", type: "text", maxlength: 500, placeholder: "Ce que la réponse doit dire (facultatif)" }) as HTMLInputElement;
        box.append(
          el("p", { class: "mail-head", "data-no-i18n": "" }, el("strong", { "data-no-i18n": "" }, m.subject || "(sans objet)")),
          el("small", { class: "muted", "data-no-i18n": "" }, `${m.from} <${m.fromAddr}> · ${shortDate(m.at)}`),
          el("pre", { class: "mail-body", "data-no-i18n": "" }, m.cut ? `${m.body}…` : m.body),
          ai
            ? el(
                "div",
                { class: "mail-ai" },
                el("p", { class: "ask-confirm-title" }, ai.kind === "summary" ? "Résumé d'Ondine" : "Réponse proposée"),
                el("pre", { class: "mail-body", "data-no-i18n": "" }, ai.text),
                ai.kind === "reply"
                  ? el(
                      "div",
                      { class: "btn-row" },
                      el(
                        "button",
                        { class: "btn small primary", onclick: api.handler(() => compose({ to: m.fromAddr, subject: "", body: ai.text, path: "", replyTo: m.id })) },
                        "Relire et envoyer",
                      ),
                    )
                  : null,
              )
            : "",
          hint,
          el(
            "div",
            { class: "btn-row" },
            el("button", { class: "btn small", disabled: busy !== "", onclick: ask("summary") }, busy === "summary" ? "Ondine lit…" : "✨ Résumer"),
            el("button", { class: "btn small", disabled: busy !== "", onclick: ask("reply") }, busy === "reply" ? "Ondine écrit…" : "💬 Proposer une réponse"),
            el("button", { class: "btn small", onclick: api.handler(() => compose({ to: m.fromAddr, subject: "", body: "", path: "", replyTo: m.id })) }, "↩ Répondre"),
          ),
          status?.ai ? el("small", { class: "muted", "data-no-i18n": "" }, `Résumer ou proposer une réponse envoie ce mail vers ${status.ai} (l'IA de Parler à Ondine).`) : "",
        );
        return box;
      };

      // ── Rédaction ────────────────────────────────────────────────────────
      const composePane = () => {
        const to = el("input", { class: "clip-input", type: "text", value: draft.to, placeholder: "Destinataire(s), séparés par des virgules", maxlength: 2000 }) as HTMLInputElement;
        const subject = el("input", {
          class: "clip-input",
          type: "text",
          value: draft.subject,
          maxlength: 250,
          placeholder: draft.replyTo ? "Objet (vide = « Re: » + l'objet d'origine)" : "Objet",
        }) as HTMLInputElement;
        const body = el("textarea", { class: "clip-input mail-text", rows: 7, maxlength: 50000, placeholder: "Votre message" }) as HTMLTextAreaElement;
        body.value = draft.body;
        const keep = () => {
          draft = { ...draft, to: to.value, subject: subject.value, body: body.value };
        };
        for (const f of [to, subject, body]) f.addEventListener("input", keep);
        const attach = draft.path
          ? el(
              "div",
              { class: "mail-attach" },
              el("span", { "data-no-i18n": "" }, `📎 ${fileName(draft.path)}`),
              el("button", { class: "icon-btn", title: "Retirer la pièce jointe", onclick: api.handler(() => { draft.path = ""; draw(); }) }, "×"),
            )
          : el(
              "button",
              {
                class: "btn small",
                onclick: api.handler(async () => {
                  keep();
                  const path = await Bridge.pickFile("Fichier à joindre", []);
                  if (path) draft.path = path;
                  draw();
                }),
              },
              "📎 Joindre un fichier",
            );
        return el(
          "div",
          { class: "mail-compose" },
          draft.replyTo ? el("small", { class: "muted" }, "Réponse au mail ouvert.") : null,
          to,
          subject,
          body,
          el(
            "div",
            { class: "btn-row" },
            attach,
            el("span", { class: "mail-spacer" }),
            el(
              "button",
              {
                class: "btn small primary",
                disabled: busy !== "",
                onclick: api.handler(async () => {
                  keep();
                  const preview = await attempt("prepare", () => api.invoke<Preview>("prepare", { ...draft }));
                  if (preview) go({ kind: "preview", preview });
                }),
              },
              "Voir avant l'envoi",
            ),
          ),
        );
      };

      // ── Aperçu : tout ce qui part, puis « Envoyer » ──────────────────────
      const previewPane = (p: Preview) =>
        el(
          "div",
          { class: "ask-bubble ondine ask-confirm mail-preview" },
          el("p", { class: "ask-confirm-title" }, "Envoyer ce mail ?"),
          el(
            "small",
            { class: "muted", "data-no-i18n": "" },
            [p.from ? `De : ${p.from}` : "", `À : ${p.to.join(", ")}`, `Objet : ${p.subject}`, p.attachment ? `📎 ${p.attachment.name} (${sizeText(p.attachment.size)})` : ""]
              .filter(Boolean)
              .join("\n"),
          ),
          el("pre", { class: "mail-body", "data-no-i18n": "" }, p.body),
          el("small", { class: "muted", "data-no-i18n": "" }, `Il partira par ${p.destination}${p.reply ? ", en réponse au mail d'origine" : ""}.`),
          el(
            "div",
            { class: "btn-row" },
            el(
              "button",
              {
                class: "btn small primary",
                disabled: busy !== "",
                onclick: api.handler(async () => {
                  const ok = await attempt("send", () => api.invoke("send", { id: p.id }));
                  if (!ok) return;
                  api.notify({ title: "Mail envoyé", body: p.subject, icon: "✉️", priority: "low", tone: "good" });
                  draft = emptyDraft();
                  screen = { kind: "list" };
                  draw();
                }),
              },
              busy === "send" ? "Envoi…" : "Envoyer",
            ),
            el("button", { class: "btn small", disabled: busy !== "", onclick: api.handler(() => go({ kind: "compose" })) }, "Modifier"),
          ),
        );

      redraws.add(draw);
      draw();
      void refreshStatus(api).then(() => {
        draw();
        if (!items.length) void refreshList(api);
      });
      return () => {
        redraws.delete(draw);
      };
    },

    drop: (api) =>
      status?.connected
        ? [
            {
              id: "mail-attach",
              label: "Joindre à un mail",
              icon: "✉️",
              onDrop(paths) {
                draft = { ...emptyDraft(), path: paths[0] ?? "" };
                screen = { kind: "compose" };
                api.openIsland("mail");
              },
            },
          ]
        : [],
  },
};

/** Pas encore de compte : ce qu'il manque, et « Se connecter ». */
function connectPane(api: ModuleApi, s: Status): HTMLElement[] {
  const out: HTMLElement[] = [el("p", { class: "ask-confirm-title" }, `Connecter ${s.label}`)];
  if (!s.configured) {
    out.push(el("p", { class: "muted" }, "Collez d'abord l'identifiant client dans les réglages du module Mail (⚙). Les étapes sont décrites sous le champ."));
  } else if (s.secretMissing) {
    out.push(el("p", { class: "muted" }, "Google demande aussi le code secret du client : ajoutez-le dans les réglages du module Mail."));
  } else {
    out.push(
      el("p", { class: "muted" }, "La page de connexion s'ouvre dans votre navigateur. Ondine demande seulement à lire et envoyer des mails : jamais à les supprimer."),
      el(
        "div",
        { class: "btn-row" },
        el(
          "button",
          {
            class: "btn small primary",
            disabled: s.connecting,
            onclick: api.handler(async () => {
              await attempt("connect", async () => {
                status = await api.invoke<Status>("connect");
              });
            }),
          },
          s.connecting ? "En attente du navigateur…" : "Se connecter",
        ),
      ),
    );
  }
  if (s.error) out.push(el("p", { class: "mail-error", role: "alert", "data-no-i18n": "" }, `⚠️ ${s.error}`));
  if (error) out.push(el("p", { class: "mail-error", role: "alert", "data-no-i18n": "" }, `⚠️ ${error}`));
  return out;
}
