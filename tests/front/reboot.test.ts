// Tests du « redémarrage en attente » (src/modules/system/reboot-text.ts) :
// les textes, et la règle du rappel doux.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { pendingSince, pendingText, reasonText, shouldRemind, type RebootState } from "../../src/modules/system/reboot-text";

const HOUR = 3600;
const DAY = 24 * HOUR;
const NOW = 1_791_115_200; // 4 octobre 2026, 12 h UTC

describe("textes", () => {
  test("depuis combien de temps", () => {
    assert.equal(pendingText(NOW - 3 * DAY - 5 * HOUR, NOW), "Redémarrage en attente depuis 3 jours");
    assert.equal(pendingText(NOW - DAY - 2 * HOUR, NOW), "Redémarrage en attente depuis 1 jour");
    assert.equal(pendingText(NOW - 5 * HOUR - 59 * 60, NOW), "Redémarrage en attente depuis 5 h");
    assert.equal(pendingText(NOW - 10 * 60, NOW), "Redémarrage en attente depuis moins d'une heure");
  });

  test("sans date (ou une date dans le futur) : sans « depuis »", () => {
    assert.equal(pendingText(0, NOW), "Redémarrage en attente");
    assert.equal(pendingText(NOW + HOUR, NOW), "Redémarrage en attente");
  });

  test("pourquoi Windows attend", () => {
    assert.equal(reasonText(["updates"]), "(mises à jour de Windows)");
    assert.equal(reasonText(["servicing", "updates"]), "(mises à jour de Windows)");
    assert.equal(reasonText(["servicing"]), "(composants de Windows)");
  });

  test("la date de Windows, sinon la première fois qu'Ondine l'a vu", () => {
    const state = (sinceSecs: number): RebootState => ({ pending: true, sinceSecs, reasons: ["updates"] });
    assert.equal(pendingSince(state(NOW - DAY), NOW - HOUR, NOW), NOW - DAY);
    assert.equal(pendingSince(state(0), NOW - HOUR, NOW), NOW - HOUR);
    // Une horloge déréglée (date dans le futur) : on ne s'y fie pas.
    assert.equal(pendingSince(state(NOW + DAY), NOW - HOUR, NOW), NOW - HOUR);
  });
});

describe("le rappel doux", () => {
  const base = {
    enabled: true,
    state: { pending: true, sinceSecs: NOW - 2 * DAY, reasons: ["updates"] } as RebootState,
    firstSeenSecs: NOW - HOUR,
    nowSecs: NOW,
    lastRemindedSecs: 0,
    micInUse: false,
    presenting: false,
  };

  test("après un jour d'attente : oui", () => {
    assert.equal(shouldRemind(base), true);
  });

  test("réglage décoché, ou rien en attente : non", () => {
    assert.equal(shouldRemind({ ...base, enabled: false }), false);
    assert.equal(shouldRemind({ ...base, state: { ...base.state, pending: false } }), false);
  });

  test("moins d'un jour d'attente : pas encore", () => {
    assert.equal(shouldRemind({ ...base, state: { ...base.state, sinceSecs: NOW - 23 * HOUR } }), false);
    // Sans date de Windows : un jour après la première fois qu'Ondine l'a vu.
    assert.equal(shouldRemind({ ...base, state: { ...base.state, sinceSecs: 0 } }), false);
    assert.equal(shouldRemind({ ...base, state: { ...base.state, sinceSecs: 0 }, firstSeenSecs: NOW - DAY }), true);
  });

  test("au plus une fois par jour", () => {
    assert.equal(shouldRemind({ ...base, lastRemindedSecs: NOW - 20 * HOUR }), false);
    assert.equal(shouldRemind({ ...base, lastRemindedSecs: NOW - DAY }), true);
  });

  test("jamais pendant un appel ni une présentation", () => {
    assert.equal(shouldRemind({ ...base, micInUse: true }), false);
    assert.equal(shouldRemind({ ...base, presenting: true }), false);
  });
});
