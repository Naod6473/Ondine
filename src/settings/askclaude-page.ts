// Les blocs en plus de la page « Parler à Ondine » des réglages (en 1.2.2,
// ils ont quitté l'île pour qu'elle reste claire à l'usage) :
//   - « Ce qui part » (sous-menu Général) : vers où, et quoi, à chaque
//     message ; les noms de fichiers trouvés ; la voix ;
//   - « Consigne exacte » (sous-menu Personnalité) : la consigne complète
//     telle qu'elle part (personnalité, humeurs, outils), à relire.
//
// Tout vient de la commande `status` du module (le Rust sait ce qui part) ;
// hors de l'appli ou module coupé, les blocs disent simplement de l'activer.

import { Bridge } from "../core/bridge";
import { el } from "../island/dom";
import { group, inSub, wideRow } from "./controls";

interface Status {
  destination: string;
  system: string;
  maxTurns: number;
  fileTools: boolean;
  pcTools: boolean;
  voice?: { engine: string; destination: string | null };
}

/** Ce qui part à chaque message (une phrase entière pour la traduction). */
export function sentText(destination: string, maxTurns: number): string {
  return `À chaque message partent vers ${destination} : la personnalité d'Ondine, les ${maxTurns} derniers messages au plus (avec leurs fichiers joints) et votre nouveau message. Rien n'est gardé sur le disque.`;
}

/** La voix : par Windows, ou l'audio vers l'API choisie. */
export function voiceText(engine: string, destination: string | null): string {
  if (engine === "api" && destination) return `Quand vous parlez à Ondine, l'audio de votre voix part vers ${destination} pour être écrit en texte. Il reste en mémoire, jamais sur le disque.`;
  return "Quand vous parlez à Ondine, la reconnaissance vocale de Windows écrit vos mots. Pour la dictée, Windows passe par son service en ligne (réglage « Reconnaissance vocale en ligne » de Windows). Rien n'est enregistré sur le disque.";
}

/** Les deux blocs, rangés dans leur sous-menu (`general`, `persona`). */
export function askclaudeGroups(): HTMLElement[] {
  const sent = el("div", { class: "ask-sent" }, el("p", { class: "muted" }, "…"));
  const system = el("pre", { class: "ask-system", hidden: true, "data-no-i18n": "" });
  const show = el("button", { class: "btn small" }, "Voir la consigne exacte");
  show.addEventListener("click", () => {
    system.hidden = !system.hidden;
    show.textContent = system.hidden ? "Voir la consigne exacte" : "Masquer la consigne exacte";
  });

  void Bridge.moduleInvoke<Status>("askclaude", "status", null)
    .then((s) => {
      const lines = [sentText(s.destination, s.maxTurns)];
      if (s.fileTools) lines.push("Ondine peut chercher vos fichiers par leur nom : les noms trouvés partent aussi. Pour lire ou créer un fichier, elle vous demande d'abord.");
      if (s.pcTools) lines.push("Ondine peut aussi régler le PC quand vous le lui demandez. Pour ouvrir une application ou un site, elle vous demande d'abord.");
      if (s.voice) lines.push(voiceText(s.voice.engine, s.voice.destination));
      sent.replaceChildren(...lines.map((l) => el("p", {}, l)));
      system.textContent = s.system;
    })
    .catch(() => {
      sent.replaceChildren(el("p", { class: "muted" }, "Activez le module pour voir ce qui part."));
      show.disabled = true;
    });

  return [
    inSub("general", group("Ce qui part", [wideRow(null, sent)], "Un fichier joint vous est toujours montré en entier avant l'envoi, et rien ne part sans votre clic ou votre voix.")),
    inSub(
      "persona",
      group("Consigne exacte", [
        wideRow("La consigne envoyée à chaque message", el("div", {}, show, system), "La personnalité, puis les consignes des humeurs et des outils, telles qu'elles partent.", "Voir la consigne exacte"),
      ]),
    ),
  ];
}
