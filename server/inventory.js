'use strict';

// Pure inventory math: no database access here, so it is easy to test.

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(iso, days) {
  return isoDate(toDate(iso) + days * DAY_MS);
}

function nights(stay) {
  return Math.max(1, Math.round((toDate(stay.check_out) - toDate(stay.check_in)) / DAY_MS));
}

function round(n) {
  return Math.round(n * 100) / 100;
}

// Units of `item` one stay uses up.
function usageForStay(item, stay, defaultGuests) {
  const guests = stay.guests || defaultGuests || 2;
  return round(item.per_stay + item.per_guest_night * guests * nights(stay));
}

function stockStatus(item) {
  if (item.par_level <= 0 && item.reorder_point <= 0) return 'untracked';
  if (item.quantity <= 0) return 'out';
  if (item.quantity <= item.reorder_point) return 'low';
  return 'ok';
}

// Walk upcoming stays in checkout order and work out when an item hits its
// reorder point and when it runs out completely.
//   stays:    booked stays not yet deducted, any order
//   incoming: units on orders that have been placed but not yet received
function forecastItem(item, stays, { defaultGuests, incoming = 0 } = {}) {
  const sorted = [...stays].sort((a, b) => a.check_out.localeCompare(b.check_out));
  let qty = item.quantity + incoming;
  let reorderBy = null;
  let runsOutOn = null;
  const reorderAt = item.reorder_point;
  if (qty <= reorderAt) reorderBy = 'now';
  for (const stay of sorted) {
    const use = usageForStay(item, stay, defaultGuests);
    if (use <= 0) continue;
    qty -= use;
    if (!reorderBy && qty <= reorderAt) reorderBy = stay.check_in;
    if (!runsOutOn && qty < 0) {
      runsOutOn = stay.check_in;
      break;
    }
  }
  return { reorderBy, runsOutOn };
}

// Projected usage over the stays that check out within `days` of `today`.
function usageWithin(item, stays, today, days, defaultGuests) {
  const end = addDays(today, days);
  let total = 0;
  for (const stay of stays) {
    if (stay.check_out <= end) total += usageForStay(item, stay, defaultGuests);
  }
  return round(total);
}

// Should we reorder this item, and how much? We look `leadDays` ahead (the
// time it takes an order to arrive) so stock does not dip below the reorder
// point while waiting, then top it back up to par.
function suggestion(item, stays, { today, leadDays = 7, defaultGuests, incoming = 0 }) {
  const upcomingUse = usageWithin(item, stays, today, leadDays, defaultGuests);
  const projected = round(item.quantity + incoming - upcomingUse);
  const needed = projected <= item.reorder_point && item.par_level > 0;
  if (!needed) return { needed: false, projected, upcomingUse, units: 0, packs: 0 };
  const units = Math.max(0, item.par_level - projected);
  const packSize = item.pack_size > 0 ? item.pack_size : 1;
  const packs = Math.max(1, Math.ceil(round(units / packSize)));
  return { needed: true, projected, upcomingUse, units: round(units), packs };
}

module.exports = {
  addDays, isoDate, nights, usageForStay, stockStatus, forecastItem, usageWithin, suggestion, round,
};
