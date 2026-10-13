'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS properties (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  address         TEXT NOT NULL DEFAULT '',
  bedrooms        INTEGER NOT NULL DEFAULT 1,
  bathrooms       INTEGER NOT NULL DEFAULT 1,
  max_guests      INTEGER NOT NULL DEFAULT 2,
  default_guests  INTEGER NOT NULL DEFAULT 2,
  lead_days       INTEGER NOT NULL DEFAULT 7,
  auto_deduct     INTEGER NOT NULL DEFAULT 1,
  ical_url        TEXT NOT NULL DEFAULT '',
  last_synced_at  TEXT,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  id               INTEGER PRIMARY KEY,
  property_id      INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  category         TEXT NOT NULL DEFAULT 'Other',
  unit             TEXT NOT NULL DEFAULT 'units',
  quantity         REAL NOT NULL DEFAULT 0,
  par_level        REAL NOT NULL DEFAULT 0,
  reorder_point    REAL NOT NULL DEFAULT 0,
  per_stay         REAL NOT NULL DEFAULT 0,
  per_guest_night  REAL NOT NULL DEFAULT 0,
  pack_size        REAL NOT NULL DEFAULT 1,
  pack_label       TEXT NOT NULL DEFAULT '',
  pack_cost        REAL,
  vendor           TEXT NOT NULL DEFAULT '',
  product_url      TEXT NOT NULL DEFAULT '',
  notes            TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS items_property ON items(property_id);

CREATE TABLE IF NOT EXISTS stays (
  id            INTEGER PRIMARY KEY,
  property_id   INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  check_in      TEXT NOT NULL,
  check_out     TEXT NOT NULL,
  guests        INTEGER,
  source        TEXT NOT NULL DEFAULT 'manual',
  external_uid  TEXT,
  summary       TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'booked',
  consumed_at   TEXT,
  UNIQUE (property_id, external_uid)
);
CREATE INDEX IF NOT EXISTS stays_property ON stays(property_id, check_out);

CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY,
  property_id  INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  vendor       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft',
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  ordered_at   TEXT,
  received_at  TEXT
);

CREATE TABLE IF NOT EXISTS order_lines (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  packs       REAL NOT NULL DEFAULT 1,
  pack_size   REAL NOT NULL DEFAULT 1,
  pack_cost   REAL,
  received_packs REAL,
  UNIQUE (order_id, item_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id              INTEGER PRIMARY KEY,
  property_id     INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  item_id         INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  delta           REAL NOT NULL,
  quantity_after  REAL NOT NULL,
  reason          TEXT NOT NULL,
  stay_id         INTEGER,
  order_id        INTEGER,
  note            TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS transactions_property ON transactions(property_id, created_at);
`;

function openDb(file) {
  const target = file || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'stocking.db');
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new Database(target);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb };
