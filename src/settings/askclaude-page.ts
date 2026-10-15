// Les blocs en plus de la page « Parler à Ondine » des réglages (en 1.2.2,
// ils ont quitté l'île pour qu'elle reste claire à l'usage) :
//   - « Ce qui part » (sous-menu Général) : vers où, et quoi, à chaque
//     message ; les noms de fichiers trouvés ; la voix ;
//   - « Consigne exacte » (sous-menu Personnalité) : la consigne complète
//     telle qu'elle part (personnalité, humeurs, outils), à relire ;
//   - « Parakeet sur le PC » (sous-menu Voix et sons, 1.2.4) : télécharger,
//     annuler ou supprimer le modèle de la reconnaissance sur le PC
//     (voice/parakeet-block.ts, partagé avec Dictée et Notes d'appel).
//   - « Micro » et « « Dis Ondine » » (sous-menu Voix et sons, 1.2.4) : le
//     choix du micro, « Tester le micro », le mot d'appel (mic-block.ts).
//   - « Modèles du serveur » (sous-menu Fournisseur et modèles, 1.2.4) : pour
//     un serveur local ou OpenRouter, la liste des modèles, demandée sur un
//     clic ; un clic sur un modèle le choisit.
//
// Tout vient de la commande `status` du module (le Rust sait ce qui part) ;
// hors de l'appli ou module coupé, les blocs disent simplement de l'activer.

import { Bridge } from "../core/bridge";
import { el } from "../island/dom";
import { filterModels, localSentText, modelKey, type ServerModel } from "./askclaude-models";
import { group, inSub, wideRow } from "./controls";
import { micBlock, wakeBlock, watchHotkeyProblems } from "./mic-block";
import { parakeetBlock } from "./voice/parakeet-block";

interface Status {
  provider?: string;
  model?: string;
  onThisPc?: boolean;
  destination: string;
  system: string;
  maxTurns: number;
  fileTools: boolean;
  pcTools: boolean;
  voice?: { engine: string; destination: string | null; offline?: { ready: boolean; name: string | null } | null };
}

/** Ce qui part à chaque message (une phrase entière pour la traduction). */
export function sentText(destination: string, maxTurns: number): string {
  return `À chaque message partent vers ${destination} : la personnalité d'Ondine, les ${maxTurns} derniers messages au plus (avec leurs fichiers joints) et votre nouveau message. Rien n'est gardé sur le disque.`;
}

/** La voix : par Windows, ou l'audio vers l'API choisie. */
export function voiceText(engine: string, destination: string | null, offlineReady?: boolean): string {
  if (engine === "offline") {
    return offlineReady === false
      ? "Dictée hors ligne choisie, mais la reconnaissance vocale de votre langue n'est pas installée dans Windows : Paramètres Windows → Heure et langue → Langue et région → votre langue → Options de langue → Reconnaissance vocale."
      : "Quand vous parlez à Ondine, le moteur de reconnaissance installé dans Windows écrit vos mots sur le PC : rien ne le quitte, rien n'est enregistré sur le disque.";
  }
  if (engine === "parakeet")
    return "Quand vous parlez à Ondine, le modèle Parakeet écrit vos mots sur le PC : rien ne le quitte, rien n'est enregistré sur le disque. Il faut l'avoir téléchargé une fois (Voix et sons).";
  if (engine === "api" && destination) return `Quand vous parlez à Ondine, l'audio de votre voix part vers ${destination} pour être écrit en texte. Il reste en mémoire, jamais sur le disque.`;
  return "Quand vous parlez à Ondine, la reconnaissance vocale de Windows écrit vos mots. Pour la dictée, Windows passe par son service en ligne (réglage « Reconnaissance vocale en ligne » de Windows). Rien n'est enregistré sur le disque.";
}

