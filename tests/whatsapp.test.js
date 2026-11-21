const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../js/booking-core.js');

const base = {
  whatsapp: '0977 000 111',
  shopName: 'Kabwata Cuts',
  customerName: 'Tandiwe Phiri',
  customerPhone: '0971 111 2233',
  serviceName: 'Skin fade',
  durationMinutes: 45,
  priceZmw: 70,
  staffName: 'Joseph Zulu',
  staffLabel: 'Barber',
  dateLabel: 'Sat 21 Nov 2026',
  timeLabel: '10:00–10:45'
};

test('local Zambian numbers and international forms become a wa.me path', () => {
  assert.equal(core.normalizeWhatsApp('0977 000 111'), '260977000111');
  assert.equal(core.normalizeWhatsApp('+260 977 000 111'), '260977000111');
  assert.equal(core.normalizeWhatsApp('00260977000111'), '260977000111');
  assert.equal(core.normalizeWhatsApp('260977000111'), '260977000111');
});

test('the link is wa.me and the message carries the booking', () => {
  const link = core.buildWhatsAppLink(base);
  const url = new URL(link.url);
  assert.equal(url.origin, 'https://wa.me');
  assert.equal(url.pathname, '/260977000111');
  assert.equal(url.searchParams.get('text'), link.text);
  assert.match(link.text, /Hello Kabwata Cuts/);
  assert.match(link.text, /Name: Tandiwe Phiri/);
  assert.match(link.text, /Phone: 0971 111 2233/);
  assert.match(link.text, /Service: Skin fade/);
  assert.match(link.text, /Duration: 45 min/);
  assert.match(link.text, /Price: K70/);
  assert.match(link.text, /Barber: Joseph Zulu/);
  assert.match(link.text, /Date: Sat 21 Nov 2026/);
  assert.match(link.text, /Time: 10:00–10:45/);
  assert.equal(link.text.includes('http'), false);
});

test('staff line is omitted when the shop has no staff, and odd spacing is flattened', () => {
  const link = core.buildWhatsAppLink(Object.assign({}, base, {
    staffName: '',
    customerName: 'Tandiwe\nPhiri'
  }));
  assert.equal(link.text.includes('Barber:'), false);
  assert.equal(link.text.includes('Staff:'), false);
  assert.match(link.text, /Name: Tandiwe Phiri/);
});

test('deposit numbers are text in the message and never a payment link', () => {
  const link = core.buildWhatsAppLink(Object.assign({}, base, {
    deposit: { amountZmw: 20, momo: '0977 000 111', airtel: '0978 000 222' }
  }));
  assert.match(link.text, /Optional deposit K20 · MTN MoMo 0977 000 111 · Airtel Money 0978 000 222/);
  assert.match(link.text, /Pay the shop directly/);
  assert.equal(link.url.includes('pay'), false);
  assert.equal(link.text.includes('momo.zm') || link.text.includes('airtel'), false);
  const decoded = decodeURIComponent(link.url.split('?text=')[1]);
  assert.equal(decoded, link.text);
});

test('a name with reserved characters is encoded once in the query', () => {
  const link = core.buildWhatsAppLink(Object.assign({}, base, {
    customerName: 'Chanda & Sons',
    deposit: null
  }));
  assert.match(link.text, /Name: Chanda & Sons/);
  assert.match(link.url, /Chanda%20%26%20Sons/);
  assert.equal(link.url.startsWith('https://wa.me/260977000111?text='), true);
});

test('missing WhatsApp number throws and kwacha amounts stay plain', () => {
  assert.throws(() => core.buildWhatsAppLink(Object.assign({}, base, { whatsapp: 'call me' })), /WhatsApp/);
  assert.equal(core.formatKwacha(80), 'K80');
  assert.equal(core.formatKwacha(80.5), 'K80.50');
});
