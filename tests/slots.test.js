const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../js/booking-core.js');

const hours = {
  monday: { open: '08:00', close: '12:00' },
  tuesday: { open: '08:00', close: '18:00' },
  wednesday: { open: '09:00', close: '17:00' },
  thursday: { open: '08:00', close: '18:00' },
  friday: { open: '08:00', close: '18:00' },
  saturday: { open: '08:00', close: '13:00' },
  sunday: null
};

function slots(extra) {
  return core.getFreeSlots(Object.assign({
    date: '2026-11-23',
    durationMinutes: 60,
    slotMinutes: 30,
    hours: hours,
    blockedDates: [],
    bookings: []
  }, extra));
}

function starts(result) {
  return result.map((slot) => slot.start);
}

test('2026-11-21 is a Saturday and the calendar date does not shift', () => {
  assert.equal(core.weekdayKey('2026-11-21'), 'saturday');
  assert.equal(core.weekdayKey('2026-11-22'), 'sunday');
  assert.equal(core.weekdayKey('2026-11-23'), 'monday');
  assert.equal(core.formatDateLabel('2026-11-21'), 'Sat 21 Nov 2026');
});

test('Lusaka clock is two hours ahead of UTC, including across midnight', () => {
  assert.deepEqual(core.lusakaParts(new Date('2026-11-21T10:00:00Z')), {
    date: '2026-11-21',
    minutes: 12 * 60
  });
  assert.deepEqual(core.lusakaParts(new Date('2026-11-21T22:00:00Z')), {
    date: '2026-11-22',
    minutes: 0
  });
});

test('overlaps: a booking removes every start it touches and keeps the next back-to-back start', () => {
  const result = slots({
    bookings: [{ date: '2026-11-23', start: '09:00', durationMinutes: 60, status: 'confirmed' }]
  });
  assert.deepEqual(starts(result), ['08:00', '10:00', '10:30', '11:00']);
  assert.equal(result.find((slot) => slot.start === '08:00').end, '09:00');
});

test('overlaps: a booking that starts off the grid still blocks neighbouring slots', () => {
  const result = slots({
    durationMinutes: 30,
    bookings: [{ date: '2026-11-23', start: '09:15', durationMinutes: 30, status: 'blocked' }]
  });
  assert.equal(starts(result).includes('09:00'), false);
  assert.equal(starts(result).includes('09:30'), false);
  assert.equal(starts(result).includes('08:30'), true);
  assert.equal(starts(result).includes('10:00'), true);
});

test('overlaps ignore cancelled bookings and bookings on other dates', () => {
  const result = slots({
    bookings: [
      { date: '2026-11-23', start: '09:00', durationMinutes: 60, status: 'cancelled' },
      { date: '2026-11-24', start: '08:00', durationMinutes: 180, status: 'confirmed' }
    ]
  });
  assert.equal(starts(result).includes('09:00'), true);
  assert.equal(starts(result)[0], '08:00');
});

test('closing time: a slot that ends exactly at close stays, a slot that runs past close is dropped', () => {
  const exact = slots({
    date: '2026-11-24',
    durationMinutes: 90,
    hours: Object.assign({}, hours, { tuesday: { open: '16:00', close: '18:00' } })
  });
  assert.deepEqual(exact.map((slot) => [slot.start, slot.end]), [
    ['16:00', '17:30'],
    ['16:30', '18:00']
  ]);

  const pastClose = slots({
    date: '2026-11-23',
    durationMinutes: 45,
    slotMinutes: 30
  });
  assert.equal(pastClose.at(-1).start, '11:00');
  assert.equal(pastClose.at(-1).end, '11:45');
  assert.equal(starts(pastClose).includes('11:30'), false);

  const tooLong = slots({ durationMinutes: 300 });
  assert.deepEqual(tooLong, []);
});

test('blocked days return no slots even when the weekday is normally open', () => {
  assert.equal(core.explainDay('2026-11-23', hours, ['2026-11-23']), 'blocked');
  const result = slots({
    blockedDates: ['2026-11-23'],
    bookings: []
  });
  assert.deepEqual(result, []);
});

test('a closed weekday returns no slots', () => {
  assert.equal(core.explainDay('2026-11-22', hours, []), 'closed');
  const sunday = core.getFreeSlots({
    date: '2026-11-22',
    durationMinutes: 30,
    slotMinutes: 30,
    hours: hours,
    blockedDates: [],
    bookings: []
  });
  assert.deepEqual(sunday, []);
});

test('today hides starts that have already begun', () => {
  const result = slots({
    today: '2026-11-23',
    nowMinutes: 9 * 60 + 15,
    durationMinutes: 30
  });
  assert.equal(starts(result).includes('09:00'), false);
  assert.equal(starts(result).includes('09:30'), true);
});

test('staff bookings block only that person, and a shop-wide block blocks everyone', () => {
  const staff = [{ id: 'joseph' }, { id: 'peter' }];
  const bookings = [
    { date: '2026-11-23', start: '09:00', durationMinutes: 60, status: 'confirmed', staffId: 'joseph' },
    { date: '2026-11-23', start: '10:00', durationMinutes: 30, status: 'blocked', staffId: '' }
  ];
  const joseph = starts(slots({ staffId: 'joseph', staff: staff, bookings: bookings, durationMinutes: 30 }));
  const peter = starts(slots({ staffId: 'peter', staff: staff, bookings: bookings, durationMinutes: 30 }));
  const anyone = slots({ staff: staff, bookings: bookings, durationMinutes: 30 });

  assert.equal(joseph.includes('09:00'), false);
  assert.equal(joseph.includes('10:00'), false);
  assert.equal(peter.includes('09:00'), true);
  assert.equal(peter.includes('10:00'), false);
  const nine = anyone.find((slot) => slot.start === '09:00');
  assert.deepEqual(nine.staffIds, ['peter']);
  assert.equal(anyone.some((slot) => slot.start === '10:00'), false);
});

test('ranges that only touch at the endpoint do not overlap', () => {
  assert.equal(core.rangesOverlap(9 * 60, 10 * 60, 10 * 60, 11 * 60), false);
  assert.equal(core.rangesOverlap(9 * 60, 10 * 60, 9 * 60 + 30, 10 * 60 + 30), true);
});
