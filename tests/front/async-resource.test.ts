import { test } from "node:test";
import assert from "node:assert/strict";
import { AsyncResource } from "../../src/core/async-resource";

test("une caméra autorisée après la fermeture est immédiatement arrêtée", async () => {
  const released: string[] = [];
  const scope = new AsyncResource<string>(v => released.push(v));
  let grant!: (v: string) => void;
  const result = scope.open(() => new Promise(resolve => { grant = resolve; }));
  scope.destroy();
  grant("webcam");
  assert.equal(await result, null);
  assert.deepEqual(released, ["webcam"]);
  assert.equal(scope.value, null);
  assert.equal(scope.loading, false);
});

test("une ancienne autorisation ne remplace pas la nouvelle caméra", async () => {
  const released: string[] = [];
  const scope = new AsyncResource<string>(v => released.push(v));
  let grant!: (v: string) => void;
  const old = scope.open(() => new Promise(resolve => { grant = resolve; }));
  assert.equal(await scope.open(async () => "nouvelle"), "nouvelle");
  grant("ancienne");
  assert.equal(await old, null);
  assert.equal(scope.value, "nouvelle");
  scope.close(); scope.destroy();
  assert.deepEqual(released, ["ancienne", "nouvelle"]);
});

test("un refus actif remonte, un refus après fermeture est oublié", async () => {
  const scope = new AsyncResource<string>(() => {});
  let message = "";
  try { await scope.open(async () => { throw new Error("refus"); }); }
  catch (error) { message = (error as Error).message; }
  assert.equal(message, "refus");
  assert.equal(scope.loading, false);
  let reject!: (error: Error) => void;
  const late = scope.open(() => new Promise((_resolve, fail) => { reject = fail; }));
  scope.close(); reject(new Error("refus tardif"));
  assert.equal(await late, null);
});
