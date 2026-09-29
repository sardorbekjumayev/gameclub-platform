import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateTime } from './time.ts';

test('formats UTC in Tashkent time', () => {
  assert.equal(formatDateTime('2026-09-29T16:41:00Z'), '29.09.2026 21:41');
});
