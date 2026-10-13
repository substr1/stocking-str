'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseReservations } = require('../server/ical');

test('parses reservations, unfolds lines and drops blocked dates', () => {
  const text = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTAMP:20261013T120000Z',
    'DTSTART;VALUE=DATE:20261020',
    'DTEND;VALUE=DATE:20261023',
    'SUMMARY:Reserved',
    'UID:1418fb94e984-abcdef@air',
    ' bnb.com',
    'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HM\\n',
    ' Phone Number (Last 4 Digits): 1234',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20261101',
    'DTEND;VALUE=DATE:20261103',
    'SUMMARY:Blocked',
    'UID:vrbo-block-1',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART:20261110',
    'DTEND:20261112',
    'SUMMARY:Reserved - Jane',
    'STATUS:CANCELLED',
    'UID:vrbo-2',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  assert.deepEqual(parseReservations(text), [
    { uid: '1418fb94e984-abcdef@airbnb.com', check_in: '2026-10-20', check_out: '2026-10-23', summary: 'Reserved' },
  ]);
});
