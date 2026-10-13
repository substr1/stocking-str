'use strict';

// Starter supply list for a short-term rental. Quantities are expressed per
// "scale unit" so a 4-bedroom house gets more sheet sets than a studio.
//
//   scale:          what the par/reorder numbers are multiplied by
//                   ('bedroom' | 'bathroom' | 'guest' | 'fixed')
//   par:            how many units to have on hand right after a restock
//   reorder:        reorder once stock falls to this level
//   perStay:        units used per turnover regardless of party size
//   perGuestNight:  units used per guest per night
//   pack:           units in one purchasable pack

const CATEGORIES = [
  'Linens',
  'Paper Goods',
  'Coffee & Tea',
  'Kitchen',
  'Bathroom & Toiletries',
  'Cleaning & Laundry',
  'Snacks & Welcome',
  'Maintenance',
];

const T = (name, category, unit, scale, par, reorder, perStay, perGuestNight, pack, vendor, packLabel) => ({
  name, category, unit, scale, par, reorder, perStay, perGuestNight, pack, vendor, packLabel: packLabel || '',
});

const STARTER_ITEMS = [
  // Linens are laundered rather than consumed, but they get stained and wear out.
  T('Sheet sets', 'Linens', 'sets', 'bedroom', 3, 2, 0, 0, 1, 'Amazon'),
  T('Pillowcases', 'Linens', 'cases', 'bedroom', 6, 4, 0, 0, 2, 'Amazon', 'pair'),
  T('Duvet covers', 'Linens', 'covers', 'bedroom', 2, 1, 0, 0, 1, 'Amazon'),
  T('Mattress protectors', 'Linens', 'protectors', 'bedroom', 2, 1, 0, 0, 1, 'Amazon'),
  T('Bath towels', 'Linens', 'towels', 'guest', 3, 2, 0, 0, 6, 'Amazon', '6-pack'),
  T('Hand towels', 'Linens', 'towels', 'bathroom', 3, 2, 0, 0, 6, 'Amazon', '6-pack'),
  T('Washcloths', 'Linens', 'cloths', 'guest', 3, 2, 0, 0, 12, 'Amazon', '12-pack'),
  T('Bath mats', 'Linens', 'mats', 'bathroom', 2, 1, 0, 0, 1, 'Target'),
  T('Kitchen towels', 'Linens', 'towels', 'fixed', 6, 3, 0, 0, 6, 'Target', '6-pack'),

  T('Toilet paper', 'Paper Goods', 'rolls', 'bathroom', 16, 8, 1, 0.5, 30, 'Costco', '30-roll case'),
  T('Paper towels', 'Paper Goods', 'rolls', 'fixed', 8, 3, 0.5, 0.1, 12, 'Costco', '12-roll case'),
  T('Facial tissues', 'Paper Goods', 'boxes', 'bathroom', 4, 2, 0.3, 0, 12, 'Costco', '12-box case'),
  T('Kitchen trash bags', 'Paper Goods', 'bags', 'fixed', 40, 15, 2, 0, 90, 'Costco', '90-count'),
  T('Small trash bags', 'Paper Goods', 'bags', 'bathroom', 30, 10, 2, 0, 100, 'Amazon', '100-count'),
  T('Paper napkins', 'Paper Goods', 'napkins', 'fixed', 100, 40, 4, 0.5, 250, 'Costco', '250-count'),

  T('Coffee pods', 'Coffee & Tea', 'pods', 'fixed', 48, 20, 0, 1.5, 72, 'Costco', '72-count box'),
  T('Ground coffee', 'Coffee & Tea', 'bags', 'fixed', 3, 1, 0.25, 0, 1, 'Costco'),
  T('Coffee filters', 'Coffee & Tea', 'filters', 'fixed', 100, 30, 2, 0, 200, 'Amazon', '200-count'),
  T('Tea bags (assorted)', 'Coffee & Tea', 'bags', 'fixed', 40, 15, 0, 0.5, 100, 'Amazon', '100-count'),
  T('Sugar packets', 'Coffee & Tea', 'packets', 'fixed', 100, 30, 0, 1, 200, 'Amazon', '200-count'),
  T('Sweetener packets', 'Coffee & Tea', 'packets', 'fixed', 100, 30, 0, 0.75, 200, 'Amazon', '200-count'),
  T('Creamer cups', 'Coffee & Tea', 'cups', 'fixed', 48, 18, 0, 1, 192, 'Costco', '192-count'),
  T('Coffee stirrers', 'Coffee & Tea', 'stirrers', 'fixed', 200, 50, 0, 1, 1000, 'Amazon', '1000-count'),
  T('To-go coffee cups with lids', 'Coffee & Tea', 'cups', 'fixed', 50, 15, 0, 0.5, 50, 'Amazon', '50-count'),

  T('Dish soap', 'Kitchen', 'bottles', 'fixed', 3, 1, 0.15, 0, 3, 'Costco', '3-pack'),
  T('Dishwasher pods', 'Kitchen', 'pods', 'fixed', 60, 20, 2, 0.2, 90, 'Costco', '90-count'),
  T('Sponges', 'Kitchen', 'sponges', 'fixed', 12, 4, 1, 0, 12, 'Amazon', '12-pack'),
  T('Aluminum foil', 'Kitchen', 'rolls', 'fixed', 2, 1, 0.05, 0, 1, 'Walmart'),
  T('Plastic wrap', 'Kitchen', 'rolls', 'fixed', 2, 1, 0.05, 0, 1, 'Walmart'),
  T('Cooking oil spray', 'Kitchen', 'cans', 'fixed', 2, 1, 0.1, 0, 2, 'Walmart', '2-pack'),
  T('Salt & pepper', 'Kitchen', 'sets', 'fixed', 2, 1, 0.05, 0, 1, 'Walmart'),

  T('Shampoo', 'Bathroom & Toiletries', 'bottles', 'bathroom', 3, 1, 0.2, 0, 1, 'Amazon'),
  T('Conditioner', 'Bathroom & Toiletries', 'bottles', 'bathroom', 3, 1, 0.2, 0, 1, 'Amazon'),
  T('Body wash', 'Bathroom & Toiletries', 'bottles', 'bathroom', 3, 1, 0.25, 0, 1, 'Amazon'),
  T('Hand soap refill', 'Bathroom & Toiletries', 'bottles', 'fixed', 2, 1, 0.15, 0, 1, 'Costco'),
  T('Bar soap', 'Bathroom & Toiletries', 'bars', 'bathroom', 10, 4, 0.5, 0, 24, 'Amazon', '24-count'),
  T('Lotion', 'Bathroom & Toiletries', 'bottles', 'bathroom', 2, 1, 0.1, 0, 1, 'Amazon'),
  T('Makeup remover wipes', 'Bathroom & Toiletries', 'wipes', 'bathroom', 30, 10, 2, 0, 100, 'Amazon', '100-count'),
  T('Cotton swabs', 'Bathroom & Toiletries', 'swabs', 'fixed', 100, 30, 4, 0, 500, 'Target', '500-count'),
  T('Guest toothbrush kits', 'Bathroom & Toiletries', 'kits', 'fixed', 10, 4, 0.3, 0, 24, 'Amazon', '24-count'),

  T('All-purpose cleaner', 'Cleaning & Laundry', 'bottles', 'fixed', 3, 1, 0.15, 0, 3, 'Costco', '3-pack'),
  T('Glass cleaner', 'Cleaning & Laundry', 'bottles', 'fixed', 2, 1, 0.1, 0, 2, 'Costco', '2-pack'),
  T('Disinfecting wipes', 'Cleaning & Laundry', 'canisters', 'fixed', 4, 2, 0.25, 0, 5, 'Costco', '5-pack'),
  T('Toilet bowl cleaner', 'Cleaning & Laundry', 'bottles', 'bathroom', 2, 1, 0.1, 0, 4, 'Amazon', '4-pack'),
  T('Microfiber cloths', 'Cleaning & Laundry', 'cloths', 'fixed', 24, 10, 0.2, 0, 24, 'Costco', '24-pack'),
  T('Mop pads', 'Cleaning & Laundry', 'pads', 'fixed', 12, 4, 1, 0, 24, 'Amazon', '24-count'),
  T('Disposable gloves', 'Cleaning & Laundry', 'pairs', 'fixed', 30, 10, 2, 0, 50, 'Amazon', 'box of 100'),
  T('Laundry detergent pods', 'Cleaning & Laundry', 'pods', 'fixed', 60, 20, 4, 0, 112, 'Costco', '112-count'),
  T('Dryer sheets', 'Cleaning & Laundry', 'sheets', 'fixed', 80, 25, 4, 0, 240, 'Costco', '240-count'),
  T('Stain remover', 'Cleaning & Laundry', 'bottles', 'fixed', 2, 1, 0.1, 0, 2, 'Amazon', '2-pack'),
  T('Air freshener', 'Cleaning & Laundry', 'cans', 'fixed', 3, 1, 0.15, 0, 3, 'Walmart', '3-pack'),

  T('Bottled water', 'Snacks & Welcome', 'bottles', 'fixed', 24, 8, 0, 1, 40, 'Costco', '40-pack'),
  T('Welcome snack bags', 'Snacks & Welcome', 'bags', 'fixed', 8, 3, 1, 0, 1, 'Costco'),
  T('Granola bars', 'Snacks & Welcome', 'bars', 'fixed', 24, 8, 0, 0.5, 48, 'Costco', '48-count'),
  T('Microwave popcorn', 'Snacks & Welcome', 'bags', 'fixed', 12, 4, 0.5, 0, 24, 'Costco', '24-count'),

  T('AA batteries', 'Maintenance', 'batteries', 'fixed', 8, 4, 0.1, 0, 24, 'Costco', '24-pack'),
  T('AAA batteries', 'Maintenance', 'batteries', 'fixed', 8, 4, 0.1, 0, 24, 'Costco', '24-pack'),
  T('Light bulbs', 'Maintenance', 'bulbs', 'fixed', 6, 2, 0.05, 0, 6, 'Amazon', '6-pack'),
];

function scaleCount(scale, property) {
  switch (scale) {
    case 'bedroom': return Math.max(1, property.bedrooms || 1);
    case 'bathroom': return Math.max(1, property.bathrooms || 1);
    case 'guest': return Math.max(1, property.max_guests || 2);
    default: return 1;
  }
}

// Turn the template into concrete items for one property. New properties start
// at par, which is the usual state right after an owner's initial stock-up.
function itemsForProperty(property) {
  return STARTER_ITEMS.map((t) => {
    const n = scaleCount(t.scale, property);
    const par = Math.ceil(t.par * n);
    return {
      name: t.name,
      category: t.category,
      unit: t.unit,
      quantity: par,
      par_level: par,
      reorder_point: Math.ceil(t.reorder * n),
      per_stay: t.perStay,
      per_guest_night: t.perGuestNight,
      pack_size: t.pack,
      pack_label: t.packLabel,
      vendor: t.vendor,
    };
  });
}

module.exports = { CATEGORIES, STARTER_ITEMS, itemsForProperty };
