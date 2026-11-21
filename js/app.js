/* Booking page. Reads shop.json in this folder and keeps the diary in localStorage. */
(function () {
  'use strict';

  var core = window.BookingCore;
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function h(tag, props, children) {
    var node = document.createElement(tag);
    var key;
    props = props || {};
    for (key in props) {
      if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
      var value = props[key];
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'value') node.value = value;
      else if (key === 'disabled') node.disabled = true;
      else if (key === 'selected') node.selected = true;
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    append(node, children || []);
    return node;
  }

  function append(node, children) {
    var i;
    for (i = 0; i < children.length; i += 1) {
      var child = children[i];
      if (child == null || child === false) continue;
      if (Array.isArray(child)) append(node, child);
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
  }

  function diaryKey(id) { return 'lsb.diary.' + id; }
  function deskKey(id) { return 'lsb.desk.' + id; }

  function readDiary(shopId) {
    try {
      var raw = localStorage.getItem(diaryKey(shopId));
      var parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (row) {
        return row && typeof row.id === 'string' && core.isIsoDate(row.date) && core.timeToMinutes(row.start) != null && Number(row.durationMinutes) > 0;
      });
    } catch (err) {
      return [];
    }
  }

  function writeDiary(shopId, rows) {
    localStorage.setItem(diaryKey(shopId), JSON.stringify(rows));
  }

  function newId() {
    return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function scrollToId(id) {
    var node = document.getElementById(id);
    if (!node) return;
    node.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  function applyTheme(theme) {
    if (!theme) return;
    var map = {
      background: '--bg',
      surface: '--surface',
      ink: '--ink',
      muted: '--muted',
      accent: '--accent',
      accentInk: '--accent-ink',
      line: '--line'
    };
    Object.keys(map).forEach(function (key) {
      if (theme[key]) document.documentElement.style.setProperty(map[key], theme[key]);
    });
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && theme.accent) meta.setAttribute('content', theme.accent);
  }

  function ShopPage(root, config) {
    this.root = root;
    this.config = config;
    this.diary = readDiary(config.id);
    this.view = location.hash === '#desk' ? 'desk' : 'book';
    this.unlocked = false;
    try { this.unlocked = sessionStorage.getItem(deskKey(config.id)) === 'yes'; } catch (err) { this.unlocked = false; }
    this.selected = {
      serviceId: null,
      staffId: config.staff && config.staff.length ? 'any' : '',
      date: null,
      start: null,
      name: '',
      phone: ''
    };
    this.done = false;
    this.savedLocally = false;
    this.lastBookingId = null;
    this.formError = '';
    this.pinDraft = '';
    this.pinError = '';
    this.keepScroll = true;
    var firstStaff = config.staff && config.staff[0] ? config.staff[0].id : '';
    this.desk = {
      serviceId: config.services[0].id,
      staffId: firstStaff,
      date: core.lusakaParts(new Date()).date,
      start: '',
      name: '',
      phone: '',
      blockStart: '',
      blockMinutes: '60',
      blockStaffId: '',
      blockNote: '',
      message: ''
    };
  }

  ShopPage.prototype.serviceById = function (id) {
    var i;
    for (i = 0; i < this.config.services.length; i += 1) {
      if (this.config.services[i].id === id) return this.config.services[i];
    }
    return null;
  };

  ShopPage.prototype.staffById = function (id) {
    var staff = this.config.staff || [];
    var i;
    for (i = 0; i < staff.length; i += 1) {
      if (staff[i].id === id) return staff[i];
    }
    return null;
  };

  ShopPage.prototype.freeSlots = function (service, date, staffId, hidePast) {
    if (!service || !date) return [];
    var now = core.lusakaParts(new Date());
    return core.getFreeSlots({
      date: date,
      durationMinutes: service.durationMinutes,
      slotMinutes: this.config.slotMinutes,
      hours: this.config.hours,
      blockedDates: this.config.blockedDates || [],
      bookings: this.diary,
      staff: this.config.staff || [],
      staffId: staffId || null,
      today: hidePast ? now.date : null,
      nowMinutes: hidePast ? now.minutes : null
    });
  };

  ShopPage.prototype.customerSlots = function () {
    var staffId = this.selected.staffId === 'any' ? null : this.selected.staffId;
    return this.freeSlots(this.serviceById(this.selected.serviceId), this.selected.date, staffId, true);
  };

  ShopPage.prototype.chosenSlot = function () {
    var slots = this.customerSlots();
    var i;
    for (i = 0; i < slots.length; i += 1) {
      if (slots[i].start === this.selected.start) return slots[i];
    }
    return null;
  };

  ShopPage.prototype.assignedStaff = function (slot) {
    var staff = this.config.staff || [];
    if (!staff.length || !slot) return null;
    var id = this.selected.staffId;
    if (!id || id === 'any') id = slot.staffIds && slot.staffIds[0];
    return this.staffById(id);
  };

  ShopPage.prototype.readyDraft = function () {
    var service = this.serviceById(this.selected.serviceId);
    var slot = this.chosenSlot();
    var name = this.selected.name.trim();
    var phone = this.selected.phone.trim();
    if (!service || !slot || name.length < 2 || phone.replace(/\D/g, '').length < 9) return null;
    var staff = this.assignedStaff(slot);
    var staffName = '';
    if (staff) {
      staffName = this.selected.staffId === 'any' ? staff.name + ' (no preference, first free)' : staff.name;
    }
    return core.buildWhatsAppLink({
      whatsapp: this.config.whatsapp,
      shopName: this.config.name,
      customerName: name,
      customerPhone: phone,
      serviceName: service.name,
      durationMinutes: service.durationMinutes,
      priceZmw: service.priceZmw,
      staffName: staffName,
      staffLabel: this.config.staffLabel,
      dateLabel: core.formatDateLabel(this.selected.date),
      timeLabel: slot.start + '–' + slot.end,
      deposit: this.config.deposit || null
    });
  };

  ShopPage.prototype.persist = function (rows) {
    writeDiary(this.config.id, rows);
    this.diary = rows;
  };

  ShopPage.prototype.saveCustomer = function () {
    var service = this.serviceById(this.selected.serviceId);
    var slot = this.chosenSlot();
    var staff = this.assignedStaff(slot);
    var row = {
      id: newId(),
      date: this.selected.date,
      start: slot.start,
      durationMinutes: service.durationMinutes,
      serviceId: service.id,
      serviceName: service.name,
      priceZmw: service.priceZmw,
      staffId: staff ? staff.id : '',
      staffName: staff ? staff.name : '',
      customerName: this.selected.name.trim(),
      customerPhone: this.selected.phone.trim(),
      status: 'requested',
      notes: this.selected.staffId === 'any' ? 'No preference' : '',
      source: 'customer',
      createdAt: new Date().toISOString()
    };
    this.persist(this.diary.concat([row]));
    this.lastBookingId = row.id;
    this.savedLocally = true;
  };

  ShopPage.prototype.render = function () {
    var y = this.keepScroll ? window.scrollY : 0;
    this.keepScroll = true;
    var view = this.view === 'desk' ? this.renderDesk() : this.renderBook();
    while (this.root.firstChild) this.root.removeChild(this.root.firstChild);
    this.root.appendChild(view);
    window.scrollTo(0, y);
  };

  ShopPage.prototype.renderBook = function () {
    var config = this.config;
    var now = core.lusakaParts(new Date());
    var todayKind = core.explainDay(now.date, config.hours, config.blockedDates || []);
    var todayHours = config.hours[core.weekdayKey(now.date)];
    var openLine = todayKind === 'open'
      ? 'Open today ' + todayHours.open + '–' + todayHours.close
      : (todayKind === 'blocked' ? 'Not taking bookings today' : 'Closed today');

    return h('div', {}, [
      h('header', { class: 'masthead' }, [
        h('p', { class: 'kicker', text: config.area || 'Lusaka' }),
        h('h1', { text: config.name }),
        config.tagline ? h('p', { text: config.tagline }) : null,
        h('p', { class: 'meta', text: openLine })
      ]),
      h('div', { class: 'sheet' }, [
        this.photos(),
        this.done ? this.renderDone() : this.renderSteps(),
        this.hoursFold(),
        h('p', { class: 'footer' }, [
          h('a', { href: '#desk', text: 'Shop desk' }),
          ' · for the owner of this shop. ',
          h('a', { href: 'https://github.com/MKBright', text: 'Booking page by MKBright' })
        ])
      ])
    ]);
  };

  ShopPage.prototype.photos = function () {
    var photos = this.config.photos || [];
    if (!photos.length) return null;
    return h('div', { class: 'photos' }, photos.map(function (photo, index) {
      var props = { src: photo.src, alt: photo.alt || '', width: '320', height: '180', decoding: 'async' };
      if (index > 0) props.loading = 'lazy';
      return h('img', props);
    }));
  };

  ShopPage.prototype.hoursFold = function () {
    var config = this.config;
    var labels = [
      ['monday', 'Mon'], ['tuesday', 'Tue'], ['wednesday', 'Wed'], ['thursday', 'Thu'],
      ['friday', 'Fri'], ['saturday', 'Sat'], ['sunday', 'Sun']
    ];
    return h('details', { class: 'block' }, [
      h('summary', { text: 'Address and opening hours' }),
      config.address ? h('p', { text: config.address }) : null,
      h('dl', { class: 'hours' }, labels.map(function (pair) {
        var day = config.hours[pair[0]];
        return [
          h('dt', { text: pair[1] }),
          h('dd', { text: day ? day.open + '–' + day.close : 'Closed' })
        ];
      }))
    ]);
  };

  ShopPage.prototype.renderSteps = function () {
    var service = this.serviceById(this.selected.serviceId);
    return h('div', {}, [
      this.serviceSection(),
      service && (this.config.staff || []).length ? this.staffSection() : null,
      service ? this.dateSection() : null,
      service && this.selected.date ? this.timeSection() : null,
      service && this.chosenSlot() ? this.detailsSection() : null,
      this.formError ? h('p', { class: 'form-error', role: 'alert', text: this.formError }) : null
    ]);
  };

  ShopPage.prototype.serviceSection = function () {
    var page = this;
    return h('section', { class: 'block', id: 'services' }, [
      h('p', { class: 'kicker', text: 'Step 1' }),
      h('h2', { text: 'Choose a service' }),
      h('div', { class: 'choice-list' }, this.config.services.map(function (service) {
        var pressed = page.selected.serviceId === service.id;
        var meta = service.durationMinutes + ' min';
        if (service.description) meta += ' · ' + service.description;
        return h('button', {
          type: 'button',
          class: 'choice',
          'data-action': 'pick-service',
          'data-id': service.id,
          'aria-pressed': pressed ? 'true' : 'false'
        }, [
          h('span', { class: 'choice-main' }, [
            h('span', { class: 'choice-name', text: service.name }),
            h('span', { class: 'choice-meta', text: meta })
          ]),
          h('span', { class: 'choice-price', text: core.formatKwacha(service.priceZmw) })
        ]);
      }))
    ]);
  };

  ShopPage.prototype.staffSection = function () {
    var page = this;
    var label = this.config.staffLabel || 'Staff';
    var options = [{ id: 'any', name: 'No preference' }].concat(this.config.staff);
    return h('section', { class: 'block', id: 'staff' }, [
      h('p', { class: 'kicker', text: 'Step 2' }),
      h('h2', { text: 'Choose a ' + label.toLowerCase() }),
      h('div', { class: 'chips' }, options.map(function (person) {
        return h('button', {
          type: 'button',
          class: 'chip',
          'data-action': 'pick-staff',
          'data-id': person.id,
          'aria-pressed': page.selected.staffId === person.id ? 'true' : 'false',
          text: person.name
        });
      }))
    ]);
  };

  ShopPage.prototype.dateSection = function () {
    var page = this;
    var today = core.lusakaParts(new Date()).date;
    var count = this.config.bookingWindowDays || 21;
    var buttons = [];
    var i;
    for (i = 0; i < count; i += 1) {
      var date = core.addDays(today, i);
      var kind = core.explainDay(date, this.config.hours, this.config.blockedDates || []);
      var parts = date.split('-').map(Number);
      var weekday = WEEKDAYS[new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay()];
      var sub = kind === 'blocked' ? 'Blocked' : (kind === 'closed' ? 'Closed' : (date === today ? 'Today' : MONTHS[parts[1] - 1]));
      buttons.push(h('button', {
        type: 'button',
        class: 'date-btn',
        'data-action': kind === 'open' ? 'pick-date' : '',
        'data-date': date,
        'aria-pressed': page.selected.date === date ? 'true' : 'false',
        'aria-label': core.formatDateLabel(date) + (kind === 'open' ? '' : ', ' + sub),
        disabled: kind === 'open' ? false : true
      }, [
        h('small', { text: weekday }),
        h('strong', { text: String(parts[2]) }),
        h('small', { text: sub })
      ]));
    }
    var step = (this.config.staff || []).length ? 'Step 3' : 'Step 2';
    return h('section', { class: 'block', id: 'dates' }, [
      h('p', { class: 'kicker', text: step }),
      h('h2', { text: 'Choose a date' }),
      h('div', { class: 'date-strip' }, buttons)
    ]);
  };

  ShopPage.prototype.timeSection = function () {
    var page = this;
    var kind = core.explainDay(this.selected.date, this.config.hours, this.config.blockedDates || []);
    var slots = this.customerSlots();
    var body;
    if (kind === 'blocked') body = h('p', { class: 'fine', text: 'The shop is not taking bookings on this date.' });
    else if (kind === 'closed') body = h('p', { class: 'fine', text: 'The shop is closed on this date.' });
    else if (!slots.length) body = h('p', { class: 'fine', text: 'No free time left on this date. Try another day.' });
    else {
      body = h('div', { class: 'slots', role: 'group', 'aria-label': 'Free times' }, slots.map(function (slot) {
        return h('button', {
          type: 'button',
          class: 'slot',
          'data-action': 'pick-slot',
          'data-start': slot.start,
          'aria-pressed': page.selected.start === slot.start ? 'true' : 'false',
          'aria-label': slot.start + ' to ' + slot.end,
          text: slot.start
        });
      }));
    }
    var step = (this.config.staff || []).length ? 'Step 4' : 'Step 3';
    return h('section', { class: 'block', id: 'times' }, [
      h('p', { class: 'kicker', text: step }),
      h('h2', { text: 'Free times' }),
      h('p', { class: 'fine', text: core.formatDateLabel(this.selected.date) }),
      body
    ]);
  };

  ShopPage.prototype.detailsSection = function () {
    var draft = this.readyDraft();
    var slot = this.chosenSlot();
    var service = this.serviceById(this.selected.serviceId);
    var step = (this.config.staff || []).length ? 'Step 5' : 'Step 4';
    return h('section', { class: 'block', id: 'details' }, [
      h('p', { class: 'kicker', text: step }),
      h('h2', { text: 'Your details' }),
      h('p', { class: 'fine', text: service.name + ' · ' + core.formatDateLabel(this.selected.date) + ' · ' + slot.start + '–' + slot.end + ' · ' + core.formatKwacha(service.priceZmw) }),
      h('label', { for: 'customer-name', text: 'Name' }),
      h('input', { id: 'customer-name', name: 'name', autocomplete: 'name', value: this.selected.name, placeholder: 'Tandiwe Phiri' }),
      h('label', { for: 'customer-phone', text: 'Phone' }),
      h('input', { id: 'customer-phone', name: 'phone', type: 'tel', inputmode: 'tel', autocomplete: 'tel', value: this.selected.phone, placeholder: '0971 234 567' }),
      this.depositBox(),
      h('p', { class: 'kicker', text: 'WhatsApp message' }),
      h('pre', { class: 'preview', id: 'message-preview', 'aria-live': 'polite', text: draft ? draft.text : 'Add your name and phone to prepare the WhatsApp message.' }),
      h('a', {
        class: 'btn btn-full',
        id: 'send-link',
        href: draft ? draft.url : null,
        target: '_blank',
        rel: 'noopener',
        'data-action': 'send',
        'aria-disabled': draft ? 'false' : 'true',
        text: 'Send booking on WhatsApp'
      }),
      h('p', { class: 'fine', id: 'send-hint', text: draft
        ? 'Opens wa.me/' + draft.phone + '. The message is not sent until you press send in WhatsApp.'
        : 'Add your name and phone, then this opens a wa.me chat with the shop.' }),
      h('p', { class: 'fine', text: 'The shop confirms the time in the chat. This phone can remember the request, and the shop marks the same time on the shop phone.' })
    ]);
  };

  ShopPage.prototype.depositBox = function () {
    var deposit = this.config.deposit;
    if (!deposit || (!deposit.momo && !deposit.airtel)) return null;
    var amount = deposit.amountZmw != null && deposit.amountZmw !== '' ? core.formatKwacha(deposit.amountZmw) : '';
    return h('div', { class: 'deposit' }, [
      h('h3', { text: amount ? 'Optional deposit ' + amount : 'Optional deposit' }),
      h('p', { text: deposit.note || 'Pay the shop yourself if you want the time held.' }),
      deposit.momo ? h('p', { class: 'number', text: 'MTN MoMo ' + deposit.momo }) : null,
      deposit.airtel ? h('p', { class: 'number', text: 'Airtel Money ' + deposit.airtel }) : null,
      h('p', { class: 'fine', text: 'These are numbers to type into your own mobile-money app. This page does not take payment.' })
    ]);
  };

  ShopPage.prototype.renderDone = function () {
    var service = this.serviceById(this.selected.serviceId);
    var slot = { start: this.selected.start, end: core.endTime(this.selected.start, service.durationMinutes) };
    var draft = this.lastDraft;
    return h('section', { class: 'block' }, [
      h('p', { class: 'kicker', text: 'Almost done' }),
      h('h2', { text: 'Send the WhatsApp message' }),
      h('p', { text: service.name + ' on ' + core.formatDateLabel(this.selected.date) + ' at ' + slot.start + '–' + slot.end + '.' }),
      h('p', { text: this.savedLocally
        ? 'The request is saved in this browser. If this is your own phone, the shop still needs the WhatsApp message before the time is held for you.'
        : 'This browser did not store the request. The WhatsApp message is the booking.' }),
      draft ? h('a', { class: 'btn btn-full', href: draft.url, target: '_blank', rel: 'noopener', text: 'Open WhatsApp again' }) : null,
      h('div', { class: 'btn-row' }, [
        h('button', { type: 'button', class: 'btn-ghost', 'data-action': 'reset', text: 'Book another time' }),
        this.savedLocally ? h('button', { type: 'button', class: 'btn-ghost', 'data-action': 'release', text: 'Release this time on this phone' }) : null
      ])
    ]);
  };

  ShopPage.prototype.renderDesk = function () {
    if (!this.unlocked) return this.renderLock();
    var page = this;
    var today = core.lusakaParts(new Date()).date;
    var upcoming = this.diary.filter(function (row) {
      return row.status !== 'cancelled' && row.date >= today;
    }).sort(function (a, b) {
      return (a.date + a.start).localeCompare(b.date + b.start);
    }).slice(0, 12);

    return h('div', {}, [
      h('header', { class: 'masthead' }, [
        h('p', { class: 'kicker', text: 'Shop desk' }),
        h('h1', { text: this.config.name }),
        h('p', { text: 'Diary on this phone' })
      ]),
      h('div', { class: 'sheet' }, [
        h('div', { class: 'note' }, [
          h('strong', { text: 'Basic PIN, not a login' }),
          h('p', { text: 'The PIN lives in shop.json and is checked only by this page. Anyone who can read that file can see it. Bookings live in localStorage on this device. A customer on another phone has a separate, empty diary until you add a backend. WhatsApp is the inbox. Mark each confirmed time here so this phone stops offering it.' })
        ]),
        h('section', { class: 'block' }, [
          h('h2', { text: 'Coming up' }),
          upcoming.length ? upcoming.map(function (row) { return page.entryCard(row); }) : h('p', { class: 'fine', text: 'Nothing stored on this phone yet. When a customer messages you, add the slot here.' }),
          h('div', { class: 'btn-row' }, [
            h('button', { type: 'button', class: 'btn', 'data-action': 'export', text: 'Export CSV' }),
            h('button', { type: 'button', class: 'btn-ghost', 'data-action': 'lock', text: 'Lock desk' })
          ])
        ]),
        this.deskEditor(),
        this.desk.message ? h('p', { class: 'fine', role: 'status', text: this.desk.message }) : null,
        h('p', { class: 'footer' }, [
          h('a', { href: '#book', text: 'Back to the booking page' })
        ])
      ])
    ]);
  };

  ShopPage.prototype.entryCard = function (row) {
    var end = core.endTime(row.start, row.durationMinutes);
    var who = row.customerName || (row.status === 'blocked' ? 'Blocked' : 'Walk-in');
    return h('article', { class: 'entry' }, [
      h('span', { class: 'pill', text: row.status }),
      h('h3', { text: core.formatDateLabel(row.date) + ' · ' + row.start + '–' + end }),
      h('p', { text: (row.serviceName || 'Blocked') + (row.staffName ? ' · ' + row.staffName : '') }),
      h('p', { text: who + (row.customerPhone ? ' · ' + row.customerPhone : '') + (row.notes ? ' · ' + row.notes : '') }),
      h('div', { class: 'entry-actions' }, [
        row.status === 'requested' ? h('button', { type: 'button', class: 'btn', 'data-action': 'set-status', 'data-id': row.id, 'data-status': 'confirmed', text: 'Confirm' }) : null,
        row.status !== 'cancelled' && row.status !== 'blocked' ? h('button', { type: 'button', class: 'btn-ghost', 'data-action': 'set-status', 'data-id': row.id, 'data-status': 'cancelled', text: 'Cancel' }) : null,
        h('button', { type: 'button', class: 'btn-ghost', 'data-action': 'delete-booking', 'data-id': row.id, text: 'Remove' })
      ])
    ]);
  };

  ShopPage.prototype.dayKind = function () {
    return core.explainDay(this.desk.date, this.config.hours, this.config.blockedDates || []);
  };

  ShopPage.prototype.gridStarts = function () {
    if (this.dayKind() !== 'open') return [];
    var day = this.config.hours[core.weekdayKey(this.desk.date)];
    var open = core.timeToMinutes(day.open);
    var close = core.timeToMinutes(day.close);
    var step = Number(this.config.slotMinutes);
    var starts = [];
    var t;
    for (t = open; t < close; t += step) starts.push(core.minutesToLabel(t));
    return starts;
  };

  ShopPage.prototype.deskEditor = function () {
    var page = this;
    var kind = this.dayKind();
    var service = this.serviceById(this.desk.serviceId) || this.config.services[0];
    var slots = kind === 'open' ? this.freeSlots(service, this.desk.date, this.desk.staffId || null, false) : [];
    var starts = this.gridStarts();
    var rows = this.diary.filter(function (row) { return row.date === page.desk.date; })
      .sort(function (a, b) { return a.start.localeCompare(b.start); });

    return h('section', { class: 'block', id: 'editor' }, [
      h('h2', { text: 'Mark a time' }),
      h('label', { for: 'desk-date', text: 'Date' }),
      h('input', { id: 'desk-date', type: 'date', value: this.desk.date }),
      kind !== 'open' ? h('p', { class: 'fine', text: !core.isIsoDate(this.desk.date) ? 'Pick a date.' : (kind === 'blocked' ? 'This date is blocked in shop.json.' : 'The shop is closed on this weekday.') }) : null,
      rows.length ? h('div', {}, rows.map(function (row) { return page.entryCard(row); })) : null,
      h('label', { for: 'desk-service', text: 'Service' }),
      h('select', { id: 'desk-service' }, this.config.services.map(function (item) {
        return h('option', { value: item.id, selected: item.id === service.id ? true : null, text: item.name + ' · ' + item.durationMinutes + ' min' });
      })),
      (this.config.staff || []).length ? [
        h('label', { for: 'desk-staff', text: this.config.staffLabel || 'Staff' }),
        h('select', { id: 'desk-staff' }, this.config.staff.map(function (person) {
          return h('option', { value: person.id, selected: person.id === page.desk.staffId ? true : null, text: person.name });
        }))
      ] : null,
      h('p', { class: 'kicker', text: 'Free on this phone' }),
      slots.length ? h('div', { class: 'slots' }, slots.map(function (slot) {
        return h('button', {
          type: 'button',
          class: 'slot',
          'data-action': 'pick-desk-slot',
          'data-start': slot.start,
          'aria-pressed': page.desk.start === slot.start ? 'true' : 'false',
          text: slot.start
        });
      })) : h('p', { class: 'fine', text: kind === 'open' ? 'No free start for this service.' : 'Choose an open date to see times.' }),
      h('label', { for: 'desk-name', text: 'Customer name' }),
      h('input', { id: 'desk-name', value: this.desk.name, autocomplete: 'name', placeholder: 'Walk-in or WhatsApp name' }),
      h('label', { for: 'desk-phone', text: 'Phone' }),
      h('input', { id: 'desk-phone', value: this.desk.phone, type: 'tel', inputmode: 'tel', placeholder: '097…' }),
      h('button', { type: 'button', class: 'btn btn-full', 'data-action': 'save-booking', text: 'Mark this time booked' }),
      h('h2', { text: 'Block a time' }),
      h('label', { for: 'block-start', text: 'From' }),
      h('select', { id: 'block-start' }, starts.map(function (start) {
        return h('option', { value: start, selected: start === (page.desk.blockStart || starts[0]) ? true : null, text: start });
      })),
      h('label', { for: 'block-length', text: 'Length' }),
      h('select', { id: 'block-length' }, [
        ['30', '30 min'], ['60', '60 min'], ['90', '90 min'], ['120', '2 hours'], ['180', '3 hours'], ['rest', 'Until closing']
      ].map(function (pair) {
        return h('option', { value: pair[0], selected: pair[0] === page.desk.blockMinutes ? true : null, text: pair[1] });
      })),
      (this.config.staff || []).length ? [
        h('label', { for: 'block-staff', text: 'Who' }),
        h('select', { id: 'block-staff' }, [h('option', { value: '', selected: page.desk.blockStaffId ? null : true, text: 'Whole shop' })].concat(this.config.staff.map(function (person) {
          return h('option', { value: person.id, selected: person.id === page.desk.blockStaffId ? true : null, text: person.name });
        })))
      ] : null,
      h('label', { for: 'block-note', text: 'Note' }),
      h('input', { id: 'block-note', value: this.desk.blockNote, placeholder: 'Power cut, lunch, training' }),
      h('button', { type: 'button', class: 'btn btn-full', 'data-action': 'save-block', text: 'Block this time' })
    ]);
  };

  ShopPage.prototype.renderLock = function () {
    return h('div', {}, [
      h('header', { class: 'masthead' }, [
        h('p', { class: 'kicker', text: 'Shop desk' }),
        h('h1', { text: this.config.name })
      ]),
      h('div', { class: 'sheet' }, [
        h('div', { class: 'note' }, [
          h('strong', { text: 'This PIN is basic protection, not a secure login' }),
          h('p', { text: 'It is stored in shop.json on the site, and this page compares what you type with that value. It stops a customer who is holding the shop phone from opening the diary by accident. It does not protect the diary from someone who can read the file or the browser storage.' })
        ]),
        h('label', { for: 'pin', text: 'PIN' }),
        h('input', { id: 'pin', type: 'password', inputmode: 'numeric', autocomplete: 'off', value: this.pinDraft }),
        this.pinError ? h('p', { class: 'form-error', role: 'alert', text: this.pinError }) : null,
        h('button', { type: 'button', class: 'btn btn-full', 'data-action': 'unlock', text: 'Unlock on this phone' }),
        h('p', { class: 'footer' }, [h('a', { href: '#book', text: 'Back to the booking page' })])
      ])
    ]);
  };

  ShopPage.prototype.refreshMessage = function () {
    var preview = document.getElementById('message-preview');
    var link = document.getElementById('send-link');
    var hint = document.getElementById('send-hint');
    if (!preview || !link) return;
    var draft = this.readyDraft();
    if (!draft) {
    preview.textContent = 'Add your name and phone to prepare the WhatsApp message.';
    link.setAttribute('aria-disabled', 'true');
    link.removeAttribute('href');
    if (hint) hint.textContent = 'Add your name and phone, then this opens a wa.me chat with the shop.';
    return;
  }
  preview.textContent = draft.text;
  link.href = draft.url;
  link.setAttribute('aria-disabled', 'false');
  if (hint) hint.textContent = 'Opens wa.me/' + draft.phone + '. The message is not sent until you press send in WhatsApp.';
};

  ShopPage.prototype.onInput = function (event) {
    var el = event.target;
    if (el.id === 'customer-name') this.selected.name = el.value;
    if (el.id === 'customer-phone') this.selected.phone = el.value;
    if (el.id === 'customer-name' || el.id === 'customer-phone') this.refreshMessage();
    if (el.id === 'desk-name') this.desk.name = el.value;
    if (el.id === 'desk-phone') this.desk.phone = el.value;
    if (el.id === 'block-note') this.desk.blockNote = el.value;
    if (el.id === 'pin') this.pinDraft = el.value;
  };

  ShopPage.prototype.onChange = function (event) {
    var el = event.target;
    if (el.id === 'desk-date') {
      this.desk.date = el.value;
      this.desk.start = '';
      this.desk.blockStart = '';
      this.render();
    } else if (el.id === 'desk-service') {
      this.desk.serviceId = el.value;
      this.desk.start = '';
      this.render();
    } else if (el.id === 'desk-staff') {
      this.desk.staffId = el.value;
      this.desk.start = '';
      this.render();
    } else if (el.id === 'block-start') {
      this.desk.blockStart = el.value;
    } else if (el.id === 'block-length') {
      this.desk.blockMinutes = el.value;
    } else if (el.id === 'block-staff') {
      this.desk.blockStaffId = el.value;
    }
  };

  ShopPage.prototype.onKeydown = function (event) {
    if (event.key === 'Enter' && event.target.id === 'pin') {
      event.preventDefault();
      this.unlock();
    }
  };

  ShopPage.prototype.onClick = function (event) {
    var target = event.target && event.target.nodeType === 1 ? event.target : event.target.parentElement;
    var btn = target && target.closest ? target.closest('[data-action]') : null;
    if (!btn || !btn.getAttribute('data-action')) return;
    var action = btn.getAttribute('data-action');
    if (action === 'send') {
      this.onSend(event, btn);
      return;
    }
    if (action === 'pick-date' || action === 'pick-service' || action === 'pick-staff' || action === 'pick-slot' || action === 'pick-desk-slot') {
      event.preventDefault();
    }
    if (action === 'pick-service') {
      this.selected.serviceId = btn.getAttribute('data-id');
      this.selected.start = null;
      this.formError = '';
      this.render();
      scrollToId('dates');
    } else if (action === 'pick-staff') {
      this.selected.staffId = btn.getAttribute('data-id');
      this.selected.start = null;
      this.render();
    } else if (action === 'pick-date') {
      this.selected.date = btn.getAttribute('data-date');
      this.selected.start = null;
      this.render();
      scrollToId('times');
    } else if (action === 'pick-slot') {
      this.selected.start = btn.getAttribute('data-start');
      this.formError = '';
      this.render();
      scrollToId('details');
    } else if (action === 'pick-desk-slot') {
      this.desk.start = btn.getAttribute('data-start');
      this.desk.message = '';
      this.render();
    } else if (action === 'reset') {
      this.done = false;
      this.selected.serviceId = null;
      this.selected.date = null;
      this.selected.start = null;
      this.selected.name = '';
      this.selected.phone = '';
      this.formError = '';
      this.keepScroll = false;
      this.render();
    } else if (action === 'release') {
      var id = this.lastBookingId;
      this.persist(this.diary.map(function (row) {
        return row.id === id ? Object.assign({}, row, { status: 'cancelled' }) : row;
      }));
      this.done = false;
      this.selected.start = null;
      this.lastBookingId = null;
      this.render();
    } else if (action === 'unlock') {
      this.unlock();
    } else if (action === 'lock') {
      this.unlocked = false;
      try { sessionStorage.removeItem(deskKey(this.config.id)); } catch (err) { /* session stays locked in memory */ }
      this.keepScroll = false;
      this.render();
    } else if (action === 'export') {
      this.exportCsv();
    } else if (action === 'save-booking') {
      this.saveDeskBooking();
    } else if (action === 'save-block') {
      this.saveBlock();
    } else if (action === 'set-status') {
      this.setStatus(btn.getAttribute('data-id'), btn.getAttribute('data-status'));
    } else if (action === 'delete-booking') {
      var removeId = btn.getAttribute('data-id');
      this.persist(this.diary.filter(function (row) { return row.id !== removeId; }));
      this.desk.message = 'Removed from this phone.';
      this.render();
    }
  };

  ShopPage.prototype.onSend = function (event) {
    event.preventDefault();
    var draft = this.readyDraft();
    if (!draft) {
      this.formError = 'Add your name and a phone number with at least 9 digits.';
      this.render();
      return;
    }
    try {
      this.saveCustomer();
    } catch (err) {
      this.savedLocally = false;
      this.lastBookingId = null;
    }
    this.lastDraft = draft;
    this.done = true;
    this.formError = '';
    this.keepScroll = false;
    window.open(draft.url, '_blank', 'noopener');
    this.render();
  };

  ShopPage.prototype.unlock = function () {
    if ((this.pinDraft || '').trim() === String(this.config.ownerPin).trim()) {
      this.unlocked = true;
      this.pinError = '';
      try { sessionStorage.setItem(deskKey(this.config.id), 'yes'); } catch (err) { /* unlock lasts for this view */ }
      this.keepScroll = false;
      this.render();
    } else {
      this.pinError = 'That PIN does not match shop.json.';
      this.render();
    }
  };

  ShopPage.prototype.exportCsv = function () {
    var csv = core.bookingsToCsv(this.diary.slice().sort(function (a, b) {
      return (a.date + a.start).localeCompare(b.date + b.start);
    }));
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: this.config.id + '-bookings.csv' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  ShopPage.prototype.saveDeskBooking = function () {
    var service = this.serviceById(this.desk.serviceId);
    var slots = this.freeSlots(service, this.desk.date, this.desk.staffId || null, false);
    var slot = null;
    var i;
    for (i = 0; i < slots.length; i += 1) {
      if (slots[i].start === this.desk.start) slot = slots[i];
    }
    if (!slot) {
      this.desk.message = 'Choose a free time first.';
      this.render();
      return;
    }
    if (this.desk.name.trim().length < 2) {
      this.desk.message = 'Add the customer name.';
      this.render();
      return;
    }
    var staff = this.staffById(this.desk.staffId);
    var row = {
      id: newId(),
      date: this.desk.date,
      start: slot.start,
      durationMinutes: service.durationMinutes,
      serviceId: service.id,
      serviceName: service.name,
      priceZmw: service.priceZmw,
      staffId: staff ? staff.id : '',
      staffName: staff ? staff.name : '',
      customerName: this.desk.name.trim(),
      customerPhone: this.desk.phone.trim(),
      status: 'confirmed',
      notes: '',
      source: 'desk',
      createdAt: new Date().toISOString()
    };
    try {
      this.persist(this.diary.concat([row]));
    } catch (err) {
      this.desk.message = 'This browser blocked saving. The diary did not change.';
      this.render();
      return;
    }
    this.desk.name = '';
    this.desk.phone = '';
    this.desk.start = '';
    this.desk.message = 'Booked on this phone. That start time is now taken.';
    this.render();
  };

  ShopPage.prototype.blockMinutes = function (start) {
    if (this.desk.blockMinutes !== 'rest') return Number(this.desk.blockMinutes);
    if (this.dayKind() !== 'open') return 0;
    var day = this.config.hours[core.weekdayKey(this.desk.date)];
    return core.timeToMinutes(day.close) - core.timeToMinutes(start);
  };

  ShopPage.prototype.saveBlock = function () {
    var starts = this.gridStarts();
    var start = this.desk.blockStart || starts[0];
    if (starts.indexOf(start) === -1) start = starts[0];
    if (!start) {
      this.desk.message = 'Choose an open date to block.';
      this.render();
      return;
    }
    var minutes = this.blockMinutes(start);
    if (!minutes || minutes <= 0) {
      this.desk.message = 'That block does not fit before closing.';
      this.render();
      return;
    }
    var staff = this.staffById(this.desk.blockStaffId);
    var row = {
      id: newId(),
      date: this.desk.date,
      start: start,
      durationMinutes: minutes,
      serviceId: '',
      serviceName: 'Blocked',
      priceZmw: '',
      staffId: staff ? staff.id : '',
      staffName: staff ? staff.name : '',
      customerName: '',
      customerPhone: '',
      status: 'blocked',
      notes: this.desk.blockNote.trim(),
      source: 'desk',
      createdAt: new Date().toISOString()
    };
    try {
      this.persist(this.diary.concat([row]));
    } catch (err) {
      this.desk.message = 'This browser blocked saving. The diary did not change.';
      this.render();
      return;
    }
    this.desk.blockNote = '';
    this.desk.message = 'Blocked on this phone.';
    this.render();
  };

  ShopPage.prototype.setStatus = function (id, status) {
    this.persist(this.diary.map(function (row) {
      return row.id === id ? Object.assign({}, row, { status: status }) : row;
    }));
    this.desk.message = status === 'cancelled' ? 'Cancelled. That time is free on this phone again.' : 'Updated on this phone.';
    this.render();
  };

  ShopPage.prototype.onHash = function () {
    this.view = location.hash === '#desk' ? 'desk' : 'book';
    this.diary = readDiary(this.config.id);
    this.keepScroll = false;
    this.render();
  };

  ShopPage.prototype.start = function () {
    var page = this;
    applyTheme(this.config.theme);
    document.title = this.config.name + ' · Book';
    this.root.addEventListener('click', function (event) { page.onClick(event); });
    this.root.addEventListener('input', function (event) { page.onInput(event); });
    this.root.addEventListener('change', function (event) { page.onChange(event); });
    this.root.addEventListener('keydown', function (event) { page.onKeydown(event); });
    window.addEventListener('hashchange', function () { page.onHash(); });
    window.addEventListener('storage', function (event) {
      if (event.key === diaryKey(page.config.id)) {
        page.diary = readDiary(page.config.id);
        page.render();
      }
    });
    this.render();
  };

  function showError(root, message) {
    while (root.firstChild) root.removeChild(root.firstChild);
    root.appendChild(h('p', { class: 'banner', text: message }));
  }

  async function start() {
    var root = document.getElementById('app');
    if (!root || !core) return;
    try {
      var response = await fetch('shop.json');
      if (!response.ok) throw new Error('Could not load shop.json (' + response.status + '). Use a local server or GitHub Pages, not a file:// open.');
      var config = await response.json();
      var errors = core.validateShop(config);
      if (errors.length) throw new Error(errors.join(' '));
      new ShopPage(root, config).start();
    } catch (err) {
      showError(root, err.message || 'Could not open this shop.');
    }
  }

  start();
})();
