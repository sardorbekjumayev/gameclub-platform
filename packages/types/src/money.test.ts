import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney } from './money.ts';

test('formats tiyin as som with grouping', () => {
  assert.equal(formatMoney(5_000_000), "50 000 so'm");
  assert.equal(formatMoney(2_500_000, 'ru'), '25 000 сум');
  assert.throws(() => formatMoney(1.5));
});
