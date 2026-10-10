// Tests de la machine à états de l'île (src/island/island-state.ts).
//
// Les minuteries sont FAUSSES (mock.timers de Node) : `tick(ms)` fait avancer le
// temps d'un coup, sans attendre. On vérifie ainsi « se referme après 1,5 s »
// en quelques millisecondes.

import { describe, test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { IslandStateMachine, type IslandState } from "../../src/island/island-state";

// La machine appelle window.setTimeout : sous Node, `window` n'existe pas.
(globalThis as unknown as { window: unknown }).window = globalThis;

const TIMINGS = { peekToCompactMs: 350, peekToHiddenMs: 300, collapseMs: 1500 };

let fsm: IslandStateMachine;
/** Chaque transition annoncée, sous la forme "avant>après". */
let moves: string[];

function tick(ms: number) {
  mock.timers.tick(ms);
}

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
  fsm = new IslandStateMachine({ ...TIMINGS });
  moves = [];
  fsm.onTransition = (from: IslandState, to: IslandState) => moves.push(`${from}>${to}`);
});

afterEach(() => {
  mock.timers.reset();
});

describe("survol et clic", () => {
  test("au départ l'île est cachée", () => {
    assert.equal(fsm.state, "hidden");
  });

  test("survol : peek, puis compact après 350 ms", () => {
    fsm.pointerEnter();
    assert.equal(fsm.state, "peek");
    tick(349);
    assert.equal(fsm.state, "peek");
    tick(1);
    assert.equal(fsm.state, "compact");
    assert.deepEqual(moves, ["hidden>peek", "peek>compact"]);
  });

  test("peek : la souris part vite, l'île se recache après 300 ms", () => {
    fsm.pointerEnter();
    tick(100);
    fsm.pointerLeave();
    tick(299);
    assert.equal(fsm.state, "peek");
    tick(1);
    assert.equal(fsm.state, "hidden");
  });

  test("clic sur peek ou compact : expanded", () => {
    fsm.pointerEnter();
    fsm.click();
    assert.equal(fsm.state, "expanded");
    fsm.shrink();
    assert.equal(fsm.state, "compact");
    fsm.click();
    assert.equal(fsm.state, "expanded");
  });

  test("compact : se replie après collapseMs quand la souris part, pas avant", () => {
    fsm.pointerEnter();
    tick(350);
    fsm.pointerLeave();
    tick(1499);
    assert.equal(fsm.state, "compact");
    tick(1);
    assert.equal(fsm.state, "hidden");
  });

  test("revenir sur l'île annule le repli", () => {
    fsm.pointerEnter();
    fsm.click();
    fsm.pointerLeave();
    tick(1000);
    fsm.pointerEnter();
    tick(10_000);
    assert.equal(fsm.state, "expanded");
  });

  test("expanded : se replie d'un coup jusqu'à hidden", () => {
    fsm.open();
    assert.equal(fsm.state, "expanded");
    fsm.pointerEnter();
    fsm.pointerLeave();
    tick(1500);
    assert.equal(fsm.state, "hidden");
    assert.deepEqual(moves, ["hidden>expanded", "expanded>hidden"]);
  });

  test("une île cachée n'est plus survolée : le survol suivant la réveille", () => {
    fsm.open();
    fsm.pointerEnter();
    fsm.escape(); // cachée alors que la souris était dessus
    assert.equal(fsm.state, "hidden");
    fsm.pointerEnter();
    assert.equal(fsm.state, "peek");
  });
});

describe("Échap, open, close", () => {
  test("Échap ferme l'île ouverte, et ne fait rien si elle est cachée", () => {
    assert.equal(fsm.escape(), null);
    fsm.open();
    assert.equal(fsm.escape(), "closed");
    assert.equal(fsm.state, "hidden");
  });

  test("Échap pendant une alerte : il faut fermer l'alerte", () => {
    fsm.alertStart();
    assert.equal(fsm.escape(), "dismiss-alert");
    assert.equal(fsm.state, "alert");
  });

  test("open() ne coupe ni une alerte ni un glisser", () => {
    fsm.alertStart();
    fsm.open();
    assert.equal(fsm.state, "alert");
    fsm.alertEnd();
    fsm.dragEnter();
    fsm.open();
    assert.equal(fsm.state, "drop");
  });

  test("close() referme jusqu'à l'état de repos", () => {
    fsm.open();
    fsm.close();
    assert.equal(fsm.state, "hidden");
  });
});

describe("notifications", () => {
  test("une notification normale montre l'île compacte, qui se referme seule", () => {
    fsm.showCompact();
    assert.equal(fsm.state, "compact");
    tick(1500);
    assert.equal(fsm.state, "hidden");
  });

  test("hold : l'île reste ouverte tant que la notification est affichée", () => {
    fsm.showCompact();
    fsm.hold(true);
    tick(60_000);
    assert.equal(fsm.state, "compact");
    fsm.hold(false);
    tick(1500);
    assert.equal(fsm.state, "hidden");
  });

  test("expanded avec une notification affichée : se replie en compact, pas plus", () => {
    fsm.open();
    fsm.hold(true);
    fsm.pointerEnter();
    fsm.pointerLeave();
    tick(1500);
    assert.equal(fsm.state, "compact");
  });
});

