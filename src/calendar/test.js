// Календарь доставки: дата и час по Москве, прошедшие и несуществующие даты, «сегодня не успеем»
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const testHelpers = require('../server/test-helpers');

let calendar;
before(async () => {
  await testHelpers.start();
  calendar = require('./index');
});

// 23:30 UTC 14 октября — в Москве уже 02:30 15 октября
const LATE_EVENING_UTC = Date.parse('2026-10-14T23:30:00Z');
// 10:30 по Москве 15 октября
const MORNING_MOSCOW = Date.parse('2026-10-15T07:30:00Z');

test('дата и час — по Москве, а не по UTC сервера', () => {
  assert.equal(calendar.moscowDate(0, LATE_EVENING_UTC), '2026-10-15');
  assert.equal(calendar.moscowDate(1, LATE_EVENING_UTC), '2026-10-16');
  assert.equal(calendar.moscowHour(LATE_EVENING_UTC), 2);
});

test('прошедшая дата: «вчера» по Москве нельзя, хотя по UTC это ещё сегодня', async () => {
  assert.equal(await calendar.checkDeliverySlot('2026-10-14', '18:00–21:00', LATE_EVENING_UTC), 'Дата доставки уже прошла');
  assert.equal(await calendar.checkDeliverySlot('2026-10-15', '09:00–12:00', LATE_EVENING_UTC), null);
});

test('несуществующая дата и чужой интервал не проходят', async () => {
  assert.equal(await calendar.checkDeliverySlot('2026-02-31', '12:00–15:00', MORNING_MOSCOW), 'Выберите дату доставки');
  assert.equal(await calendar.checkDeliverySlot('31.12.2026', '12:00–15:00', MORNING_MOSCOW), 'Выберите дату доставки');
  assert.equal(await calendar.checkDeliverySlot('2026-10-20', '10:00–13:00', MORNING_MOSCOW), 'Выберите время доставки');
});

test('сегодня: интервал должен закончиться хотя бы через час', async () => {
  // 10:30 — до 12:00 ещё полтора часа, успеем; в 11:00 на «09–12» уже нет
  assert.equal(await calendar.checkDeliverySlot('2026-10-15', '09:00–12:00', MORNING_MOSCOW), null);
  const elevenInMoscow = Date.parse('2026-10-15T08:00:00Z');
  assert.match(await calendar.checkDeliverySlot('2026-10-15', '09:00–12:00', elevenInMoscow), /уже не успеем/);
  assert.equal(await calendar.checkDeliverySlot('2026-10-15', '12:00–15:00', elevenInMoscow), null);
});

test('выходной день из админки закрывает все интервалы', async () => {
  const { setSetting } = require('../settings');
  await setSetting('calendar', { closed: ['2026-10-20'], slotLimit: 0 });
  assert.match(await calendar.checkDeliverySlot('2026-10-20', '12:00–15:00', MORNING_MOSCOW), /не работаем/);
  await setSetting('calendar', calendar.DEFAULT_CALENDAR);
});
