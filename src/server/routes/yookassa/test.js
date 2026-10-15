// Вебхук ЮKassa и проверка неоплаченных: сумма, повтор уведомления, чужие платежи, отмена, поздняя оплата
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const testHelpers = require('../../test-helpers');

const OWNER_ID = testHelpers.OWNER_ID;
let shop;
let buyerCounter = 7400;

before(async () => {
  shop = await testHelpers.start();
});

// Новый заказ с онлайн-оплатой: { order, payment }
async function orderWithPayment(items = [[2, 1]]) {
  const buyerId = ++buyerCounter;
  const response = await shop.placeOrder(buyerId, items);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return { buyerId, orderId: response.body.id, payment: testHelpers.lastPayment() };
}
const ownerNewOrderNotes = (orderId) =>
  testHelpers
    .sentTo(OWNER_ID)
    .filter((call) =>
      new RegExp(`Новый заказ!\\n💳 Оплачен онлайн[\\s\\S]*Заказ №${orderId}\\b`).test(testHelpers.textOf(call)),
    );

test('оплата засчитывается один раз: повтор уведомления ничего не дублирует', async () => {
  const { buyerId, orderId, payment } = await orderWithPayment();
  payment.status = 'succeeded';
  assert.equal((await shop.sendPaymentWebhook(payment.id)).status, 200);
  await testHelpers.settle();
  assert.equal((await shop.sendPaymentWebhook(payment.id)).status, 200);
  await testHelpers.settle();
  const order = await shop.findOrder(orderId);
  assert.equal(order.payment_status, 'paid');
  assert.ok(order.paid_at);
  assert.equal(order.status_msg_id, null, 'сообщение «Оплатить» убрано');
  assert.equal(ownerNewOrderNotes(orderId).length, 1, 'владелица получила заказ ровно один раз');
  assert.match(testHelpers.lastTextTo(buyerId), /оплачен и принят/);
  assert.ok(
    testHelpers.telegramCalls.some((call) => call.method === 'deleteMessage' && call.payload.chat_id === buyerId),
  );
});

test('сумма платежа не совпадает с заказом — оплату не засчитываем', async () => {
  const { orderId, payment } = await orderWithPayment();
  payment.status = 'succeeded';
  payment.amount = { value: '1.00', currency: 'RUB' };
  await shop.sendPaymentWebhook(payment.id);
  await testHelpers.settle();
  assert.equal((await shop.findOrder(orderId)).payment_status, 'pending');
  assert.equal(ownerNewOrderNotes(orderId).length, 0);
});

test('платёж другого бота того же магазина ЮKassa и платёж к чужому заказу не трогают наши заказы', async () => {
  const { orderId, payment } = await orderWithPayment();
  payment.status = 'succeeded';
  payment.metadata = { ...payment.metadata, app: 'radiatorbot' };
  await shop.sendPaymentWebhook(payment.id);
  await testHelpers.settle();
  assert.equal((await shop.findOrder(orderId)).payment_status, 'pending');

  const second = await orderWithPayment();
  second.payment.status = 'succeeded';
  second.payment.metadata = { order_id: String(orderId), app: 'flowerbot' }; // номер чужого заказа — id платежа не совпадёт
  second.payment.amount = { value: `${(await shop.findOrder(orderId)).total}.00`, currency: 'RUB' };
  await shop.sendPaymentWebhook(second.payment.id);
  await testHelpers.settle();
  assert.equal((await shop.findOrder(orderId)).payment_status, 'pending');
});

test('посторонние и кривые уведомления просто подтверждаются', async () => {
  const send = (body) =>
    fetch(shop.base + '/yookassa-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  assert.equal((await send({ event: 'payment.succeeded', object: { id: '../../etc/passwd' } })).status, 200);
  assert.equal((await send({})).status, 200);
  assert.equal((await send({ event: 'payment.succeeded', object: { id: 'unknown-payment' } })).status, 200);
});

test('оплата отменена — заказ отменён, цветы вернулись на склад', async () => {
  await shop.database.product.update({ where: { id: 10 }, data: { stock: 50 } });
  const { buyerId, orderId, payment } = await orderWithPayment([[10, 7]]);
  assert.equal((await shop.database.product.findUnique({ where: { id: 10 } })).stock, 43);
  payment.status = 'canceled';
  await shop.sendPaymentWebhook(payment.id, 'payment.canceled');
  await testHelpers.settle();
  const order = await shop.findOrder(orderId);
  assert.equal(order.status, 'cancelled');
  assert.equal(order.payment_status, 'canceled');
  assert.equal((await shop.database.product.findUnique({ where: { id: 10 } })).stock, 50);
  assert.match(testHelpers.lastTextTo(buyerId), /отменён: оплата не прошла/);
});

test('проверка раз в минуту: за 30 минут не оплатили — автоотмена; деньги пришли позже — заказ снова в работе', async () => {
  const { runPaymentCheck } = require('../../../schedulers');
  const { toSqliteTimestamp } = require('../../../database');
  await shop.database.product.update({ where: { id: 11 }, data: { stock: 20 } });
  const { orderId, payment } = await orderWithPayment([[11, 5]]);
  await shop.database.order.update({
    where: { id: orderId },
    data: { created_at: toSqliteTimestamp(Date.now() - 31 * 60000) },
  });
  await runPaymentCheck(shop.bot);
  let order = await shop.findOrder(orderId);
  assert.equal(order.status, 'cancelled');
  assert.equal(order.payment_status, 'expired');
  assert.equal((await shop.database.product.findUnique({ where: { id: 11 } })).stock, 20);

  payment.status = 'succeeded';
  await runPaymentCheck(shop.bot);
  order = await shop.findOrder(orderId);
  assert.equal(order.status, 'new');
  assert.equal(order.payment_status, 'paid');
  assert.equal((await shop.database.product.findUnique({ where: { id: 11 } })).stock, 15, 'цветы снова списаны');
  assert.match(testHelpers.lastTextTo(OWNER_ID), /пришла уже после автоотмены/);
});
