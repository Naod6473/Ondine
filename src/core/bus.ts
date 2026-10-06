// Le bus d'événements, côté front.
//
// Un seul bus logique pour toute l'appli : cette fenêtre, l'autre fenêtre, et les
// modules Rust (voir src-tauri/src/services/bus.rs). Publier ici :
//   1. livre tout de suite le message aux abonnés de CETTE fenêtre ;
//   2. l'envoie au Rust, qui le donne aux modules Rust intéressés et le renvoie
//      aux autres fenêtres. L'écho qui revient vers cette fenêtre est ignoré.
//
// Sujets : minuscules, chiffres, `.`, `-`, `_` (ex. "hello.greeted").
// Abonnement : sujet exact, "hello.*" (préfixe) ou "*" (tout).
//
// Un abonné qui lance une erreur ne gêne ni les autres abonnés ni l'île :
// l'erreur est rattrapée et signalée via `onHandlerError` (le registre des
// modules s'en sert pour mettre à l'écart un module qui plante trop).

import { Bridge, onTauriEvent } from "./bridge";

export interface BusMessage<T = unknown> {
  topic: string;
  payload: T;
  /** Qui publie : "island", "settings", ou l'id d'un module. */
  source: string;
  /** Fenêtre d'origine ("island", "settings") ou "rust". */
  origin: string;
}

export type BusHandler = (msg: BusMessage) => void;

interface Subscription {
  pattern: string;
  handler: BusHandler;
  /** Qui s'est abonné (pour savoir à qui attribuer une erreur). */
  owner: string;
}

const TOPIC_RE = /^[a-z0-9._-]{1,64}$/;

export function topicMatches(pattern: string, topic: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return topic.startsWith(pattern.slice(0, -1));
  return pattern === topic;
}

export class Bus {
  private subs: Subscription[] = [];

  /** Appelé quand un abonné lance une erreur. */
  onHandlerError: (owner: string, err: unknown, msg: BusMessage) => void = (owner, err) =>
    console.error(`[bus] erreur chez ${owner}`, err);

  /** Renvoie faux pour ignorer un message venu d'ailleurs (le mode démo s'en sert). */
  accept: (msg: BusMessage) => boolean = () => true;

  constructor(private readonly origin: string) {}

  /** Reçoit les messages venus du Rust et des autres fenêtres. */
  async connect() {
    await onTauriEvent<BusMessage>("bus", (msg) => {
      if (msg.origin === this.origin) return; // notre propre écho
      if (!this.accept(msg)) return;
      this.dispatch(msg);
    });
  }

  /** S'abonne ; renvoie la fonction qui désabonne. */
  on(pattern: string, handler: BusHandler, owner = "island"): () => void {
    const sub: Subscription = { pattern, handler, owner };
    this.subs.push(sub);
    return () => {
      this.subs = this.subs.filter((s) => s !== sub);
    };
  }

  /** Publie un message. */
  emit(topic: string, payload: unknown = null, source = "island") {
    if (!TOPIC_RE.test(topic)) {
      console.warn(`[bus] sujet invalide ignoré : ${topic}`);
      return;
    }
    const msg: BusMessage = { topic, payload, source, origin: this.origin };
    this.dispatch(msg);
    void Bridge.busPublish(topic, payload, source);
  }

  /**
   * Livre un message à cette fenêtre seulement, sans l'envoyer au Rust.
   * Réservé au mode démo (fausses données qui ne doivent aller nulle part).
   */
  inject(topic: string, payload: unknown = null, source = "demo") {
    this.dispatch({ topic, payload, source, origin: "demo" });
  }

  private dispatch(msg: BusMessage) {
    // Copie : un abonné peut se désabonner pendant la distribution.
    for (const sub of [...this.subs]) {
      if (!topicMatches(sub.pattern, msg.topic)) continue;
      // queueMicrotask : un abonné qui publie à son tour ne s'imbrique pas
      // dans la distribution en cours.
      queueMicrotask(() => {
        try {
          sub.handler(msg);
        } catch (err) {
          this.onHandlerError(sub.owner, err, msg);
        }
      });
    }
  }
}
