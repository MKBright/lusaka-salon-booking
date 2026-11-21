/* Shared by the booking page and by `node --test`.
   No browser APIs. Africa/Lusaka is UTC+2 all year, so dates use that fixed offset. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BookingCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var WEEKDAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  var WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var LUSAKA_OFFSET_MS = 2 * 60 * 60 * 1000;

  function isIsoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var parts = value.split('-').map(Number);
    var dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return dt.getUTCFullYear() === parts[0] && dt.getUTCMonth() === parts[1] - 1 && dt.getUTCDate() === parts[2];
  }

  function weekdayKey(isoDate) {
    var parts = isoDate.split('-').map(Number);
    var dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return WEEKDAY_KEYS[dt.getUTCDay()];
  }

  function addDays(isoDate, days) {
    var parts = isoDate.split('-').map(Number);
    var dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
    return dt.toISOString().slice(0, 10);
  }

  function formatDateLabel(isoDate) {
    var parts = isoDate.split('-').map(Number);
    var dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return WEEKDAY_SHORT[dt.getUTCDay()] + ' ' + parts[2] + ' ' + MONTH_SHORT[parts[1] - 1] + ' ' + parts[0];
  }

  function timeToMinutes(value) {
    if (typeof value !== 'string') return null;
    var match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;
    var hours = Number(match[1]);
    var mins = Number(match[2]);
    if (hours > 23 || mins > 59) return null;
    return hours * 60 + mins;
  }

  function minutesToLabel(total) {
    var hours = Math.floor(total / 60);
    var mins = total % 60;
    return String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
  }

  function endTime(startLabel, durationMinutes) {
    var start = timeToMinutes(startLabel);
    if (start == null) return null;
    return minutesToLabel(start + Number(durationMinutes));
  }

  function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && aEnd > bStart;
  }

  function lusakaParts(date) {
    var shifted = new Date(date.getTime() + LUSAKA_OFFSET_MS);
    return {
      date: shifted.toISOString().slice(0, 10),
      minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
    };
  }

  function explainDay(isoDate, hours, blockedDates) {
    if (!isIsoDate(isoDate)) return 'closed';
    if ((blockedDates || []).indexOf(isoDate) !== -1) return 'blocked';
    var day = hours ? hours[weekdayKey(isoDate)] : null;
    if (!day || !day.open || !day.close) return 'closed';
    var open = timeToMinutes(day.open);
    var close = timeToMinutes(day.close);
    if (open == null || close == null || close <= open) return 'closed';
    return 'open';
  }

  function isBusyStatus(status) {
    return status !== 'cancelled';
  }

  function appliesToStaff(booking, staffId) {
    if (!staffId) return true;
    if (!booking.staffId) return true;
    return booking.staffId === staffId;
  }

  function bookingRange(booking) {
    var start = timeToMinutes(booking.start);
    var duration = Number(booking.durationMinutes);
    if (start == null || !isFinite(duration) || duration <= 0) return null;
    return { start: start, end: start + duration };
  }

  function conflicts(bookings, start, end, staffId) {
    for (var i = 0; i < bookings.length; i += 1) {
      var booking = bookings[i];
      if (!appliesToStaff(booking, staffId)) continue;
      var range = bookingRange(booking);
      if (!range) continue;
      if (rangesOverlap(start, end, range.start, range.end)) return true;
    }
    return false;
  }

  /**
   * Free start times for one service on one calendar date.
   * A start is kept when start + duration <= closing, and the range does not
   * overlap an existing busy booking. Ranges are half-open: a booking that
   * ends at 10:00 does not block a service that starts at 10:00.
   * Pass staffId to check one person. Pass staff (and no staffId) to keep a
   * start when at least one person is free. Shop-wide bookings have no staffId
   * and block every person.
   */
  function getFreeSlots(input) {
    var date = input.date;
    var duration = Number(input.durationMinutes);
    var step = Number(input.slotMinutes);
    if (!isIsoDate(date) || !isFinite(duration) || duration <= 0 || !isFinite(step) || step <= 0) {
      return [];
    }
    if (explainDay(date, input.hours, input.blockedDates) !== 'open') return [];

    var dayHours = input.hours[weekdayKey(date)];
    var open = timeToMinutes(dayHours.open);
    var close = timeToMinutes(dayHours.close);
    var staff = Array.isArray(input.staff) ? input.staff : [];
    var staffId = input.staffId || null;
    var bookings = (input.bookings || []).filter(function (booking) {
      return booking && booking.date === date && isBusyStatus(booking.status);
    });
    var hidePast = input.today && input.date === input.today && isFinite(input.nowMinutes);
    var slots = [];

    for (var start = open; start + duration <= close; start += step) {
      if (hidePast && start <= input.nowMinutes) continue;
      var end = start + duration;
      if (staff.length && !staffId) {
        var freeIds = [];
        for (var s = 0; s < staff.length; s += 1) {
          if (!conflicts(bookings, start, end, staff[s].id)) freeIds.push(staff[s].id);
        }
        if (!freeIds.length) continue;
        slots.push({ start: minutesToLabel(start), end: minutesToLabel(end), staffIds: freeIds });
      } else if (!conflicts(bookings, start, end, staffId)) {
        var slot = { start: minutesToLabel(start), end: minutesToLabel(end) };
        if (staffId) slot.staffIds = [staffId];
        slots.push(slot);
      }
    }
    return slots;
  }

  function oneLine(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function normalizeWhatsApp(input) {
    var digits = String(input == null ? '' : input).replace(/\D/g, '');
    if (digits.indexOf('00') === 0) digits = digits.slice(2);
    if (digits.length === 10 && digits.charAt(0) === '0') digits = '260' + digits.slice(1);
    return digits;
  }

  function formatKwacha(amount) {
    var number = Number(amount);
    if (!isFinite(number)) return 'K0';
    if (Math.round(number) === number) return 'K' + number;
    return 'K' + number.toFixed(2);
  }

  /**
   * Builds a wa.me link. The deposit is plain text in the message.
   * There is no payment URL.
   */
  function buildWhatsAppLink(booking) {
    var phone = normalizeWhatsApp(booking.whatsapp);
    if (!phone) throw new Error('WhatsApp number is missing.');
    var staffName = oneLine(booking.staffName);
    var lines = [
      'Hello ' + oneLine(booking.shopName) + ', I would like to book a slot.',
      '',
      'Name: ' + oneLine(booking.customerName),
      'Phone: ' + oneLine(booking.customerPhone),
      'Service: ' + oneLine(booking.serviceName),
      'Duration: ' + Number(booking.durationMinutes) + ' min',
      'Price: ' + formatKwacha(booking.priceZmw)
    ];
    if (staffName) lines.push((oneLine(booking.staffLabel) || 'Staff') + ': ' + staffName);
    lines.push('Date: ' + oneLine(booking.dateLabel), 'Time: ' + oneLine(booking.timeLabel));
    var deposit = booking.deposit;
    if (deposit && (oneLine(deposit.momo) || oneLine(deposit.airtel))) {
      var depositBits = [];
      if (deposit.amountZmw != null && deposit.amountZmw !== '') {
        depositBits.push(formatKwacha(deposit.amountZmw));
      }
      if (oneLine(deposit.momo)) depositBits.push('MTN MoMo ' + oneLine(deposit.momo));
      if (oneLine(deposit.airtel)) depositBits.push('Airtel Money ' + oneLine(deposit.airtel));
      lines.push('', 'Optional deposit ' + depositBits.join(' · ') + '. Pay the shop directly if you want to hold the time.');
    }
    var text = lines.join('\n');
    return {
      phone: phone,
      text: text,
      url: 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text)
    };
  }

  function csvEscape(value) {
    var text = String(value == null ? '' : value);
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function bookingsToCsv(bookings) {
    var header = ['date', 'start', 'end', 'status', 'service', 'duration_minutes', 'price_zmw', 'staff', 'customer_name', 'customer_phone', 'notes', 'source', 'id'];
    var lines = [header.join(',')];
    (bookings || []).forEach(function (booking) {
      var end = endTime(booking.start, booking.durationMinutes) || '';
      var row = [
        booking.date,
        booking.start,
        end,
        booking.status,
        booking.serviceName,
        booking.durationMinutes,
        booking.priceZmw == null ? '' : booking.priceZmw,
        booking.staffName,
        booking.customerName,
        booking.customerPhone,
        booking.notes,
        booking.source,
        booking.id
      ].map(csvEscape);
      lines.push(row.join(','));
    });
    return lines.join('\n') + '\n';
  }

  function validateShop(config) {
    var errors = [];
    if (!config || typeof config !== 'object') return ['Shop config must be an object.'];
    if (!oneLine(config.id)) errors.push('Add an id.');
    if (!oneLine(config.name)) errors.push('Add a shop name.');
    if (!normalizeWhatsApp(config.whatsapp)) errors.push('Add a WhatsApp number.');
    if (typeof config.ownerPin !== 'string' || config.ownerPin.trim().length < 4) {
      errors.push('Add an ownerPin of at least 4 characters.');
    }
    if (!isFinite(Number(config.slotMinutes)) || Number(config.slotMinutes) <= 0) {
      errors.push('slotMinutes must be a positive number.');
    }
    var days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    if (!config.hours || typeof config.hours !== 'object') {
      errors.push('Add opening hours for each day.');
    } else {
      days.forEach(function (day) {
        if (!Object.prototype.hasOwnProperty.call(config.hours, day)) {
          errors.push('Hours are missing ' + day + '. Use null when the shop is closed.');
        } else if (config.hours[day]) {
          var open = timeToMinutes(String(config.hours[day].open || ''));
          var close = timeToMinutes(String(config.hours[day].close || ''));
          if (open == null || close == null || close <= open) errors.push(day + ' hours must look like 08:00 to 17:00.');
        }
      });
    }
    if (!Array.isArray(config.services) || !config.services.length) {
      errors.push('Add at least one service.');
    } else {
      config.services.forEach(function (service) {
        if (!service.id || !service.name) errors.push('Each service needs an id and a name.');
        if (!isFinite(Number(service.durationMinutes)) || Number(service.durationMinutes) <= 0) {
          errors.push('Service ' + (service.name || service.id || '') + ' needs a duration.');
        }
        if (!isFinite(Number(service.priceZmw)) || Number(service.priceZmw) < 0) {
          errors.push('Service ' + (service.name || service.id || '') + ' needs a price in ZMW.');
        }
      });
    }
    (config.blockedDates || []).forEach(function (date) {
      if (!isIsoDate(date)) errors.push('Blocked date ' + date + ' must be YYYY-MM-DD.');
    });
    (config.staff || []).forEach(function (person) {
      if (!person.id || !person.name) errors.push('Each staff member needs an id and a name.');
    });
    return errors;
  }

  return {
    WEEKDAY_KEYS: WEEKDAY_KEYS,
    isIsoDate: isIsoDate,
    weekdayKey: weekdayKey,
    addDays: addDays,
    formatDateLabel: formatDateLabel,
    timeToMinutes: timeToMinutes,
    minutesToLabel: minutesToLabel,
    endTime: endTime,
    rangesOverlap: rangesOverlap,
    lusakaParts: lusakaParts,
    explainDay: explainDay,
    getFreeSlots: getFreeSlots,
    normalizeWhatsApp: normalizeWhatsApp,
    formatKwacha: formatKwacha,
    buildWhatsAppLink: buildWhatsAppLink,
    bookingsToCsv: bookingsToCsv,
    validateShop: validateShop
  };
});
