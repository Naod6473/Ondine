import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameBatch } from "../../src/core/frame-batch";

test("cent nouvelles de cartes entre deux images sont regroupées et lisent le dernier état", () => {
  let pending: FrameRequestCallback | null = null;
  let state = 0;
  const drawn: number[] = [];
  const batch = new FrameBatch(() => drawn.push(state), cb => { pending = cb; return 1; }, () => {});
  for (state = 0; state < 100; state++) batch.request();
  assert.deepEqual(drawn, []);
  pending!(0);
  assert.deepEqual(drawn, [100]);
  batch.request(); pending!(16);
  assert.deepEqual(drawn, [100, 100]);
});

test("une vue fermée ne se redessine pas après son démontage", () => {
  let pending: FrameRequestCallback | null = null;
  let drawn = 0;
  let cancelled = 0;
  const batch = new FrameBatch(() => drawn++, cb => { pending = cb; return 42; }, id => { cancelled = id; });
  batch.request(); batch.stop(); batch.request();
  pending!(0);
  assert.equal(drawn, 0);
  assert.equal(cancelled, 42);
});
