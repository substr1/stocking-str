'use strict';

// Minimal iCalendar parser for the booking calendars Airbnb, VRBO and
// Booking.com export. Only VEVENTs with all-day DTSTART/DTEND are needed.

// Airbnb exports owner blocks as "Airbnb (Not available)", VRBO as "Blocked".
const BLOCKED = /not available|blocked|unavailable|closed/i;

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function parseDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value || '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function unescapeText(value) {
  return value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
}

function parseEvents(text) {
  const events = [];
  let current = null;
  for (const line of unfold(text).split('\n')) {
    if (line === 'BEGIN:VEVENT') { current = {}; continue; }
    if (line === 'END:VEVENT') { if (current) events.push(current); current = null; continue; }
    if (!current) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const name = line.slice(0, idx).split(';')[0].toUpperCase();
    const value = line.slice(idx + 1);
    if (name === 'UID') current.uid = value.trim();
    else if (name === 'DTSTART') current.start = parseDate(value);
    else if (name === 'DTEND') current.end = parseDate(value);
    else if (name === 'SUMMARY') current.summary = unescapeText(value);
    else if (name === 'STATUS') current.status = value.trim().toUpperCase();
  }
  return events;
}

// Returns the reservations in a feed as { uid, check_in, check_out, summary }.
function parseReservations(text) {
  return parseEvents(text)
    .filter((e) => e.uid && e.start && e.end && e.end > e.start)
    .filter((e) => e.status !== 'CANCELLED' && !BLOCKED.test(e.summary || ''))
    .map((e) => ({ uid: e.uid, check_in: e.start, check_out: e.end, summary: e.summary || 'Reserved' }));
}

module.exports = { parseReservations };
