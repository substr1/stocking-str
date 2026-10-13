# Stocking — supplies tracker for short-term rentals

Keep every Airbnb/VRBO stocked without walking the closet before each booking.
Stocking tracks linens, toilet paper, paper towels, coffee and tea, sweeteners,
stirrers, to-go cups, snacks, sponges, toiletries and cleaning supplies per
property. It deducts what each stay uses, warns you before something runs
out, and builds shopping lists per store.

## How it works

1. **Add a property.** You get a starter list of about 60 supplies, sized to
   the rental's bedrooms, bathrooms and guest count. Edit, remove or add
   anything.
2. **Connect your booking calendar.** Paste the iCal export link from Airbnb,
   VRBO or Booking.com. Bookings sync every few hours, and calendar blocks and
   cancellations are handled. You can also enter stays by hand.
3. **Supplies are deducted after each checkout.** Each item has a "per stay"
   rate (e.g. 2 trash bags) and a "per guest per night" rate (e.g. 1.5 coffee
   pods). Turn this off for a property if you prefer to log turnovers
   yourself.
4. **Correct with real counts.** The *Stock count* tab is a quick form a
   cleaner can fill in on a phone after a turnover. Every change is kept in
   the *Activity* log.
5. **Reorder.** Items show as *Low*, *Out* or *Reorder soon*. "Reorder soon"
   means upcoming bookings within the delivery lead time will push the item
   under its reorder point. **Create orders** builds a draft order for each
   store, topping each item back up to par in whole packs. Each line has a Buy
   link (your saved product link, or a store search), and you can copy the
   list or download it as CSV.
6. **Mark the order as ordered, then received.** Items on order aren't
   suggested again. Receiving adds the stock back (partial deliveries are
   supported).

## Running it

Requires Node.js 18+.

```bash
npm install
npm start            # http://localhost:3000
npm test
```

Configuration (environment variables):

| Variable              | Default               | Purpose                                              |
|-----------------------|-----------------------|------------------------------------------------------|
| `PORT`                | `3000`                | HTTP port                                            |
| `DB_PATH`             | `data/stocking.db`    | SQLite database file                                 |
| `APP_PASSWORD`        | *(none)*              | Require this password (HTTP basic auth, any username) |
| `SYNC_INTERVAL_HOURS` | `6`                   | Calendar sync interval; `0` disables background sync |
| `TZ`                  | system                | Time zone that decides when a checkout day has passed |

Set `APP_PASSWORD` and serve over HTTPS before exposing it to the internet.
All data lives in a single SQLite file, so back up `DB_PATH`.

## Project layout

```
server/
  app.js        Express API and business rules
  inventory.js  Usage, stock status, forecasting and reorder math (pure functions)
  ical.js       Airbnb / VRBO / Booking.com calendar parser
  templates.js  Starter supply list and how it scales with property size
  vendors.js    Store search links
  db.js         SQLite schema
public/         Single-page frontend (plain HTML/CSS/JS, no build step)
test/           node:test suites
```

## Ideas for what's next

- Low-stock email/SMS alerts and a weekly "what to buy" digest
- Share links that let cleaners submit counts without an account
- Multiple users per account (owners, co-hosts, cleaners)
- Placing orders automatically through store APIs (e.g. Amazon Business, Instacart)
  instead of following links
- Learning actual usage rates from count history
