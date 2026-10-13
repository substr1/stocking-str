// Stocking frontend: a small hash-routed single-page app, no build step.

const view = document.getElementById('view');
const modal = document.getElementById('modal');
let meta = { categories: [], vendors: [], today: '' };
const ui = { filter: 'all', search: '' };
let current = null; // data for the page on screen, used by action handlers

// ------------------------------------------------------------------ helpers

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = (n) => (n == null || n === '' ? '' : String(Math.round(Number(n) * 100) / 100));
const money = (n) => (n == null ? '' : `$${Number(n).toFixed(2)}`);

function fmtDate(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString(undefined, opts);
}
function fmtDateTime(sql) {
  if (!sql) return '';
  return new Date(`${sql.replace(' ', 'T')}Z`).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function daysUntil(iso) {
  return Math.round((new Date(`${iso}T12:00:00`) - new Date(`${meta.today}T12:00:00`)) / 864e5);
}
function relDay(iso) {
  const d = daysUntil(iso);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

async function api(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, isError ? 5000 : 2600);
}

function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return out;
}

const STATUS_LABEL = { ok: 'In stock', low: 'Low', out: 'Out', untracked: 'Not tracked' };
const statusPill = (s) => `<span class="pill ${s}">${STATUS_LABEL[s] || s}</span>`;
const orderPill = (s) => `<span class="pill ${s}">${{ draft: 'Draft', ordered: 'Ordered', received: 'Received', cancelled: 'Cancelled' }[s] || s}</span>`;

function forecastText(item) {
  const f = item.forecast;
  if (item.status === 'untracked') return '';
  if (f.runsOutOn) return `Runs out during the ${fmtDate(f.runsOutOn, { month: 'short', day: 'numeric' })} stay`;
  if (f.reorderBy && f.reorderBy !== 'now') return `Low after the ${fmtDate(f.reorderBy, { month: 'short', day: 'numeric' })} stay`;
  return '';
}

function stockBar(item) {
  if (!item.par_level) return '';
  const pct = Math.max(0, Math.min(100, (item.quantity / item.par_level) * 100));
  return `<div class="bar ${item.status}" title="${fmt(item.quantity)} of ${fmt(item.par_level)} par"><span style="width:${pct}%"></span></div>`;
}

// ------------------------------------------------------------------ router

const routes = [
  [/^\/?$/, renderDashboard, 'dashboard'],
  [/^\/new$/, renderNewProperty, 'new'],
  [/^\/p\/(\d+)(?:\/(\w+))?$/, renderProperty, ''],
  [/^\/orders$/, renderOrders, 'orders'],
  [/^\/orders\/(\d+)$/, renderOrder, 'orders'],
];

