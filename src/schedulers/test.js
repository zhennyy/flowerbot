// Фоновые задачи: отзыв через 2 часа после доставки, фото без ответа, напоминание о поводе, утренняя сводка
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const testHelpers = require('../server/test-helpers');

const OWNER_ID = testHelpers.OWNER_ID;
const BUYER_ID = 7901;
let shop;
let orderId;
let toSqliteTimestamp;
const minutesAgo = (minutes) => toSqliteTimestamp(Date.now() - minutes * 60000);

before(async () => {
  shop = await testHelpers.start();
  ({ toSqliteTimestamp } = require('../database'));
  process.env.YOOKASSA_SHOP_ID = '';
  orderId = (await shop.placeOrder(BUYER_ID, [[3, 1, 'M']])).body.id;
});

test('отзыв спрашиваем через 2 часа после «Доставлен» и только один раз', async () => {
  const { askDueReviews } = require('../reviews');
  await shop.database.order.update({ where: { id: orderId }, data: { status: 'done', done_at: minutesAgo(60) } });
  await askDueReviews(shop.bot);
  assert.equal((await shop.findOrder(orderId)).review_asked, 0, 'час — рано');
  await shop.database.order.update({ where: { id: orderId }, data: { done_at: minutesAgo(121) } });
  await askDueReviews(shop.bot);
  await askDueReviews(shop.bot);
  const reviewRequests = testHelpers.sentTo(BUYER_ID).filter((call) => /Как вам букет/.test(testHelpers.textOf(call)));
  assert.equal(reviewRequests.length, 1);
  assert.deepEqual(reviewRequests[0].payload.reply_markup.inline_keyboard[0].map((button) => button.callback_data), [1, 2, 3, 4, 5].map((rating) => `rate:${orderId}:${rating}`));
});

test('фото без ответа: на половине срока — напоминание, по истечении — считаем одобренным', async () => {
  const { checkPhotoTimeouts } = require('../bouquet-photo');
  await shop.database.order.update({ where: { id: orderId }, data: { status: 'assembling', photo_status: 'pending', photo_sent_at: minutesAgo(16), photo_reminded: 0 } });
  await checkPhotoTimeouts(shop.bot);
  assert.match(testHelpers.lastTextTo(BUYER_ID), /Ждём ваш ответ по фото букета[\s\S]*за 14 мин/);
  assert.equal((await shop.findOrder(orderId)).photo_reminded, 1);
  await shop.database.order.update({ where: { id: orderId }, data: { photo_sent_at: minutesAgo(31) } });
  await checkPhotoTimeouts(shop.bot);
  assert.equal((await shop.findOrder(orderId)).photo_status, 'auto');
  assert.match(testHelpers.lastTextTo(OWNER_ID), /Покупатель не ответил 30 мин/);
});

test('напоминание о поводе: уходит в дневные часы и переносится на следующий год (29 февраля → 1 марта)', async () => {
  const reminders = require('./../reminders');
  assert.equal(reminders.plusOneYear('2028-02-29'), '2029-03-01');
  assert.equal(reminders.plusOneYear('2026-10-15'), '2027-10-15');
  const reminder = await shop.database.reminder.create({
    data: { user_id: BUYER_ID, order_id: orderId, occasion: '💍 Годовщина', event_date: '2026-01-04', remind_at: '2026-01-01' },
  });
  const moscowHour = new Date(Date.now() + 3 * 3600e3).getUTCHours();
  await reminders.sendDueReminders(shop.bot);
  const updated = await shop.database.reminder.findUnique({ where: { id: reminder.id } });
  if (moscowHour >= 10 && moscowHour < 21) {
    assert.deepEqual([updated.event_date, updated.remind_at], ['2027-01-04', '2027-01-01']);
    assert.match(testHelpers.lastTextTo(BUYER_ID), /🔔 Через 3 дня — 💍 годовщина \(04\.01\.2026\)!\nВ прошлый раз вы дарили: Весенний микс \(M\)/);
  } else {
    assert.deepEqual([updated.event_date, updated.remind_at], ['2026-01-04', '2026-01-01'], 'ночью не беспокоим');
  }
});

test('утренняя сводка — не раньше 9:00 по Москве и один раз в день', async () => {
  const { sendMorningSummary } = require('../summary');
  const moscowHour = new Date(Date.now() + 3 * 3600e3).getUTCHours();
  const summariesBefore = testHelpers.sentTo(OWNER_ID).filter((call) => /Доброе утро/.test(testHelpers.textOf(call))).length;
  await sendMorningSummary(shop.bot);
  await sendMorningSummary(shop.bot);
  const summaries = testHelpers.sentTo(OWNER_ID).filter((call) => /Доброе утро/.test(testHelpers.textOf(call))).length - summariesBefore;
  assert.equal(summaries, moscowHour >= 9 ? 1 : 0);
});
