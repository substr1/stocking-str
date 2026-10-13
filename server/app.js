'use strict';

const path = require('path');
const express = require('express');
const { openDb } = require('./db');
const { CATEGORIES, itemsForProperty } = require('./templates');
const { VENDORS, buyUrl } = require('./vendors');
const { parseReservations } = require('./ical');
const inv = require('./inventory');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const PROPERTY_FIELDS = {
  name: 'string', address: 'string', bedrooms: 'int', bathrooms: 'int', max_guests: 'int',
  default_guests: 'int', lead_days: 'int', auto_deduct: 'bool', ical_url: 'string', notes: 'string',
};
const ITEM_FIELDS = {
  name: 'string', category: 'string', unit: 'string', quantity: 'number', par_level: 'number',
  reorder_point: 'number', per_stay: 'number', per_guest_night: 'number', pack_size: 'number',
  pack_label: 'string', pack_cost: 'money', vendor: 'string', product_url: 'string', notes: 'string',
};
const STAY_FIELDS = { check_in: 'date', check_out: 'date', guests: 'int?', summary: 'string' };

// Copy the known fields out of a request body, coercing and validating types.
function pick(body, fields) {
  const out = {};
  for (const [key, type] of Object.entries(fields)) {
    if (body[key] === undefined) continue;
    let v = body[key];
    if (type === 'string') v = v == null ? '' : String(v).trim();
    else if (type === 'bool') v = v ? 1 : 0;
    else if (type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) throw new HttpError(400, `${key} must be a YYYY-MM-DD date`);
    } else if (v === '' || v == null) {
      if (type === 'money' || type === 'int?') v = null;
      else throw new HttpError(400, `${key} is required`);
    } else {
      v = Number(v);
      if (!Number.isFinite(v) || v < 0) throw new HttpError(400, `${key} must be a non-negative number`);
      if (type === 'int' || type === 'int?') v = Math.round(v);
    }
    out[key] = v;
  }
  return out;
}

function localToday() {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the server's time zone
}

