import { test } from "node:test";
import assert from "node:assert/strict";
import { CleanupBag } from "../../src/core/cleanup-bag";
test("mille ouvertures et fermetures ne retiennent aucune ancienne vue", () => {
  const bag = new CleanupBag();
  let disposed = 0;
  for (let i = 0; i < 1000; i++) { const off = bag.add(() => { disposed++; }); off(); off(); }
  assert.equal(bag.size, 0);
  assert.equal(disposed, 1000);
});
test("un nettoyage en erreur laisse les autres abonnements être libérés", () => {
  const bag = new CleanupBag();
  let disposed = 0;
  bag.add(() => { throw new Error("vue cassée"); });
  bag.add(() => { disposed++; });
  let failed = false;
  try { bag.flush(); } catch { failed = true; }
  assert.equal(failed, true);
  assert.equal(disposed, 1);
  assert.equal(bag.size, 0);
  bag.add(() => { disposed++; });
  assert.equal(disposed, 2);
});