async function route() {
  const path = location.hash.replace(/^#/, '') || '/';
  for (const [re, fn, nav] of routes) {
    const m = path.match(re);
    if (!m) continue;
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
    try {
      await fn(...m.slice(1));
    } catch (err) {
      view.innerHTML = `<div class="card empty"><h2>Something went wrong</h2><p>${esc(err.message)}</p>
        <a class="btn" href="#/">Back to dashboard</a></div>`;
    }
    return;
  }
  location.hash = '#/';
}

const refresh = () => route();

// ------------------------------------------------------------------ dashboard

async function renderDashboard() {
  const d = await api('GET', '/dashboard');
  meta.today = d.today;
  current = d;
  if (!d.properties.length) {
    view.innerHTML = `
      <div class="card empty" style="padding:56px 20px">
        <h2>Never run out of toilet paper again</h2>
        <p>Add your first rental. We'll start you with a full supply list — linens, paper goods, coffee and tea,
        toiletries, cleaning supplies and snacks — sized to the number of bedrooms, bathrooms and guests.</p>
        <p><a class="btn primary" href="#/new">Add a property</a></p>
      </div>`;
    return;
  }
  const out = d.properties.reduce((n, p) => n + p.out_count, 0);
  const byProperty = new Map();
  for (const item of d.reorder) {
    if (!byProperty.has(item.property_id)) byProperty.set(item.property_id, []);
    byProperty.get(item.property_id).push(item);
  }
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Dashboard</h1><p class="muted">${fmtDate(d.today, { weekday: 'long', month: 'long', day: 'numeric' })}</p></div>
    </div>
    <div class="stats">
      <div class="stat"><div class="label">Properties</div><div class="value">${d.properties.length}</div></div>
      <div class="stat ${d.reorder.length ? 'attn' : ''}"><div class="label">Items to reorder</div><div class="value">${d.reorder.length}</div></div>
      <div class="stat ${out ? 'bad' : ''}"><div class="label">Out of stock</div><div class="value">${out}</div></div>
      <div class="stat"><div class="label">Turnovers, next 14 days</div><div class="value">${d.turnovers.length}</div></div>
    </div>

    <div class="grid props" style="margin-bottom:16px">
      ${d.properties.map((p) => `
        <a class="card prop-card" href="#/p/${p.id}" style="margin:0">
          <h3>${esc(p.name)}</h3>
          <div class="muted small">${p.bedrooms} bd · ${p.bathrooms} ba · sleeps ${p.max_guests}</div>
          <div class="small" style="margin-top:6px">${p.next_stay
    ? `Next stay ${fmtDate(p.next_stay.check_in)} → ${fmtDate(p.next_stay.check_out)}`
    : '<span class="muted">No upcoming stays</span>'}</div>
          <div class="pills">
            ${p.reorder_count ? `<span class="pill low">${p.reorder_count} to reorder</span>` : '<span class="pill ok">Stocked</span>'}
            ${p.out_count ? `<span class="pill out">${p.out_count} out</span>` : ''}
            ${p.open_orders ? `<span class="pill info">${p.open_orders} open order${p.open_orders > 1 ? 's' : ''}</span>` : ''}
          </div>
        </a>`).join('')}
    </div>

    <div class="grid grid-2">
      <section class="card">
        <div class="card-head"><h2>Needs reordering</h2></div>
        ${d.reorder.length ? [...byProperty.entries()].map(([pid, items]) => `
          <div style="margin-bottom:14px">
            <div class="card-head" style="margin-bottom:4px">
              <h3>${esc(items[0].property_name)}</h3>
              <button class="sm primary" data-action="generate" data-property="${pid}">Create orders</button>
            </div>
            <ul class="list">${items.map((i) => `
              <li><div><div class="item-name">${esc(i.name)}</div>
                <div class="item-sub">${fmt(i.quantity)} ${esc(i.unit)} left · ${forecastText(i) || `reorder at ${fmt(i.reorder_point)}`}</div></div>
                <div class="actions">${statusPill(i.status)}<span class="small muted">${i.suggestion.packs} × ${esc(i.pack_label || `${fmt(i.pack_size)} ${i.unit}`)}</span></div></li>`).join('')}
            </ul>
          </div>`).join('') : '<p class="muted">Everything is stocked for the upcoming stays. 🎉</p>'}
      </section>

      <div>
        <section class="card">
          <div class="card-head"><h2>Upcoming turnovers</h2></div>
          ${d.turnovers.length ? `<ul class="list">${d.turnovers.map((s) => `
            <li><div><div class="item-name">${esc(s.property_name)}</div>
              <div class="item-sub">${esc(s.summary)}${s.guests ? ` · ${s.guests} guests` : ''}</div></div>
              <div class="right small"><div>Checkout ${fmtDate(s.check_out)}</div><div class="muted">${relDay(s.check_out)}</div></div></li>`).join('')}</ul>`
    : '<p class="muted">No checkouts in the next two weeks.</p>'}
        </section>
        <section class="card">
          <div class="card-head"><h2>Open orders</h2><a class="small" href="#/orders">All orders</a></div>
          ${d.orders.length ? `<ul class="list">${d.orders.map((o) => `
            <li><div><a class="item-name" href="#/orders/${o.id}">${esc(o.vendor)} · ${esc(o.property.name)}</a>
              <div class="item-sub">${o.lines.length} item${o.lines.length === 1 ? '' : 's'}${o.total ? ` · ${money(o.total)}` : ''}</div></div>
              ${orderPill(o.status)}</li>`).join('')}</ul>`
    : '<p class="muted">No open orders.</p>'}
        </section>
      </div>
    </div>`;
}

// ------------------------------------------------------------------ property

function propertyForm(p = {}) {
  const v = (k, d = '') => esc(p[k] ?? d);
  return `
    <fieldset>
      <legend>The rental</legend>
      <div class="form-grid">
        <div class="wide"><label for="f-name">Name</label><input id="f-name" name="name" required value="${v('name')}" placeholder="e.g. Lake Cabin"></div>
        <div class="wide"><label for="f-address">Address <span class="hint">(optional, shown on orders)</span></label><input id="f-address" name="address" value="${v('address')}"></div>
        <div><label for="f-bed">Bedrooms</label><input id="f-bed" name="bedrooms" type="number" min="0" value="${v('bedrooms', 2)}"></div>
        <div><label for="f-bath">Bathrooms</label><input id="f-bath" name="bathrooms" type="number" min="0" value="${v('bathrooms', 1)}"></div>
        <div><label for="f-max">Sleeps</label><input id="f-max" name="max_guests" type="number" min="1" value="${v('max_guests', 4)}"></div>
        <div><label for="f-def">Typical party size</label><input id="f-def" name="default_guests" type="number" min="1" value="${v('default_guests', 2)}">
          <div class="hint">Used when a booking doesn't list a guest count (calendar imports never do).</div></div>
      </div>
    </fieldset>
    <fieldset>
      <legend>Bookings &amp; restocking</legend>
      <div class="form-grid">
        <div class="wide"><label for="f-ical">Booking calendar link (iCal)</label>
          <input id="f-ical" name="ical_url" type="url" value="${v('ical_url')}" placeholder="https://www.airbnb.com/calendar/ical/…">
          <div class="hint">Airbnb: Listing → Availability → Connect calendars → Export calendar. VRBO and Booking.com have the same option.
          Stays are imported automatically and supplies are deducted after each checkout.</div></div>
        <div><label for="f-lead">Delivery lead time (days)</label><input id="f-lead" name="lead_days" type="number" min="0" value="${v('lead_days', 7)}">
          <div class="hint">How far ahead to look when deciding what to reorder.</div></div>
        <div style="align-self:center"><label class="check"><input type="checkbox" name="auto_deduct" ${p.auto_deduct === 0 ? '' : 'checked'}> Deduct supplies automatically after checkout</label></div>
        <div class="wide"><label for="f-notes">Notes</label><textarea id="f-notes" name="notes" placeholder="Where supplies are stored, lockbox code for the closet, cleaner contact…">${v('notes')}</textarea></div>
      </div>
    </fieldset>`;
}

function renderNewProperty() {
  current = null;
  view.innerHTML = `
    <div class="page-head"><div><h1>Add a property</h1>
      <p class="muted">We'll set up a starter supply list sized to this rental. You can edit, remove or add items afterwards.</p></div></div>
    <form class="card" data-form="new-property">
      ${propertyForm()}
      <label class="check" style="margin-bottom:16px"><input type="checkbox" name="use_template" checked>
        Start with the recommended supply list (about 60 items)</label>
      <div class="actions"><button class="primary" type="submit">Create property</button><a class="btn" href="#/">Cancel</a></div>
    </form>`;
}

const TABS = [
  ['supplies', 'Supplies'], ['stays', 'Stays'], ['count', 'Stock count'], ['activity', 'Activity'], ['settings', 'Settings'],
];

async function renderProperty(id, tab = 'supplies') {
  const p = await api('GET', `/properties/${id}`);
  current = { property: p };
  const head = `
    <div class="page-head">
      <div><h1>${esc(p.name)}</h1>
        <p class="muted">${p.address ? `${esc(p.address)} · ` : ''}${p.bedrooms} bd · ${p.bathrooms} ba · sleeps ${p.max_guests}</p></div>
      <div class="actions">
        ${p.ical_url ? '<button data-action="sync">↻ Sync calendar</button>' : ''}
        <button class="primary" data-action="generate" data-property="${p.id}" ${p.reorder_count ? '' : 'disabled'}>
          Create orders${p.reorder_count ? ` (${p.reorder_count})` : ''}</button>
      </div>
    </div>
    <nav class="tabs">${TABS.map(([key, label]) => `
      <a href="#/p/${p.id}/${key}" class="${key === tab ? 'active' : ''}">${label}${key === 'supplies' && p.reorder_count
    ? ` <span class="pill low count">${p.reorder_count}</span>` : ''}</a>`).join('')}</nav>`;
  const body = await ({
    supplies: suppliesTab, stays: staysTab, count: countTab, activity: activityTab, settings: settingsTab,
  }[tab] || suppliesTab)(p);
  view.innerHTML = head + body;
}

function suppliesTab(p) {
  if (!p.items.length) {
    return `<div class="card empty"><h2>No supplies yet</h2><p>Add the things you keep stocked at this rental.</p>
      <button class="primary" data-action="add-item">Add an item</button></div>`;
  }
  const counts = {
    all: p.items.length,
    reorder: p.items.filter((i) => i.suggestion.needed).length,
    low: p.items.filter((i) => i.status === 'low' || i.status === 'out').length,
  };
  const q = ui.search.toLowerCase();
  const shown = p.items.filter((i) => {
    if (ui.filter === 'reorder' && !i.suggestion.needed) return false;
    if (ui.filter === 'low' && !(i.status === 'low' || i.status === 'out')) return false;
    return !q || `${i.name} ${i.category} ${i.vendor}`.toLowerCase().includes(q);
  });
  let lastCat = null;
  const rows = shown.map((i) => {
    const cat = i.category !== lastCat ? `<tr class="cat-row"><td colspan="5">${esc(i.category)}</td></tr>` : '';
    lastCat = i.category;
    const notes = [forecastText(i)];
    if (i.incoming) notes.push(`${fmt(i.incoming)} on the way`);
    if (i.in_draft) notes.push(`<a href="#/orders/${i.in_draft.order_id}">in draft order</a>`);
    return `${cat}
      <tr class="item-row">
        <td class="c-name"><div class="item-name">${esc(i.name)}</div>
          <div class="item-sub">${notes.filter(Boolean).join(' · ') || (i.vendor ? `Buy at ${esc(i.vendor)}` : 'No store set')}</div></td>
        <td class="c-qty"><div class="stepper">
            <button class="sm" data-action="adjust" data-id="${i.id}" data-delta="-1" aria-label="Use one ${esc(i.name)}">−</button>
            <span class="qty">${fmt(i.quantity)}</span>
            <button class="sm" data-action="adjust" data-id="${i.id}" data-delta="1" aria-label="Add one ${esc(i.name)}">+</button>
          </div>
          <div class="item-sub">${esc(i.unit)}</div></td>
        <td class="c-level">${stockBar(i)}<div class="item-sub">par ${fmt(i.par_level)} · reorder at ${fmt(i.reorder_point)}</div></td>
        <td class="c-status">${statusPill(i.status)}${i.suggestion.needed && i.status === 'ok' ? ' <span class="pill low">Reorder soon</span>' : ''}</td>
        <td class="right c-act"><div class="actions" style="justify-content:flex-end">
          <a class="btn sm" href="${esc(i.buy_url)}" target="_blank" rel="noopener">Buy</a>
          <button class="sm ghost" data-action="edit-item" data-id="${i.id}">Edit</button></div></td>
      </tr>`;
  }).join('');
  return `
    <div class="toolbar">
      <div class="chips">
        ${[['all', 'All'], ['reorder', 'Needs reorder'], ['low', 'Low or out']].map(([k, label]) => `
          <button class="chip ${ui.filter === k ? 'active' : ''}" data-action="filter" data-filter="${k}">${label} · ${counts[k]}</button>`).join('')}
      </div>
      <input type="search" placeholder="Search supplies" value="${esc(ui.search)}" data-input="search" aria-label="Search supplies">
      <span style="flex:1"></span>
      <button data-action="add-item">+ Add item</button>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap"><table>
        <thead class="supplies-head"><tr><th>Item</th><th>On hand</th><th class="hide-sm">Level</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="empty">Nothing matches.</td></tr>'}</tbody>
      </table></div>
    </div>`;
}

async function staysTab(p) {
  const stays = await api('GET', `/properties/${p.id}/stays`);
  current.stays = stays;
  const upcoming = stays.filter((s) => !s.consumed_at && s.status === 'booked');
  const past = stays.filter((s) => s.consumed_at || s.status !== 'booked').reverse();
  const row = (s) => `
    <tr>
      <td><div class="item-name">${fmtDate(s.check_in)} → ${fmtDate(s.check_out)}</div>
        <div class="item-sub">${s.nights} night${s.nights === 1 ? '' : 's'} · ${esc(s.summary)}${s.source === 'ical' ? ' · from calendar' : ''}</div></td>
      <td>${s.guests ? `${s.guests} guests` : `<span class="muted">~${p.default_guests} guests</span>`}</td>
      <td>${s.status === 'cancelled' ? '<span class="pill cancelled">Cancelled</span>'
    : s.consumed_at ? '<span class="pill ok">Supplies deducted</span>'
      : `<span class="pill info">Checkout ${relDay(s.check_out)}</span>`}</td>
      <td class="right"><div class="actions" style="justify-content:flex-end">
        ${!s.consumed_at && s.status === 'booked' ? `<button class="sm" data-action="consume" data-id="${s.id}" title="Deduct this stay's supplies now">Log turnover</button>` : ''}
        ${!s.consumed_at ? `<button class="sm ghost" data-action="edit-stay" data-id="${s.id}">Edit</button>` : ''}
      </div></td>
    </tr>`;
  return `
    ${p.ical_url ? `<div class="callout small">Synced with your booking calendar${p.last_synced_at ? ` · last sync ${fmtDateTime(p.last_synced_at)}` : ''}.
      Calendar feeds don't include guest counts, so we assume ${p.default_guests} guests unless you edit a stay.</div>`
    : `<div class="callout small">Tip: paste your Airbnb/VRBO calendar link in <a href="#/p/${p.id}/settings">Settings</a> to import bookings automatically.</div>`}
    <div class="toolbar"><h2 style="flex:1">Upcoming stays</h2><button data-action="add-stay">+ Add stay</button></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table><tbody>
      ${upcoming.map(row).join('') || '<tr><td class="empty">No upcoming stays.</td></tr>'}
    </tbody></table></div></div>
    ${past.length ? `<h2 style="margin:22px 0 10px">Recent</h2>
    <div class="card" style="padding:0"><div class="table-wrap"><table><tbody>${past.map(row).join('')}</tbody></table></div></div>` : ''}`;
}

function countTab(p) {
  const byCat = new Map();
  for (const i of p.items) {
    if (!byCat.has(i.category)) byCat.set(i.category, []);
    byCat.get(i.category).push(i);
  }
  return `
    <div class="callout small">Walk the supply closet and enter what's actually there. Leave a box blank if it didn't change.
      Handy for cleaners after a turnover — this page works well on a phone.</div>
    <form data-form="count">
      ${[...byCat.entries()].map(([cat, items]) => `
        <section class="card"><h2 style="margin-bottom:8px">${esc(cat)}</h2>
          <div class="count-grid">${items.map((i) => `
            <label class="count-row" style="margin:0;font-weight:500">
              <span>${esc(i.name)}<span class="item-sub"> · ${esc(i.unit)}</span></span>
              <input type="number" inputmode="decimal" min="0" step="any" name="${i.id}" placeholder="${fmt(i.quantity)}" data-input="count">
            </label>`).join('')}
          </div></section>`).join('')}
      <div class="form-grid" style="margin-bottom:8px"><div class="wide"><label for="count-note">Note <span class="hint">(optional)</span></label>
        <input id="count-note" name="__note" placeholder="e.g. Counted by Maria after the Oct 17 turnover"></div></div>
      <div class="sticky-foot"><span class="muted small" id="count-changed" style="margin-right:auto;align-self:center"></span>
        <button type="reset">Clear</button><button class="primary" type="submit">Save count</button></div>
    </form>`;
}

const REASONS = { stay: 'Stay', count: 'Count', restock: 'Restock', used: 'Used', adjust: 'Edit' };

async function activityTab(p) {
  const log = await api('GET', `/properties/${p.id}/activity`);
  if (!log.length) return '<div class="card empty">No activity yet. Stock changes, counts and deliveries will show up here.</div>';
  return `<div class="card" style="padding:0"><div class="table-wrap"><table>
    <thead><tr><th>When</th><th>Item</th><th>Change</th><th class="hide-sm">After</th><th>Why</th></tr></thead>
    <tbody>${log.map((t) => `<tr>
      <td class="small">${fmtDateTime(t.created_at)}</td>
      <td>${esc(t.item_name)}</td>
      <td class="num" style="color:${t.delta < 0 ? 'var(--bad)' : 'var(--ok)'}">${t.delta > 0 ? '+' : ''}${fmt(t.delta)}</td>
      <td class="num hide-sm">${fmt(t.quantity_after)} ${esc(t.unit)}</td>
      <td><span class="pill">${REASONS[t.reason] || esc(t.reason)}</span>
        ${t.order_id ? `<a class="small" href="#/orders/${t.order_id}">order</a>` : ''}
        ${t.note ? `<span class="small muted">${esc(t.note)}</span>` : ''}</td>
    </tr>`).join('')}</tbody></table></div></div>`;
}

function settingsTab(p) {
  return `
    <form class="card" data-form="property-settings">
      ${propertyForm(p)}
      <div class="actions"><button class="primary" type="submit">Save changes</button></div>
    </form>
    <div class="card"><div class="card-head"><div><h2>Delete property</h2>
      <p class="muted small" style="margin:4px 0 0">Removes its supplies, stays, orders and history. This can't be undone.</p></div>
      <button class="danger" data-action="delete-property">Delete</button></div></div>`;
}

// ------------------------------------------------------------------ modals

function openModal(html, onSubmit) {
  modal.innerHTML = html;
  const form = modal.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (e.submitter && e.submitter.value === 'cancel') { modal.close(); return; }
    try {
      await onSubmit(formData(form), e.submitter && e.submitter.value);
      modal.close();
    } catch (err) {
      toast(err.message, true);
    }
  });
  modal.showModal();
  const first = form.querySelector('input, select, textarea');
  if (first) first.focus();
}

function itemModal(item, propertyId) {
  const isNew = !item;
  const i = item || { category: meta.categories[0], unit: 'units', quantity: 0, par_level: 0, reorder_point: 0,
    per_stay: 0, per_guest_night: 0, pack_size: 1, vendor: 'Amazon' };
  const v = (k) => esc(i[k] ?? '');
  openModal(`
    <form>
      <h2>${isNew ? 'Add an item' : `Edit ${esc(i.name)}`}</h2>
      <div class="form-grid">
        <div class="wide"><label for="i-name">Name</label><input id="i-name" name="name" required value="${v('name')}"></div>
        <div><label for="i-cat">Category</label><input id="i-cat" name="category" list="cat-list" value="${v('category')}">
          <datalist id="cat-list">${meta.categories.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
        <div><label for="i-unit">Counted in</label><input id="i-unit" name="unit" value="${v('unit')}" placeholder="rolls, pods, bottles…"></div>
        <div><label for="i-qty">On hand now</label><input id="i-qty" name="quantity" type="number" min="0" step="any" value="${fmt(i.quantity)}"></div>
        <div><label for="i-par">Par level</label><input id="i-par" name="par_level" type="number" min="0" step="any" value="${fmt(i.par_level)}">
          <div class="hint">How many to have after restocking.</div></div>
        <div><label for="i-re">Reorder at</label><input id="i-re" name="reorder_point" type="number" min="0" step="any" value="${fmt(i.reorder_point)}">
          <div class="hint">Order more once stock falls this low.</div></div>
      </div>
      <h3 style="margin:18px 0 8px">How fast it's used</h3>
      <div class="form-grid">
        <div><label for="i-ps">Per stay</label><input id="i-ps" name="per_stay" type="number" min="0" step="any" value="${fmt(i.per_stay)}">
          <div class="hint">Used every turnover, e.g. 2 trash bags.</div></div>
        <div><label for="i-pgn">Per guest per night</label><input id="i-pgn" name="per_guest_night" type="number" min="0" step="any" value="${fmt(i.per_guest_night)}">
          <div class="hint">e.g. 1.5 coffee pods.</div></div>
      </div>
      <h3 style="margin:18px 0 8px">Buying</h3>
      <div class="form-grid">
        <div><label for="i-vendor">Store</label><input id="i-vendor" name="vendor" list="vendor-list" value="${v('vendor')}">
          <datalist id="vendor-list">${meta.vendors.map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist></div>
        <div><label for="i-pack">Units per pack</label><input id="i-pack" name="pack_size" type="number" min="0.01" step="any" value="${fmt(i.pack_size)}"></div>
        <div><label for="i-pl">Pack name <span class="hint">(optional)</span></label><input id="i-pl" name="pack_label" value="${v('pack_label')}" placeholder="30-roll case"></div>
        <div><label for="i-cost">Price per pack</label><input id="i-cost" name="pack_cost" type="number" min="0" step="0.01" value="${i.pack_cost ?? ''}" placeholder="$"></div>
        <div class="wide"><label for="i-url">Product link <span class="hint">(optional — otherwise we search the store)</span></label>
          <input id="i-url" name="product_url" type="url" value="${v('product_url')}" placeholder="https://"></div>
        <div class="wide"><label for="i-notes">Notes</label><input id="i-notes" name="notes" value="${v('notes')}" placeholder="Brand, size, where it's kept…"></div>
      </div>
      <div class="foot">
        ${isNew ? '' : '<button type="submit" value="delete" class="danger" style="margin-right:auto" formnovalidate>Delete</button>'}
        <button type="submit" value="cancel" formnovalidate>Cancel</button>
        <button type="submit" class="primary" value="save">${isNew ? 'Add item' : 'Save'}</button>
      </div>
    </form>`, async (data, action) => {
    if (action === 'delete') {
      if (!confirm(`Delete ${i.name}? Its history will be removed too.`)) return;
      await api('DELETE', `/items/${i.id}`);
      toast(`${i.name} deleted`);
    } else if (isNew) {
      await api('POST', `/properties/${propertyId}/items`, data);
      toast(`${data.name} added`);
    } else {
      await api('PUT', `/items/${i.id}`, data);
      toast('Saved');
    }
    refresh();
  });
}

function stayModal(stay, property) {
  const isNew = !stay;
  const s = stay || { check_in: meta.today, check_out: '', guests: '' };
  openModal(`
    <form>
      <h2>${isNew ? 'Add a stay' : 'Edit stay'}</h2>
      <div class="form-grid">
        <div><label for="s-in">Check-in</label><input id="s-in" name="check_in" type="date" required value="${esc(s.check_in)}"></div>
        <div><label for="s-out">Check-out</label><input id="s-out" name="check_out" type="date" required value="${esc(s.check_out)}"></div>
        <div><label for="s-g">Guests</label><input id="s-g" name="guests" type="number" min="1" value="${esc(s.guests ?? '')}" placeholder="${property.default_guests}"></div>
        <div class="wide"><label for="s-sum">Label</label><input id="s-sum" name="summary" value="${esc(s.summary || '')}" placeholder="Guest name or booking reference"></div>
      </div>
      ${!isNew && s.source === 'ical' ? '<p class="hint">Dates come from your booking calendar and will be updated on the next sync. Adding the guest count improves the forecast.</p>' : ''}
      <div class="foot">
        ${isNew ? '' : `<button type="submit" value="${s.status === 'cancelled' ? 'restore' : 'cancel-stay'}" style="margin-right:auto" formnovalidate>
          ${s.status === 'cancelled' ? 'Restore booking' : 'Mark cancelled'}</button>
          ${s.source === 'ical' ? '' : '<button type="submit" value="delete" class="danger" formnovalidate>Delete</button>'}`}
        <button type="submit" value="cancel" formnovalidate>Close</button>
        <button type="submit" class="primary" value="save">${isNew ? 'Add stay' : 'Save'}</button>
      </div>
    </form>`, async (data, action) => {
    if (action === 'delete') await api('DELETE', `/stays/${s.id}`);
    else if (action === 'cancel-stay') await api('PUT', `/stays/${s.id}`, { status: 'cancelled' });
    else if (action === 'restore') await api('PUT', `/stays/${s.id}`, { status: 'booked' });
    else if (isNew) await api('POST', `/properties/${property.id}/stays`, data);
    else await api('PUT', `/stays/${s.id}`, data);
    toast('Stays updated');
    refresh();
  });
}

// ------------------------------------------------------------------ orders

async function renderOrders() {
  const orders = await api('GET', '/orders');
  current = { orders };
  const groups = [['Open', orders.filter((o) => ['draft', 'ordered'].includes(o.status))],
    ['History', orders.filter((o) => ['received', 'cancelled'].includes(o.status))]];
  view.innerHTML = `
    <div class="page-head"><div><h1>Orders</h1>
      <p class="muted">Draft orders are grouped by store. Place them, mark them ordered, then mark them received to restock.</p></div></div>
    ${orders.length ? groups.filter(([, list]) => list.length).map(([title, list]) => `
      <h2 style="margin:4px 0 10px">${title}</h2>
      <div class="card" style="padding:0"><div class="table-wrap"><table>
        <thead><tr><th>Order</th><th>Property</th><th class="hide-sm">Items</th><th class="right">Total</th><th>Status</th></tr></thead>
        <tbody>${list.map((o) => `<tr>
          <td><a class="item-name" href="#/orders/${o.id}">${esc(o.vendor)} #${o.id}</a>
            <div class="item-sub">${fmtDateTime(o.received_at || o.ordered_at || o.created_at)}</div></td>
          <td>${esc(o.property.name)}</td>
          <td class="hide-sm">${o.lines.length}</td>
          <td class="right num">${o.total ? money(o.total) : '—'}</td>
          <td>${orderPill(o.status)}</td></tr>`).join('')}</tbody></table></div></div>`).join('')
    : `<div class="card empty"><h2>No orders yet</h2>
      <p>When supplies run low, use <strong>Create orders</strong> on the dashboard or a property and we'll build a shopping list for each store.</p></div>`}`;
}

async function renderOrder(id) {
  const o = await api('GET', `/orders/${id}`);
  current = { order: o };
  const editable = o.status === 'draft' || o.status === 'ordered';
  const receiving = o.status === 'ordered' || o.status === 'draft';
  view.innerHTML = `
    <div class="page-head">
      <div><p class="small"><a href="#/orders">← Orders</a></p>
        <h1>${esc(o.vendor)} order #${o.id} ${orderPill(o.status)}</h1>
        <p class="muted">For <a href="#/p/${o.property.id}">${esc(o.property.name)}</a>${o.property.address ? ` · ${esc(o.property.address)}` : ''}
          ${o.ordered_at ? ` · ordered ${fmtDateTime(o.ordered_at)}` : ''}${o.received_at ? ` · received ${fmtDateTime(o.received_at)}` : ''}</p></div>
      <div class="actions">
        ${o.status === 'draft' ? `
          <button data-action="open-links">Open store links</button>
          <button data-action="copy-list">Copy list</button>
          <button class="primary" data-action="order-status" data-status="ordered">Mark as ordered</button>` : ''}
        ${o.status === 'ordered' ? '<button class="primary" data-action="receive">Mark received</button>' : ''}
        <a class="btn" href="/api/orders/${o.id}/csv">CSV</a>
      </div>
    </div>
    ${o.status === 'draft' ? `<div class="callout small">Next: buy these from ${esc(o.vendor)} using the links (or copy the list into a message to your
      cleaner or co-host), then press <strong>Mark as ordered</strong>. Items on order won't be suggested again.</div>` : ''}
    ${o.status === 'ordered' ? `<div class="callout small">When the delivery arrives, press <strong>Mark received</strong> to add it to stock.
      If something was missing, change the received packs first.</div>` : ''}
    <form data-form="receive">
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th>Item</th><th>Packs</th>${receiving && o.status === 'ordered' ? '<th>Received</th>' : ''}
        <th class="hide-sm">Units</th><th class="right">Price</th><th></th></tr></thead>
      <tbody>${o.lines.map((l) => `<tr>
        <td><div class="item-name">${esc(l.name)}</div><div class="item-sub">${esc(l.pack_label || `${fmt(l.pack_size)} ${l.unit}`)} · ${fmt(l.quantity)} ${esc(l.unit)} on hand</div></td>
        <td>${editable ? `<input type="number" min="1" step="1" value="${fmt(l.packs)}" style="width:72px" data-input="packs" data-id="${l.id}" aria-label="Packs of ${esc(l.name)}">`
    : `${fmt(l.packs)}${l.received_packs != null && l.received_packs !== l.packs ? ` <span class="muted small">(got ${fmt(l.received_packs)})</span>` : ''}`}</td>
        ${o.status === 'ordered' ? `<td><input type="number" min="0" step="1" name="${l.id}" value="${fmt(l.packs)}" style="width:72px" aria-label="Packs received of ${esc(l.name)}"></td>` : ''}
        <td class="hide-sm num">${fmt(l.units)} ${esc(l.unit)}</td>
        <td class="right num">${l.pack_cost != null ? money(l.pack_cost * l.packs) : '<span class="muted">—</span>'}</td>
        <td class="right"><div class="actions" style="justify-content:flex-end">
          <a class="btn sm" href="${esc(l.buy_url)}" target="_blank" rel="noopener">Buy</a>
          ${editable ? `<button type="button" class="sm ghost" data-action="remove-line" data-id="${l.id}" aria-label="Remove ${esc(l.name)}">✕</button>` : ''}</div></td>
      </tr>`).join('') || '<tr><td colspan="6" class="empty">This order is empty.</td></tr>'}</tbody>
      ${o.total ? `<tfoot><tr><td colspan="${o.status === 'ordered' ? 4 : 3}" class="right muted">Estimated total</td>
        <td class="right num"><strong>${money(o.total)}</strong></td><td></td></tr></tfoot>` : ''}
    </table></div></div>
    </form>
    <div class="actions">
      ${o.status === 'ordered' ? '<button data-action="order-status" data-status="draft">Back to draft</button>' : ''}
      ${editable ? '<button class="danger" data-action="order-status" data-status="cancelled">Cancel order</button>' : ''}
      ${o.status === 'cancelled' ? '<button data-action="order-status" data-status="draft">Reopen as draft</button><button class="danger" data-action="delete-order">Delete</button>' : ''}
    </div>`;
}

function orderAsText(o) {
  const lines = o.lines.map((l) => `• ${l.name} — ${fmt(l.packs)} × ${l.pack_label || `${fmt(l.pack_size)} ${l.unit}`}`);
  return `${o.vendor} order for ${o.property.name}\n${lines.join('\n')}`;
}

// ------------------------------------------------------------------ events

const actions = {
  async filter(el) { ui.filter = el.dataset.filter; refresh(); },
  async adjust(el) {
    await api('POST', `/items/${el.dataset.id}/adjust`, { delta: Number(el.dataset.delta) });
    refresh();
  },
  async 'add-item'() { itemModal(null, current.property.id); },
  async 'edit-item'(el) { itemModal(current.property.items.find((i) => i.id === Number(el.dataset.id))); },
  async 'add-stay'() { stayModal(null, current.property); },
  async 'edit-stay'(el) { stayModal(current.stays.find((s) => s.id === Number(el.dataset.id)), current.property); },
  async consume(el) {
    if (!confirm('Deduct the supplies this stay used now?')) return;
    await api('POST', `/stays/${el.dataset.id}/consume`);
    toast('Turnover logged and supplies deducted');
    refresh();
  },
  async sync(el) {
    el.disabled = true;
    el.textContent = 'Syncing…';
    try {
      const r = await api('POST', `/properties/${current.property.id}/sync`);
      toast(`Calendar synced: ${r.added} new, ${r.updated} changed, ${r.cancelled} cancelled`);
    } finally { refresh(); }
  },
  async generate(el) {
    const orders = await api('POST', `/properties/${el.dataset.property}/orders/generate`, {});
    if (!orders.length) { toast('Nothing needs reordering right now'); return; }
    toast(`${orders.length} draft order${orders.length > 1 ? 's' : ''} ready`);
    location.hash = orders.length === 1 ? `#/orders/${orders[0].id}` : '#/orders';
  },
  async 'delete-property'() {
    const p = current.property;
    if (prompt(`Type the property name to delete it: ${p.name}`) !== p.name) return;
    await api('DELETE', `/properties/${p.id}`);
    toast(`${p.name} deleted`);
    location.hash = '#/';
  },
  async 'order-status'(el) {
    const status = el.dataset.status;
    if (status === 'cancelled' && !confirm('Cancel this order?')) return;
    await api('PUT', `/orders/${current.order.id}`, { status });
    refresh();
  },
  async receive() {
    const form = view.querySelector('form[data-form="receive"]');
    const lines = [...form.querySelectorAll('input[name]')].map((i) => ({ id: Number(i.name), received_packs: Number(i.value) || 0 }));
    await api('POST', `/orders/${current.order.id}/receive`, { lines });
    toast('Delivery added to stock');
    refresh();
  },
  async 'remove-line'(el) {
    await api('DELETE', `/order-lines/${el.dataset.id}`);
    refresh();
  },
  async 'delete-order'() {
    if (!confirm('Delete this order?')) return;
    await api('DELETE', `/orders/${current.order.id}`);
    location.hash = '#/orders';
  },
  async 'open-links'() {
    const urls = [...new Set(current.order.lines.map((l) => l.buy_url))];
    let blocked = false;
    for (const url of urls) if (!window.open(url, '_blank', 'noopener')) blocked = true;
    if (blocked) toast('Your browser blocked some tabs — allow pop-ups for this site, or use the Buy buttons', true);
  },
  async 'copy-list'() {
    await navigator.clipboard.writeText(orderAsText(current.order));
    toast('Shopping list copied');
  },
};

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  e.preventDefault();
  try {
    await actions[el.dataset.action](el);
  } catch (err) {
    toast(err.message, true);
  }
});

