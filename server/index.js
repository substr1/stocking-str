'use strict';

const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;
const syncHours = Number(process.env.SYNC_INTERVAL_HOURS ?? 6);

const app = createApp({ password: process.env.APP_PASSWORD || '' });

// Keep booking calendars fresh and deduct supplies for finished stays even
// when nobody has the app open.
async function backgroundSync() {
  const { db, syncIcal, processDueStays } = app.locals;
  for (const property of db.prepare("SELECT * FROM properties WHERE ical_url != ''").all()) {
    try {
      await syncIcal(property);
    } catch (err) {
      console.warn(`Calendar sync failed for "${property.name}": ${err.message}`);
    }
  }
  processDueStays();
}

if (syncHours > 0) {
  setInterval(backgroundSync, syncHours * 60 * 60 * 1000).unref();
  setTimeout(backgroundSync, 5000).unref();
}

app.listen(port, () => {
  console.log(`Stocking is running at http://localhost:${port}`);
  if (!process.env.APP_PASSWORD) console.log('Tip: set APP_PASSWORD to require a password.');
});
