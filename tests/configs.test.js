const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../js/booking-core.js');

const dates = {
  monday: '2026-11-23',
  tuesday: '2026-11-24',
  wednesday: '2026-11-25',
  thursday: '2026-11-26',
  friday: '2026-11-27',
  saturday: '2026-11-21',
  sunday: '2026-11-22'
};

function load(name) {
  const file = path.join(__dirname, '..', 'shops', name, 'shop.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('both demo shops are valid single-shop configs', () => {
  for (const name of ['kabwata', 'woodlands']) {
    const shop = load(name);
    assert.deepEqual(core.validateShop(shop), []);
    assert.equal(core.normalizeWhatsApp(shop.whatsapp).startsWith('260'), true);
    assert.equal(shop.services.length > 0, true);
  }
});

test('demo services never offer a start that would finish after closing', () => {
  for (const name of ['kabwata', 'woodlands']) {
    const shop = load(name);
    for (const day of Object.keys(dates)) {
      const date = dates[day];
      for (const service of shop.services) {
        const result = core.getFreeSlots({
          date: date,
          durationMinutes: service.durationMinutes,
          slotMinutes: shop.slotMinutes,
          hours: shop.hours,
          blockedDates: shop.blockedDates,
          bookings: [],
          staff: shop.staff,
          staffId: shop.staff && shop.staff[0] ? shop.staff[0].id : null
        });
        const close = shop.hours[day] && core.timeToMinutes(shop.hours[day].close);
        for (const slot of result) {
          assert.ok(core.timeToMinutes(slot.end) <= close, name + ' ' + service.id + ' ' + date + ' ' + slot.end);
        }
        if ((shop.blockedDates || []).includes(date) || !shop.hours[day]) {
          assert.deepEqual(result, []);
        }
      }
    }
  }
});

test('Woodlands braids on a short Saturday stop at 12:00', () => {
  const shop = load('woodlands');
  const braids = shop.services.find((service) => service.id === 'knotless-braids');
  const result = core.getFreeSlots({
    date: '2026-11-21',
    durationMinutes: braids.durationMinutes,
    slotMinutes: shop.slotMinutes,
    hours: shop.hours,
    blockedDates: shop.blockedDates,
    bookings: []
  });
  assert.equal(result.at(-1).start, '12:00');
  assert.equal(result.at(-1).end, '15:00');
  assert.equal(result.some((slot) => slot.start === '12:30'), false);
});

test('Kabwata is blocked on the sample Wednesday and closed on Sunday', () => {
  const shop = load('kabwata');
  assert.deepEqual(core.getFreeSlots({
    date: '2026-11-25',
    durationMinutes: 30,
    slotMinutes: shop.slotMinutes,
    hours: shop.hours,
    blockedDates: shop.blockedDates,
    bookings: []
  }), []);
  assert.equal(core.explainDay('2026-11-22', shop.hours, shop.blockedDates), 'closed');
});

test('csv export quotes commas and neutralises formula cells', () => {
  const csv = core.bookingsToCsv([{
    date: '2026-11-21',
    start: '10:00',
    durationMinutes: 45,
    status: 'confirmed',
    serviceName: 'Skin fade',
    priceZmw: 70,
    staffName: 'Joseph Zulu',
    customerName: '=Tandiwe, Phiri',
    customerPhone: '0971112233',
    notes: 'line-up',
    source: 'desk',
    id: 'b1'
  }]);
  assert.match(csv, /^date,start,end,status,/);
  assert.match(csv, /10:00,10:45,confirmed/);
  assert.match(csv, /"'=Tandiwe, Phiri"/);
});

test('a broken config is reported in plain language', () => {
  const errors = core.validateShop({ name: 'Test', hours: { monday: { open: '18:00', close: '08:00' } } });
  assert.equal(errors.some((line) => /WhatsApp/.test(line)), true);
  assert.equal(errors.some((line) => /monday/.test(line)), true);
});