/** Les deux blocs, rangés dans leur sous-menu (`general`, `persona`). */
export function askclaudeGroups(pick: (key: string, value: unknown) => void): HTMLElement[] {
  watchHotkeyProblems();
  const models = el("div", { class: "ask-models" });
  const sent = el("div", { class: "ask-sent" }, el("p", { class: "muted" }, "…"));
  const system = el("pre", { class: "ask-system", hidden: true, "data-no-i18n": "" });
  const show = el("button", { class: "btn small" }, "Voir la consigne exacte");
  show.addEventListener("click", () => {
    system.hidden = !system.hidden;
    show.textContent = system.hidden ? "Voir la consigne exacte" : "Masquer la consigne exacte";
  });

  void Bridge.moduleInvoke<Status>("askclaude", "status", null)
    .then((s) => {
      const lines = [s.onThisPc ? localSentText(s.destination, s.maxTurns) : sentText(s.destination, s.maxTurns)];
      drawModels(models, s, pick);
      if (s.fileTools) lines.push("Ondine peut chercher vos fichiers par leur nom : les noms trouvés partent aussi. Pour lire ou créer un fichier, elle vous demande d'abord.");
      if (s.pcTools) lines.push("Ondine peut aussi régler le PC quand vous le lui demandez. Pour ouvrir une application ou un site, elle vous demande d'abord.");
      if (s.voice) lines.push(voiceText(s.voice.engine, s.voice.destination, s.voice.offline?.ready));
      sent.replaceChildren(...lines.map((l) => el("p", {}, l)));
      system.textContent = s.system;
    })
    .catch(() => {
      sent.replaceChildren(el("p", { class: "muted" }, "Activez le module pour voir ce qui part."));
      show.disabled = true;
    });

  // Caché tant que le fournisseur n'est pas un serveur local ou OpenRouter.
  const modelsGroup = inSub("models", group("Modèles du serveur", [wideRow(null, models)]));
  modelsGroup.hidden = true;
  return [
    modelsGroup,
    inSub("general", group("Ce qui part", [wideRow(null, sent)], "Un fichier joint vous est toujours montré en entier avant l'envoi, et rien ne part sans votre clic ou votre voix.")),
    inSub(
      "persona",
      group("Consigne exacte", [
        wideRow("La consigne envoyée à chaque message", el("div", {}, show, system), "La personnalité, puis les consignes des humeurs et des outils, telles qu'elles partent.", "Voir la consigne exacte"),
      ]),
    ),
    micBlock(pick),
    inSub("voice", parakeetBlock()),
    wakeBlock(pick),
  ];
}

/** Serveur local, OpenRouter : « Lister les modèles » (sur votre clic), puis un clic choisit. */
function drawModels(box: HTMLElement, s: Status, pick?: (key: string, value: unknown) => void): void {
  const key = modelKey(s.provider ?? "");
  const group = box.closest<HTMLElement>(".group") ?? box;
  if (!key) {
    group.hidden = true;
    return;
  }
  group.hidden = false;
  const out = el("div", { class: "ask-models-list" });
  const filter = el("input", { type: "search", class: "text", placeholder: "Filtrer les modèles", "aria-label": "Filtrer les modèles", hidden: true });
  let all: ServerModel[] = [];
  const draw = () => {
    const shown = filterModels(all, filter.value);
    out.replaceChildren(
      ...shown.map((m) =>
        el(
          "button",
          { class: `net-chip${m.id === s.model ? " active" : ""}`, title: m.tools === false ? "Ce modèle ne gère pas les outils : conversation simple" : "Choisir ce modèle", onclick: () => pick?.(key, m.id) },
          el("code", { "data-no-i18n": "" }, m.id),
          m.tools === false ? el("small", { class: "muted" }, " · sans outils") : null,
        ),
      ),
      ...(all.length > shown.length ? [el("p", { class: "muted" }, `${all.length - shown.length} autres : filtrez pour les voir.`)] : []),
    );
  };
  filter.addEventListener("input", draw);
  const list = el("button", { class: "btn small" }, "Lister les modèles du serveur");
  list.addEventListener("click", () => {
    list.disabled = true;
    out.replaceChildren(el("p", { class: "muted" }, "Lecture…"));
    void Bridge.moduleInvoke<{ models: ServerModel[] }>("askclaude", "models", { provider: s.provider })
      .then((r) => {
        all = r.models ?? [];
        filter.hidden = all.length < 12;
        if (!all.length) out.replaceChildren(el("p", { class: "muted" }, "Aucun modèle sur ce serveur."));
        else draw();
      })
      .catch((e: unknown) => out.replaceChildren(el("p", { class: "muted" }, String(e))))
      .finally(() => (list.disabled = false));
  });
  box.replaceChildren(
    el("p", { class: "muted" }, `Demande la liste à ${s.destination}, sur votre clic (rien d'autre ne part).`),
    el("div", { class: "btn-row" }, list, filter),
    out,
  );
}
