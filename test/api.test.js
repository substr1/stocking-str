'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app');
const { openDb } = require('../server/db');

// Spin up the app on a random port with an in-memory DB and a fixed "today".
async function setup(opts = {}) {
  let today = opts.today || '2026-10-13';
  const app = createApp({ db: openDb(':memory:'), today: () => today, ...opts.app });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const type = res.headers.get('content-type') || '';
    const data = res.status === 204 ? null : type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  };
  return {
    call,
    setToday: (t) => { today = t; },
    close: () => new Promise((r) => server.close(r)),
  };
}

const itemByName = (property, name) => property.items.find((i) => i.name === name);

test('creating a property seeds a supply list scaled to its size', async (t) => {
  const s = await setup();
  t.after(s.close);
  const small = (await s.call('POST', '/properties', { name: 'Studio', bedrooms: 1, bathrooms: 1, max_guests: 2 })).data;
  const big = (await s.call('POST', '/properties', { name: 'Lake House', bedrooms: 4, bathrooms: 3, max_guests: 10 })).data;
  const a = (await s.call('GET', `/properties/${small.id}`)).data;
  const b = (await s.call('GET', `/properties/${big.id}`)).data;
  assert.ok(a.items.length > 40);
  assert.equal(itemByName(a, 'Sheet sets').par_level, 3);
  assert.equal(itemByName(b, 'Sheet sets').par_level, 12);
  assert.equal(itemByName(b, 'Bath towels').par_level, 30);
  assert.equal(itemByName(b, 'Toilet paper').par_level, 48);
  assert.equal(a.reorder_count, 0, 'a fresh property starts fully stocked');
  for (const name of ['Coffee stirrers', 'To-go coffee cups with lids', 'Sweetener packets', 'Sponges']) {
    assert.ok(itemByName(a, name), `${name} is in the starter list`);
  }
});

test('empty properties can be created without the template', async (t) => {
  const s = await setup();
  t.after(s.close);
  const p = (await s.call('POST', '/properties', { name: 'Blank', use_template: false })).data;
  assert.equal(p.item_count, 0);
  assert.equal((await s.call('POST', '/properties', { name: '' })).status, 400);
});

test('finished stays deduct supplies automatically and count corrections are logged', async (t) => {
  const s = await setup();
  t.after(s.close);
  const p = (await s.call('POST', '/properties', { name: 'Cabin', default_guests: 2 })).data;
  const before = itemByName((await s.call('GET', `/properties/${p.id}`)).data, 'Coffee pods');
  // 2 guests x 3 nights x 1.5 pods = 9 pods
  await s.call('POST', `/properties/${p.id}/stays`, { check_in: '2026-10-14', check_out: '2026-10-17', guests: 2 });
  let detail = (await s.call('GET', `/properties/${p.id}`)).data;
  assert.equal(itemByName(detail, 'Coffee pods').quantity, before.quantity, 'not deducted before checkout');

  s.setToday('2026-10-17');
  detail = (await s.call('GET', `/properties/${p.id}`)).data;
  assert.equal(itemByName(detail, 'Coffee pods').quantity, before.quantity - 9);
  const stays = (await s.call('GET', `/properties/${p.id}/stays`)).data;
  assert.ok(stays[0].consumed_at);

  const pods = itemByName(detail, 'Coffee pods');
  const count = await s.call('POST', `/properties/${p.id}/counts`, { counts: [{ item_id: pods.id, quantity: 5 }] });
  assert.equal(count.data.changed, 1);
  const log = (await s.call('GET', `/properties/${p.id}/activity`)).data;
  assert.equal(log[0].reason, 'count');
  assert.equal(log[0].quantity_after, 5);
  assert.ok(log.some((l) => l.reason === 'stay' && l.item_name === 'Coffee pods' && l.delta === -9));
});