let searchTimer;
document.addEventListener('input', (e) => {
  const kind = e.target.dataset.input;
  if (kind === 'search') {
    ui.search = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const pos = e.target.selectionStart;
      await refresh();
      const box = view.querySelector('[data-input="search"]');
      if (box) { box.focus(); box.setSelectionRange(pos, pos); }
    }, 200);
  } else if (kind === 'count') {
    e.target.classList.toggle('changed', e.target.value !== '');
    const n = view.querySelectorAll('input.changed').length;
    const label = document.getElementById('count-changed');
    if (label) label.textContent = n ? `${n} item${n === 1 ? '' : 's'} counted` : '';
  }
});

document.addEventListener('change', async (e) => {
  if (e.target.dataset.input !== 'packs') return;
  try {
    await api('PUT', `/order-lines/${e.target.dataset.id}`, { packs: Number(e.target.value) });
    refresh();
  } catch (err) { toast(err.message, true); }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const data = formData(form);
  try {
    switch (form.dataset.form) {
      case 'new-property': {
        const p = await api('POST', '/properties', data);
        toast(`${p.name} created with ${p.item_count} supplies`);
        location.hash = `#/p/${p.id}`;
        break;
      }
      case 'property-settings': {
        const p = await api('PUT', `/properties/${current.property.id}`, data);
        if (p.ical_url && p.ical_url !== current.property.ical_url) {
          const r = await api('POST', `/properties/${p.id}/sync`).catch((err) => { toast(err.message, true); return null; });
          if (r) toast(`Saved. Imported ${r.added} booking${r.added === 1 ? '' : 's'} from your calendar`);
        } else {
          toast('Saved');
        }
        refresh();
        break;
      }
      case 'count': {
        const note = data.__note;
        delete data.__note;
        const counts = Object.entries(data).filter(([, v]) => v !== '').map(([id, quantity]) => ({ item_id: Number(id), quantity }));
        if (!counts.length) { toast('Enter at least one count'); return; }
        const r = await api('POST', `/properties/${current.property.id}/counts`, { counts, note });
        toast(`Count saved — ${r.changed} item${r.changed === 1 ? '' : 's'} updated`);
        location.hash = `#/p/${current.property.id}/supplies`;
        break;
      }
      default:
    }
  } catch (err) {
    toast(err.message, true);
  }
});

document.addEventListener('reset', (e) => {
  if (e.target.dataset.form !== 'count') return;
  setTimeout(() => {
    view.querySelectorAll('input.changed').forEach((i) => i.classList.remove('changed'));
    const label = document.getElementById('count-changed');
    if (label) label.textContent = '';
  });
});

window.addEventListener('hashchange', () => {
  if (!/^#\/p\/\d+/.test(location.hash)) { ui.filter = 'all'; ui.search = ''; }
  route();
});

(async () => {
  try { meta = await api('GET', '/meta'); } catch { /* the page shows the error on route */ }
  route();
})();