describe("glisser-déposer et alertes", () => {
  test("glisser puis annuler : on revient à l'état d'avant", () => {
    fsm.open();
    fsm.dragEnter();
    assert.equal(fsm.state, "drop");
    fsm.dragLeave();
    assert.equal(fsm.state, "expanded");
  });

  test("fichier lâché : compact, puis repli", () => {
    fsm.dragEnter();
    fsm.dropped();
    assert.equal(fsm.state, "compact");
    tick(1500);
    assert.equal(fsm.state, "hidden");
  });

  test("pas de minuterie pendant un glisser", () => {
    fsm.open();
    fsm.dragEnter();
    tick(60_000);
    assert.equal(fsm.state, "drop");
  });

  test("alerte depuis hidden : à la fin, l'île reste en compact (puis se replie)", () => {
    fsm.alertStart();
    assert.equal(fsm.state, "alert");
    fsm.alertEnd();
    assert.equal(fsm.state, "compact");
    tick(1500);
    assert.equal(fsm.state, "hidden");
  });

  test("alerte depuis expanded : on y revient", () => {
    fsm.open();
    fsm.alertStart();
    fsm.alertEnd();
    assert.equal(fsm.state, "expanded");
  });

  test("une alerte arrivée pendant un glisser attend sa fin", () => {
    fsm.dragEnter();
    fsm.alertStart();
    assert.equal(fsm.state, "drop");
    fsm.dropped();
    assert.equal(fsm.state, "alert");
  });

  test("glisser pendant une alerte : l'alerte revient après", () => {
    fsm.alertStart();
    fsm.dragEnter();
    assert.equal(fsm.state, "drop");
    fsm.dragLeave();
    assert.equal(fsm.state, "alert");
    fsm.alertEnd();
    assert.equal(fsm.state, "compact");
  });

  test("alerte terminée pendant le glisser : elle ne revient pas", () => {
    fsm.dragEnter();
    fsm.alertStart();
    fsm.alertEnd();
    fsm.dragLeave();
    assert.equal(fsm.state, "hidden");
  });
});

describe("« Toujours en mini » (alwaysMini)", () => {
  test("activé au démarrage : l'île passe de hidden à compact et l'annonce", () => {
    // Bug de la beta.1 : la fenêtre restait une bande de 240×6 alors que l'île
    // était affichée. island.ts redimensionne la fenêtre à chaque transition :
    // la transition hidden>compact DOIT donc être annoncée.
    fsm.setAlwaysMini(true);
    assert.equal(fsm.state, "compact");
    assert.deepEqual(moves, ["hidden>compact"]);
  });

  test("compact ne se replie plus", () => {
    fsm.setAlwaysMini(true);
    fsm.pointerEnter();
    fsm.pointerLeave();
    tick(60_000);
    assert.equal(fsm.state, "compact");
  });

  test("expanded se replie en compact, pas en hidden", () => {
    fsm.setAlwaysMini(true);
    fsm.click();
    assert.equal(fsm.state, "expanded");
    fsm.pointerEnter();
    fsm.pointerLeave();
    tick(1500);
    assert.equal(fsm.state, "compact");
  });

  test("Échap et close() ramènent à compact", () => {
    fsm.setAlwaysMini(true);
    fsm.open();
    assert.equal(fsm.escape(), "closed");
    assert.equal(fsm.state, "compact");
    assert.equal(fsm.escape(), null);
    fsm.open();
    fsm.close();
    assert.equal(fsm.state, "compact");
  });

  test("au repos en mini : une visite d'Ondine au bord est possible (bug 1.2.2)", () => {
    // Les visites au bord n'arrivaient jamais : elles demandaient une île cachée,
    // or « Toujours en mini » est activé par défaut.
    fsm.setAlwaysMini(true);
    assert.equal(fsm.resting(), true);
    fsm.pointerEnter();
    assert.equal(fsm.resting(), false);
    fsm.pointerLeave();
    assert.equal(fsm.resting(), true);
    fsm.hold(true);
    assert.equal(fsm.resting(), false);
    fsm.hold(false);
    // La visite fait remonter la mini-île (hide), qui revient ensuite (restore).
    fsm.hide();
    assert.equal(fsm.state, "hidden");
    fsm.restore();
    assert.equal(fsm.state, "compact");
  });

  test("désactivé : l'île compacte se replie de nouveau", () => {
    fsm.setAlwaysMini(true);
    fsm.setAlwaysMini(false);
    assert.equal(fsm.state, "compact");
    tick(1500);
    assert.equal(fsm.state, "hidden");
  });

  test("activer deux fois ne fait qu'une transition", () => {
    fsm.setAlwaysMini(true);
    fsm.setAlwaysMini(true);
    assert.deepEqual(moves, ["hidden>compact"]);
  });
});