function createApp(options = {}) {
  const db = options.db || openDb(options.dbPath);
  const today = options.today || localToday;
  const fetchImpl = options.fetch || globalThis.fetch;
  const tx = (fn) => db.transaction(fn)();

  // ---------------------------------------------------------------- queries

  const getProperty = (id) => {
    const p = db.prepare('SELECT * FROM properties WHERE id = ?').get(id);
    if (!p) throw new HttpError(404, 'Property not found');
    return p;
  };
  const getItem = (id) => {
    const i = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    if (!i) throw new HttpError(404, 'Item not found');
    return i;
  };
  const getStay = (id) => {
    const s = db.prepare('SELECT * FROM stays WHERE id = ?').get(id);
    if (!s) throw new HttpError(404, 'Stay not found');
    return s;
  };
  const getOrderRow = (id) => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!o) throw new HttpError(404, 'Order not found');
    return o;
  };

  const pendingStays = (propertyId) => db.prepare(
    `SELECT * FROM stays WHERE property_id = ? AND status = 'booked' AND consumed_at IS NULL
     ORDER BY check_out`,
  ).all(propertyId);

  // Units per item on orders that were placed but have not arrived yet.
  const incomingByItem = (propertyId) => {
    const rows = db.prepare(
      `SELECT l.item_id, SUM(l.packs * l.pack_size) AS units FROM order_lines l
       JOIN orders o ON o.id = l.order_id
       WHERE o.property_id = ? AND o.status = 'ordered' GROUP BY l.item_id`,
    ).all(propertyId);
    return new Map(rows.map((r) => [r.item_id, r.units]));
  };
  const draftByItem = (propertyId) => {
    const rows = db.prepare(
      `SELECT l.item_id, l.order_id, l.packs FROM order_lines l JOIN orders o ON o.id = l.order_id
       WHERE o.property_id = ? AND o.status = 'draft'`,
    ).all(propertyId);
    return new Map(rows.map((r) => [r.item_id, r]));
  };

  function logChange(item, delta, reason, extra = {}) {
    const after = inv.round(item.quantity + delta);
    db.prepare('UPDATE items SET quantity = ?, updated_at = datetime(\'now\') WHERE id = ?').run(after, item.id);
    db.prepare(
      `INSERT INTO transactions (property_id, item_id, delta, quantity_after, reason, stay_id, order_id, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(item.property_id, item.id, inv.round(delta), after, reason,
      extra.stayId || null, extra.orderId || null, extra.note || '');
    item.quantity = after;
  }

  // Deduct what a stay used. Stock never goes below zero: if the count was
  // already off, the next physical count fixes it.
  function consumeStay(stay) {
    if (stay.consumed_at) throw new HttpError(409, 'This stay was already deducted');
    const property = getProperty(stay.property_id);
    tx(() => {
      const items = db.prepare('SELECT * FROM items WHERE property_id = ?').all(stay.property_id);
      for (const item of items) {
        const use = Math.min(item.quantity, inv.usageForStay(item, stay, property.default_guests));
        if (use > 0) logChange(item, -use, 'stay', { stayId: stay.id });
      }
      db.prepare('UPDATE stays SET consumed_at = datetime(\'now\') WHERE id = ?').run(stay.id);
    });
  }

  // Deduct every stay that has checked out, for properties with auto-deduct on.
  function processDueStays(propertyId) {
    const due = db.prepare(
      `SELECT s.* FROM stays s JOIN properties p ON p.id = s.property_id
       WHERE s.status = 'booked' AND s.consumed_at IS NULL AND s.check_out <= ? AND p.auto_deduct = 1
       ${propertyId ? 'AND s.property_id = ?' : ''} ORDER BY s.check_out`,
    ).all(...[today(), propertyId].filter(Boolean));
    due.forEach(consumeStay);
    return due.length;
  }

  function itemViews(property) {
    const items = db.prepare('SELECT * FROM items WHERE property_id = ? ORDER BY category, name').all(property.id);
    const stays = pendingStays(property.id);
    const incoming = incomingByItem(property.id);
    const drafts = draftByItem(property.id);
    const ctx = { today: today(), leadDays: property.lead_days, defaultGuests: property.default_guests };
    return items.map((item) => {
      const inc = incoming.get(item.id) || 0;
      return {
        ...item,
        status: inv.stockStatus(item),
        incoming: inc,
        in_draft: drafts.get(item.id) || null,
        forecast: inv.forecastItem(item, stays, { defaultGuests: property.default_guests, incoming: inc }),
        suggestion: inv.suggestion(item, stays, { ...ctx, incoming: inc }),
        buy_url: buyUrl(item),
      };
    });
  }

  function propertySummary(property) {
    const items = itemViews(property);
    const t = today();
    const next = db.prepare(
      `SELECT * FROM stays WHERE property_id = ? AND status = 'booked' AND check_out >= ?
       ORDER BY check_in LIMIT 1`,
    ).get(property.id, t);
    const openOrders = db.prepare(
      'SELECT COUNT(*) AS n FROM orders WHERE property_id = ? AND status IN (\'draft\', \'ordered\')',
    ).get(property.id).n;
    return {
      ...property,
      item_count: items.length,
      low_count: items.filter((i) => i.status === 'low').length,
      out_count: items.filter((i) => i.status === 'out').length,
      reorder_count: items.filter((i) => i.suggestion.needed).length,
      next_stay: next || null,
      open_orders: openOrders,
    };
  }

  function orderView(order) {
    const lines = db.prepare(
      `SELECT l.*, i.name, i.unit, i.category, i.pack_label, i.vendor, i.product_url, i.quantity
       FROM order_lines l JOIN items i ON i.id = l.item_id WHERE l.order_id = ? ORDER BY i.category, i.name`,
    ).all(order.id).map((l) => ({ ...l, buy_url: buyUrl(l), units: inv.round(l.packs * l.pack_size) }));
    const total = lines.reduce((sum, l) => sum + (l.pack_cost || 0) * l.packs, 0);
    const property = db.prepare('SELECT id, name, address FROM properties WHERE id = ?').get(order.property_id);
    return { ...order, property, lines, total: inv.round(total) };
  }

  // Put every item that needs a reorder on a draft order for its vendor,
  // reusing an existing draft for that vendor if there is one.
  function generateOrders(property, itemIds) {
    const wanted = itemIds ? new Set(itemIds.map(Number)) : null;
    const items = itemViews(property).filter((i) => (wanted ? wanted.has(i.id) : i.suggestion.needed));
    const touched = new Set();
    tx(() => {
      for (const item of items) {
        const vendor = item.vendor || 'Other';
        let order = db.prepare(
          'SELECT * FROM orders WHERE property_id = ? AND vendor = ? AND status = \'draft\'',
        ).get(property.id, vendor);
        if (!order) {
          const r = db.prepare('INSERT INTO orders (property_id, vendor) VALUES (?, ?)').run(property.id, vendor);
          order = { id: r.lastInsertRowid };
        }
        const packs = Math.max(1, item.suggestion.packs);
        db.prepare(
          `INSERT INTO order_lines (order_id, item_id, packs, pack_size, pack_cost) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (order_id, item_id) DO UPDATE SET packs = excluded.packs`,
        ).run(order.id, item.id, packs, item.pack_size || 1, item.pack_cost);
        touched.add(Number(order.id));
      }
    });
    return [...touched].map((id) => orderView(getOrderRow(id)));
  }

  async function syncIcal(property) {
    if (!property.ical_url) throw new HttpError(400, 'Add the calendar (iCal) link in property settings first');
    let text;
    try {
      const res = await fetchImpl(property.ical_url, { headers: { 'User-Agent': 'stocking-str/0.1' } });
      if (!res.ok) throw new Error(`calendar returned HTTP ${res.status}`);
      text = await res.text();
    } catch (err) {
      throw new HttpError(502, `Could not download the calendar: ${err.message}`);
    }
    if (!text.includes('BEGIN:VCALENDAR')) throw new HttpError(502, 'That link did not return an iCal calendar');
    const reservations = parseReservations(text);
    const t = today();
    const result = { added: 0, updated: 0, cancelled: 0 };
    tx(() => {
      const seen = new Set();
      for (const r of reservations) {
        seen.add(r.uid);
        const existing = db.prepare('SELECT * FROM stays WHERE property_id = ? AND external_uid = ?')
          .get(property.id, r.uid);
        if (!existing) {
          db.prepare(
            `INSERT INTO stays (property_id, check_in, check_out, source, external_uid, summary)
             VALUES (?, ?, ?, 'ical', ?, ?)`,
          ).run(property.id, r.check_in, r.check_out, r.uid, r.summary);
          result.added++;
        } else if (!existing.consumed_at && (existing.check_in !== r.check_in
          || existing.check_out !== r.check_out || existing.status !== 'booked')) {
          db.prepare('UPDATE stays SET check_in = ?, check_out = ?, status = \'booked\' WHERE id = ?')
            .run(r.check_in, r.check_out, existing.id);
          result.updated++;
        }
      }
      // Future bookings that vanished from the feed were cancelled.
      const future = db.prepare(
        `SELECT id, external_uid FROM stays WHERE property_id = ? AND source = 'ical'
         AND status = 'booked' AND consumed_at IS NULL AND check_in >= ?`,
      ).all(property.id, t);
      for (const s of future) {
        if (!seen.has(s.external_uid)) {
          db.prepare('UPDATE stays SET status = \'cancelled\' WHERE id = ?').run(s.id);
          result.cancelled++;
        }
      }
      db.prepare('UPDATE properties SET last_synced_at = datetime(\'now\') WHERE id = ?').run(property.id);
    });
    result.deducted = processDueStays(property.id);
    return result;
  }

  // ---------------------------------------------------------------- routes

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  if (options.password) {
    app.use((req, res, next) => {
      const [scheme, encoded] = (req.headers.authorization || '').split(' ');
      const pass = scheme === 'Basic' && encoded
        ? Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':') : null;
      if (pass === options.password) return next();
      res.set('WWW-Authenticate', 'Basic realm="Stocking"').status(401).send('Authentication required');
    });
  }

  app.use(express.static(path.join(__dirname, '..', 'public')));

  const api = express.Router();
  const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((data) => {
    if (res.headersSent) return;
    if (data === undefined) res.status(204).end();
    else res.json(data);
  }).catch(next);

  api.get('/meta', route(() => ({ categories: CATEGORIES, vendors: VENDORS, today: today() })));

  api.get('/dashboard', route(() => {
    processDueStays();
    const properties = db.prepare('SELECT * FROM properties ORDER BY name').all();
    const reorder = [];
    const summaries = properties.map((p) => {
      for (const item of itemViews(p)) {
        if (item.suggestion.needed) reorder.push({ ...item, property_name: p.name });
      }
      return propertySummary(p);
    });
    const t = today();
    const turnovers = db.prepare(
      `SELECT s.*, p.name AS property_name FROM stays s JOIN properties p ON p.id = s.property_id
       WHERE s.status = 'booked' AND s.check_out >= ? AND s.check_out <= ? ORDER BY s.check_out`,
    ).all(t, inv.addDays(t, 14));
    const orders = db.prepare(
      'SELECT * FROM orders WHERE status IN (\'draft\', \'ordered\') ORDER BY created_at DESC',
    ).all().map(orderView);
    return { today: t, properties: summaries, reorder, turnovers, orders };
  }));

  // Properties
  api.get('/properties', route(() => db.prepare('SELECT * FROM properties ORDER BY name').all().map(propertySummary)));

  api.post('/properties', route((req) => {
    const data = pick(req.body, PROPERTY_FIELDS);
    if (!data.name) throw new HttpError(400, 'Give the property a name');
    const id = tx(() => {
      const cols = Object.keys(data);
      const r = db.prepare(
        `INSERT INTO properties (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      ).run(...cols.map((c) => data[c]));
      if (req.body.use_template !== false) {
        const property = getProperty(r.lastInsertRowid);
        const insert = db.prepare(
          `INSERT INTO items (property_id, name, category, unit, quantity, par_level, reorder_point,
           per_stay, per_guest_night, pack_size, pack_label, vendor)
           VALUES (@property_id, @name, @category, @unit, @quantity, @par_level, @reorder_point,
           @per_stay, @per_guest_night, @pack_size, @pack_label, @vendor)`,
        );
        for (const item of itemsForProperty(property)) insert.run({ ...item, property_id: property.id });
      }
      return r.lastInsertRowid;
    });
    return propertySummary(getProperty(id));
  }));

  api.get('/properties/:id', route((req) => {
    getProperty(req.params.id);
    processDueStays(Number(req.params.id));
    const property = getProperty(req.params.id);
    return { ...propertySummary(property), items: itemViews(property) };
  }));

  api.put('/properties/:id', route((req) => {
    getProperty(req.params.id);
    const data = pick(req.body, PROPERTY_FIELDS);
    if (data.name === '') throw new HttpError(400, 'Give the property a name');
    const cols = Object.keys(data);
    if (cols.length) {
      db.prepare(`UPDATE properties SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
        .run(...cols.map((c) => data[c]), req.params.id);
    }
    return propertySummary(getProperty(req.params.id));
  }));

  api.delete('/properties/:id', route((req) => {
    getProperty(req.params.id);
    db.prepare('DELETE FROM properties WHERE id = ?').run(req.params.id);
  }));

  // Items
  api.post('/properties/:id/items', route((req) => {
    const property = getProperty(req.params.id);
    const data = pick(req.body, ITEM_FIELDS);
    if (!data.name) throw new HttpError(400, 'Give the item a name');
    const cols = Object.keys(data);
    const r = db.prepare(
      `INSERT INTO items (property_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
    ).run(property.id, ...cols.map((c) => data[c]));
    return getItem(r.lastInsertRowid);
  }));

  api.put('/items/:id', route((req) => {
    const item = getItem(req.params.id);
    const data = pick(req.body, ITEM_FIELDS);
    if (data.name === '') throw new HttpError(400, 'Give the item a name');
    tx(() => {
      // Quantity edits go through the ledger so the history stays complete.
      if (data.quantity !== undefined && data.quantity !== item.quantity) {
        logChange(item, data.quantity - item.quantity, 'adjust', { note: 'Edited' });
      }
      delete data.quantity;
      const cols = Object.keys(data);
      if (cols.length) {
        db.prepare(`UPDATE items SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now')
          WHERE id = ?`).run(...cols.map((c) => data[c]), item.id);
      }
    });
    return getItem(item.id);
  }));

  api.delete('/items/:id', route((req) => {
    getItem(req.params.id);
    db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  }));

  // Add or remove a few units: { delta, note }
  api.post('/items/:id/adjust', route((req) => {
    const item = getItem(req.params.id);
    const delta = Number(req.body.delta);
    if (!Number.isFinite(delta) || delta === 0) throw new HttpError(400, 'delta must be a non-zero number');
    const change = Math.max(-item.quantity, delta);
    tx(() => logChange(item, change, delta > 0 ? 'restock' : 'used', { note: req.body.note || '' }));
    return getItem(item.id);
  }));

  // Physical stock count: { counts: [{ item_id, quantity }] }
  api.post('/properties/:id/counts', route((req) => {
    const property = getProperty(req.params.id);
    const counts = Array.isArray(req.body.counts) ? req.body.counts : [];
    let changed = 0;
    tx(() => {
      for (const c of counts) {
        const qty = Number(c.quantity);
        if (c.quantity === '' || c.quantity == null || !Number.isFinite(qty) || qty < 0) continue;
        const item = getItem(c.item_id);
        if (item.property_id !== property.id) throw new HttpError(400, 'Item belongs to another property');
        if (qty !== item.quantity) {
          logChange(item, qty - item.quantity, 'count', { note: req.body.note || '' });
          changed++;
        }
      }
    });
    return { changed };
  }));

  api.get('/properties/:id/activity', route((req) => {
    getProperty(req.params.id);
    return db.prepare(
      `SELECT t.*, i.name AS item_name, i.unit FROM transactions t JOIN items i ON i.id = t.item_id
       WHERE t.property_id = ? ORDER BY t.id DESC LIMIT 200`,
    ).all(req.params.id);
  }));

  // Stays
  api.get('/properties/:id/stays', route((req) => {
    const property = getProperty(req.params.id);
    processDueStays(property.id);
    const stays = db.prepare(
      `SELECT * FROM stays WHERE property_id = ? AND (check_out >= ? OR consumed_at >= datetime('now', '-30 days'))
       ORDER BY check_in`,
    ).all(property.id, inv.addDays(today(), -30));
    return stays.map((s) => ({ ...s, nights: inv.nights(s) }));
  }));

  api.post('/properties/:id/stays', route((req) => {
    const property = getProperty(req.params.id);
    const data = pick(req.body, STAY_FIELDS);
    if (!data.check_in || !data.check_out) throw new HttpError(400, 'Check-in and check-out dates are required');
    if (data.check_out <= data.check_in) throw new HttpError(400, 'Check-out must be after check-in');
    const r = db.prepare(
      'INSERT INTO stays (property_id, check_in, check_out, guests, summary) VALUES (?, ?, ?, ?, ?)',
    ).run(property.id, data.check_in, data.check_out, data.guests ?? null, data.summary || 'Manual booking');
    processDueStays(property.id);
    return getStay(r.lastInsertRowid);
  }));

  api.put('/stays/:id', route((req) => {
    const stay = getStay(req.params.id);
    const data = pick(req.body, { ...STAY_FIELDS, status: 'string' });
    if (data.status && !['booked', 'cancelled'].includes(data.status)) throw new HttpError(400, 'Invalid status');
    const merged = { ...stay, ...data };
    if (merged.check_out <= merged.check_in) throw new HttpError(400, 'Check-out must be after check-in');
    const cols = Object.keys(data);
    if (cols.length) {
      db.prepare(`UPDATE stays SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
        .run(...cols.map((c) => data[c]), stay.id);
    }
    return getStay(stay.id);
  }));

  api.delete('/stays/:id', route((req) => {
    getStay(req.params.id);
    db.prepare('DELETE FROM stays WHERE id = ?').run(req.params.id);
  }));

  // Record a turnover now, e.g. for properties with auto-deduct off.
  api.post('/stays/:id/consume', route((req) => {
    consumeStay(getStay(req.params.id));
    return getStay(req.params.id);
  }));

  api.post('/properties/:id/sync', route((req) => syncIcal(getProperty(req.params.id))));

  // Orders
  api.post('/properties/:id/orders/generate', route((req) => {
    const ids = Array.isArray(req.body.item_ids) ? req.body.item_ids : null;
    return generateOrders(getProperty(req.params.id), ids);
  }));

  api.get('/orders', route((req) => {
    const where = [];
    const args = [];
    if (req.query.status) { where.push('status = ?'); args.push(req.query.status); }
    if (req.query.property_id) { where.push('property_id = ?'); args.push(req.query.property_id); }
    return db.prepare(
      `SELECT * FROM orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 200`,
    ).all(...args).map(orderView);
  }));

  api.get('/orders/:id', route((req) => orderView(getOrderRow(req.params.id))));

  const TRANSITIONS = { draft: ['ordered', 'cancelled'], ordered: ['draft', 'cancelled'], cancelled: ['draft'] };

  api.put('/orders/:id', route((req) => {
    const order = getOrderRow(req.params.id);
    const { status, notes } = req.body;
    if (notes !== undefined) db.prepare('UPDATE orders SET notes = ? WHERE id = ?').run(String(notes), order.id);
    if (status && status !== order.status) {
      if (!(TRANSITIONS[order.status] || []).includes(status)) {
        throw new HttpError(400, `Cannot move an order from ${order.status} to ${status}`);
      }
      db.prepare(`UPDATE orders SET status = ?, ordered_at = CASE WHEN ? = 'ordered' THEN datetime('now')
        ELSE ordered_at END WHERE id = ?`).run(status, status, order.id);
    }
    return orderView(getOrderRow(order.id));
  }));

  api.delete('/orders/:id', route((req) => {
    const order = getOrderRow(req.params.id);
    if (order.status === 'received') throw new HttpError(400, 'Received orders are kept for the record');
    db.prepare('DELETE FROM orders WHERE id = ?').run(order.id);
  }));

  api.post('/orders/:id/lines', route((req) => {
    const order = getOrderRow(req.params.id);
    if (order.status === 'received') throw new HttpError(400, 'This order was already received');
    const item = getItem(req.body.item_id);
    if (item.property_id !== order.property_id) throw new HttpError(400, 'Item belongs to another property');
    const packs = Math.max(1, Number(req.body.packs) || 1);
    db.prepare(
      `INSERT INTO order_lines (order_id, item_id, packs, pack_size, pack_cost) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (order_id, item_id) DO UPDATE SET packs = excluded.packs`,
    ).run(order.id, item.id, packs, item.pack_size || 1, item.pack_cost);
    return orderView(order);
  }));

  const lineWithOrder = (id) => {
    const line = db.prepare('SELECT * FROM order_lines WHERE id = ?').get(id);
    if (!line) throw new HttpError(404, 'Order line not found');
    const order = getOrderRow(line.order_id);
    if (order.status === 'received') throw new HttpError(400, 'This order was already received');
    return { line, order };
  };

  api.put('/order-lines/:id', route((req) => {
    const { line, order } = lineWithOrder(req.params.id);
    const packs = Number(req.body.packs);
    if (!Number.isFinite(packs) || packs <= 0) throw new HttpError(400, 'packs must be a positive number');
    db.prepare('UPDATE order_lines SET packs = ? WHERE id = ?').run(packs, line.id);
    return orderView(order);
  }));

  api.delete('/order-lines/:id', route((req) => {
    const { line, order } = lineWithOrder(req.params.id);
    db.prepare('DELETE FROM order_lines WHERE id = ?').run(line.id);
    return orderView(order);
  }));

  // Mark an order as delivered and add it to stock.
  // Body (optional): { lines: [{ id, received_packs }] } for partial deliveries.
  api.post('/orders/:id/receive', route((req) => {
    const order = getOrderRow(req.params.id);
    if (!['ordered', 'draft'].includes(order.status)) throw new HttpError(400, `Cannot receive a ${order.status} order`);
    const overrides = new Map((req.body.lines || []).map((l) => [Number(l.id), Number(l.received_packs)]));
    tx(() => {
      const lines = db.prepare('SELECT * FROM order_lines WHERE order_id = ?').all(order.id);
      for (const line of lines) {
        const got = overrides.has(line.id) ? overrides.get(line.id) : line.packs;
        if (!Number.isFinite(got) || got < 0) throw new HttpError(400, 'received_packs must be a non-negative number');
        db.prepare('UPDATE order_lines SET received_packs = ? WHERE id = ?').run(got, line.id);
        if (got > 0) {
          logChange(getItem(line.item_id), got * line.pack_size, 'restock',
            { orderId: order.id, note: `${order.vendor} order #${order.id}` });
        }
      }
      db.prepare(`UPDATE orders SET status = 'received', received_at = datetime('now'),
        ordered_at = COALESCE(ordered_at, datetime('now')) WHERE id = ?`).run(order.id);
    });
    return orderView(getOrderRow(order.id));
  }));

  api.get('/orders/:id/csv', route((req, res) => {
    const order = orderView(getOrderRow(req.params.id));
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Item', 'Category', 'Packs', 'Pack', 'Units', 'Pack cost', 'Line total', 'Link']];
    for (const l of order.lines) {
      rows.push([l.name, l.category, l.packs, l.pack_label || `${l.pack_size} ${l.unit}`, l.units,
        l.pack_cost ?? '', l.pack_cost != null ? inv.round(l.pack_cost * l.packs) : '', l.buy_url]);
    }
    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', `attachment; filename="order-${order.id}-${order.vendor.replace(/\W+/g, '-')}.csv"`);
    res.send(rows.map((r) => r.map(esc).join(',')).join('\n'));
  }));

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 && !err.status ? 'Something went wrong' : err.message });
  });

  app.locals.db = db;
  app.locals.processDueStays = processDueStays;
  app.locals.syncIcal = syncIcal;
  app.locals.getProperty = getProperty;
  return app;
}

module.exports = { createApp };
