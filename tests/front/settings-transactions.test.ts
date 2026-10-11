import { test } from "node:test";
import assert from "node:assert/strict";
import { SettingsTransactions } from "../../src/core/settings-transactions";
import { applySettingsPatch } from "../../src/core/settings-transactions";

const initial = { revision: 0, general: { language: "fr" }, island: { theme: "light" } };
test("une écriture refusée annule seulement son changement et conserve le suivant", async () => {
  let reject!: (error: unknown) => void;
  const store = new SettingsTransactions(initial, async (_patch, base) => {
    if (!reject) return new Promise<typeof initial>((_resolve, no) => { reject = no; });
    return { ...base, revision: 1, island: { theme: "dark" } };
  });
  let errorSeen = false;
  store.onError(() => { errorSeen = true; });
  const a = store.update(s => { s.general.language = "en"; });
  const b = store.update(s => { s.island.theme = "dark"; });
  assert.equal(store.current.general.language, "en");
  reject(new Error("disque plein"));
  let rejected = false;
  await a.catch(() => { rejected = true; });
  assert.equal(rejected, true);
  await b;
  assert.equal(store.current.general.language, "fr");
  assert.equal(store.current.island.theme, "dark");
  assert.equal(errorSeen, true);
});
test("un événement ancien ne remplace pas des réglages plus récents", () => {
  const store = new SettingsTransactions(initial, async (_patch, base) => base);
  store.accept({ ...initial, revision: 3, general: { language: "en" } });
  store.accept({ ...initial, revision: 2 });
  assert.equal(store.current.general.language, "en");
});
test("les changements externes sont fusionnés avec le brouillon en attente", async () => {
  let finish!: (value: typeof initial) => void;
  const store = new SettingsTransactions(initial, async () => new Promise(resolve => { finish = resolve; }));
  const saved = store.update(s => { s.island.theme = "dark"; });
  store.accept({ ...initial, revision: 1, general: { language: "en" } });
  assert.equal(store.current.general.language, "en");
  assert.equal(store.current.island.theme, "dark");
  finish({ ...initial, revision: 2, general: { language: "en" }, island: { theme: "dark" } });
  await saved;
  assert.equal(store.current.revision, 2);
});
test("cent gestes rapides gardent le retour immédiat et deux écritures au plus", async () => {
  let unblock!: () => void;
  let writes = 0;
  const store = new SettingsTransactions(initial, async (patch, base) => {
    writes++;
    if (writes === 1) await new Promise<void>(resolve => { unblock = resolve; });
    return { ...applySettingsPatch(base, patch), revision: writes };
  });
  const pending: Promise<void>[] = [];
  for (let i = 1; i <= 100; i++) pending.push(store.update(s => { s.island.theme = String(i); }));
  assert.equal(store.current.island.theme, "100");
  unblock();
  await Promise.all(pending);
  assert.equal(writes, 2);
  assert.equal(store.current.island.theme, "100");
});
