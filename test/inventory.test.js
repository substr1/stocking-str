'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inv = require('../server/inventory');

const item = (o) => ({
  quantity: 20, par_level: 30, reorder_point: 10, per_stay: 0, per_guest_night: 1, pack_size: 12, ...o,
});
const stay = (check_in, check_out, guests = 2) => ({ check_in, check_out, guests });

test('usage scales with guests and nights', () => {
  assert.equal(inv.usageForStay(item({ per_stay: 2 }), stay('2026-01-01', '2026-01-04', 3)), 2 + 9);
  assert.equal(inv.usageForStay(item(), { check_in: '2026-01-01', check_out: '2026-01-02' }, 4), 4);
});

test('stock status', () => {
  assert.equal(inv.stockStatus(item({ quantity: 0 })), 'out');
  assert.equal(inv.stockStatus(item({ quantity: 10 })), 'low');
  assert.equal(inv.stockStatus(item({ quantity: 11 })), 'ok');
  assert.equal(inv.stockStatus(item({ par_level: 0, reorder_point: 0 })), 'untracked');
});

test('forecast finds the reorder and run-out stays', () => {
  const stays = [stay('2026-01-10', '2026-01-13'), stay('2026-01-01', '2026-01-04'), stay('2026-01-20', '2026-01-25')];
  // uses 6, 6, 10 -> 14, 8 (reorder), -2 (out)
  const f = inv.forecastItem(item(), stays, {});
  assert.deepEqual(f, { reorderBy: '2026-01-10', runsOutOn: '2026-01-20' });
  assert.deepEqual(inv.forecastItem(item(), stays, { incoming: 24 }), { reorderBy: null, runsOutOn: null });
});

test('suggestion tops up to par in whole packs, looking ahead by lead time', () => {
  const stays = [stay('2026-01-02', '2026-01-05')]; // uses 6
  const s = inv.suggestion(item({ quantity: 15 }), stays, { today: '2026-01-01', leadDays: 7 });
  assert.deepEqual(s, { needed: true, projected: 9, upcomingUse: 6, units: 21, packs: 2 });
  const later = inv.suggestion(item({ quantity: 15 }), stays, { today: '2026-01-01', leadDays: 2 });
  assert.equal(later.needed, false);
});