test('low stock and upcoming bookings drive reorder suggestions and orders', async (t) => {
  const s = await setup();
  t.after(s.close);
  const p = (await s.call('POST', '/properties', { name: 'Condo', bathrooms: 1, lead_days: 7 })).data;
  let detail = (await s.call('GET', `/properties/${p.id}`)).data;
  const tp = itemByName(detail, 'Toilet paper'); // par 16, reorder 8, pack 30
  const sponges = itemByName(detail, 'Sponges'); // par 12, reorder 4, pack 12
  await s.call('PUT', `/items/${tp.id}`, { quantity: 10, pack_cost: 25.99 });
  await s.call('PUT', `/items/${sponges.id}`, { quantity: 3 });

  // A 4-night stay for 4 guests uses 1 + 0.5*4*4 = 9 rolls, pushing TP under its reorder point.
  await s.call('POST', `/properties/${p.id}/stays`, { check_in: '2026-10-15', check_out: '2026-10-19', guests: 4 });
  detail = (await s.call('GET', `/properties/${p.id}`)).data;
  const tpView = itemByName(detail, 'Toilet paper');
  assert.equal(tpView.status, 'ok');
  assert.equal(tpView.suggestion.needed, true);
  assert.equal(tpView.forecast.reorderBy, '2026-10-15');
  assert.equal(itemByName(detail, 'Sponges').status, 'low');

  const orders = (await s.call('POST', `/properties/${p.id}/orders/generate`, {})).data;
  const costco = orders.find((o) => o.vendor === 'Costco');
  const amazon = orders.find((o) => o.vendor === 'Amazon');
  const tpLine = costco.lines.find((l) => l.name === 'Toilet paper');
  assert.equal(tpLine.packs, 1);
  assert.equal(costco.total, 25.99);
  assert.ok(amazon.lines.find((l) => l.name === 'Sponges'));
  assert.match(amazon.lines[0].buy_url, /^https:\/\/www\.amazon\.com\/s\?k=/);

  // Generating again reuses the same drafts instead of duplicating them.
  const again = (await s.call('POST', `/properties/${p.id}/orders/generate`, {})).data;
  assert.deepEqual(again.map((o) => o.id).sort(), orders.map((o) => o.id).sort());

  // Once ordered, the incoming stock stops the item from being suggested again.
  await s.call('PUT', `/orders/${costco.id}`, { status: 'ordered' });
  detail = (await s.call('GET', `/properties/${p.id}`)).data;
  assert.equal(itemByName(detail, 'Toilet paper').incoming, 30);
  assert.equal(itemByName(detail, 'Toilet paper').suggestion.needed, false);

  // Receiving adds the packs to stock.
  const received = (await s.call('POST', `/orders/${costco.id}/receive`, {})).data;
  assert.equal(received.status, 'received');
  detail = (await s.call('GET', `/properties/${p.id}`)).data;
  assert.equal(itemByName(detail, 'Toilet paper').quantity, 40);
  assert.equal((await s.call('DELETE', `/orders/${costco.id}`)).status, 400);

  const csv = await s.call('GET', `/orders/${amazon.id}/csv`);
  assert.match(csv.data, /^"Item","Category"/);
  assert.match(csv.data, /"Sponges"/);

  const dash = (await s.call('GET', '/dashboard')).data;
  assert.equal(dash.properties.length, 1);
  assert.ok(dash.orders.some((o) => o.id === amazon.id));
});

test('partial deliveries only add what arrived', async (t) => {
  const s = await setup();
  t.after(s.close);
  const p = (await s.call('POST', '/properties', { name: 'Loft' })).data;
  const detail = (await s.call('GET', `/properties/${p.id}`)).data;
  const water = itemByName(detail, 'Bottled water');
  await s.call('PUT', `/items/${water.id}`, { quantity: 0 });
  const [order] = (await s.call('POST', `/properties/${p.id}/orders/generate`, { item_ids: [water.id] })).data;
  await s.call('PUT', `/order-lines/${order.lines[0].id}`, { packs: 2 });
  await s.call('PUT', `/orders/${order.id}`, { status: 'ordered' });
  await s.call('POST', `/orders/${order.id}/receive`, { lines: [{ id: order.lines[0].id, received_packs: 1 }] });
  const after = itemByName((await s.call('GET', `/properties/${p.id}`)).data, 'Bottled water');
  assert.equal(after.quantity, 40);
});

test('calendar sync imports bookings, skips blocks and cancels removed reservations', async (t) => {
  let feed = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261020', 'DTEND;VALUE=DATE:20261023', 'UID:abc@airbnb.com',
    'SUMMARY:Reserved', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261025', 'DTEND;VALUE=DATE:20261027', 'UID:blk@airbnb.com',
    'SUMMARY:Airbnb (Not available)', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20261105', 'UID:def@airbnb.com',
    'SUMMARY:Reserved', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const fakeFetch = async () => ({ ok: true, status: 200, text: async () => feed });
  const s = await setup({ app: { fetch: fakeFetch } });
  t.after(s.close);
  const p = (await s.call('POST', '/properties', { name: 'Beach', ical_url: 'https://example.com/cal.ics' })).data;
  const first = (await s.call('POST', `/properties/${p.id}/sync`)).data;
  assert.deepEqual(first, { added: 2, updated: 0, cancelled: 0, deducted: 0 });

  feed = feed.replace(/BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261101[\s\S]*?END:VEVENT\r\n/, '')
    .replace('DTEND;VALUE=DATE:20261023', 'DTEND;VALUE=DATE:20261024');
  const second = (await s.call('POST', `/properties/${p.id}/sync`)).data;
  assert.deepEqual(second, { added: 0, updated: 1, cancelled: 1, deducted: 0 });
  const stays = (await s.call('GET', `/properties/${p.id}/stays`)).data;
  assert.equal(stays.find((x) => x.external_uid === 'abc@airbnb.com').check_out, '2026-10-24');
  assert.equal(stays.find((x) => x.external_uid === 'def@airbnb.com').status, 'cancelled');

  const noUrl = (await s.call('POST', '/properties', { name: 'No cal' })).data;
  assert.equal((await s.call('POST', `/properties/${noUrl.id}/sync`)).status, 400);
});

test('optional password protects the app', async (t) => {
  const s = await setup({ app: { password: 'secret' } });
  t.after(s.close);
  assert.equal((await s.call('GET', '/meta')).status, 401);
});

test('invalid input is rejected with a helpful message', async (t) => {
  const s = await setup();
  t.after(s.close);
  const p = (await s.call('POST', '/properties', { name: 'X', use_template: false })).data;
  const bad = await s.call('POST', `/properties/${p.id}/stays`, { check_in: '2026-10-20', check_out: '2026-10-18' });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /after check-in/);
  const item = await s.call('POST', `/properties/${p.id}/items`, { name: 'Soap', par_level: -1 });
  assert.equal(item.status, 400);
  assert.equal((await s.call('GET', '/properties/999')).status, 404);
});
