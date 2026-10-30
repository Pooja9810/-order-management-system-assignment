// Deliberately failing test to confirm CI blocks a broken PR. Do not merge.
import test from 'node:test';
import assert from 'node:assert/strict';

test('CI demo: this test is meant to fail', () => {
  assert.equal(1 + 1, 3);
});