describe("mode présentation (hide / restore)", () => {
  test("hide cache l'île même en « Toujours en mini », restore la ramène en mini", () => {
    fsm.setAlwaysMini(true);
    fsm.hide();
    assert.equal(fsm.state, "hidden");
    tick(60_000);
    assert.equal(fsm.state, "hidden");
    fsm.restore();
    assert.equal(fsm.state, "compact");
  });

  test("sans « Toujours en mini », restore laisse l'île cachée", () => {
    fsm.open();
    fsm.hide();
    fsm.restore();
    assert.equal(fsm.state, "hidden");
  });

  test("« Toujours en mini » activé pendant la présentation : rien ne s'affiche avant restore", () => {
    fsm.hide();
    fsm.setAlwaysMini(true);
    assert.equal(fsm.state, "hidden");
    fsm.restore();
    assert.equal(fsm.state, "compact");
  });

  test("pendant la présentation, l'île survolée se recache (repos = hidden)", () => {
    fsm.setAlwaysMini(true);
    fsm.hide();
    fsm.pointerEnter();
    tick(350);
    assert.equal(fsm.state, "compact");
    fsm.pointerLeave();
    tick(1500);
    assert.equal(fsm.state, "hidden");
  });
});

describe("format nano (island.size = nano)", () => {
  let forms: string[];
  beforeEach(() => {
    forms = [];
    fsm.onForm = (f) => forms.push(f);
    fsm.setAlwaysMini(true);
    fsm.setNano(true);
  });

  test("au repos en mini, l'île est une encoche nano", () => {
    assert.equal(fsm.state, "compact");
    assert.equal(fsm.form(), "nano");
    assert.deepEqual(forms, ["nano"]);
  });

  test("hors de l'état compact, la forme est toujours mini", () => {
    fsm.open();
    assert.equal(fsm.form(), "mini");
  });

  test("survol : mini-île après un court délai, encoche quand la souris part (sans clic)", () => {
    fsm.pointerEnter();
    tick(119);
    assert.equal(fsm.form(), "nano");
    tick(1);
    assert.equal(fsm.form(), "mini");
    fsm.pointerLeave();
    tick(319);
    assert.equal(fsm.form(), "mini");
    tick(1);
    assert.equal(fsm.form(), "nano");
    assert.equal(fsm.state, "compact");
    assert.deepEqual(forms, ["nano", "mini", "nano"]);
  });

  test("un passage éclair de la souris ne l'ouvre pas", () => {
    fsm.pointerEnter();
    tick(60);
    fsm.pointerLeave();
    tick(1000);
    assert.equal(fsm.form(), "nano");
    assert.deepEqual(forms, ["nano"]);
  });

  test("revenir vite sur l'île annule le retour à l'encoche", () => {
    fsm.pointerEnter();
    tick(120);
    fsm.pointerLeave();
    tick(200);
    fsm.pointerEnter();
    tick(500);
    assert.equal(fsm.form(), "mini");
  });

  test("une notification affichée garde la mini-île jusqu'à sa fin", () => {
    fsm.hold(true);
    assert.equal(fsm.form(), "mini");
    assert.deepEqual(fsm.wideReasons(), ["notification"]);
    fsm.hold(false);
    assert.equal(fsm.form(), "nano");
  });

  test("pulse : la nano s'élargit le temps demandé, un nouveau coup prolonge", () => {
    fsm.pulse(4000);
    assert.equal(fsm.form(), "mini");
    tick(3000);
    fsm.pulse(4000);
    tick(3999);
    assert.equal(fsm.form(), "mini");
    tick(1);
    assert.equal(fsm.form(), "nano");
  });

  test("setBusy : une activité qui dure (la voix) garde la mini-île", () => {
    fsm.setBusy("voice", true);
    tick(60_000);
    assert.equal(fsm.form(), "mini");
    fsm.setBusy("voice", false);
    assert.equal(fsm.form(), "nano");
  });

  test("format normal : jamais d'encoche", () => {
    fsm.setNano(false);
    assert.equal(fsm.form(), "mini");
    fsm.pulse(10);
    tick(10);
    assert.equal(fsm.form(), "mini");
  });

  test("l'île ouverte qui se replie revient à l'encoche (pas à la mini-île)", () => {
    fsm.open();
    fsm.pointerEnter();
    fsm.pointerLeave();
    tick(1500);
    assert.equal(fsm.state, "compact");
    assert.equal(fsm.shownForm, "nano");
  });

  test("cachée (présentation) puis revenue : encoche", () => {
    fsm.pointerEnter();
    tick(200);
    fsm.hide();
    fsm.restore();
    assert.equal(fsm.form(), "nano");
  });
});
