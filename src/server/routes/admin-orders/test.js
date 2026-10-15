// Админка: заказы — список, смена статуса с сообщением покупателю и складом, фото букета на согласование
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const testHelpers = require('../../test-helpers');

const OWNER_ID = testHelpers.OWNER_ID;
const BUYER_ID = 7601;
let shop;
let orderId;

before(async () => {
  shop = await testHelpers.start();
  process.env.YOOKASSA_SHOP_ID = ''; // без онлайн-оплаты: заказ сразу «принят»
  await shop.database.product.update({ where: { id: 12 }, data: { stock: 30 } });
  const response = await shop.placeOrder(BUYER_ID, [
    [12, 10],
    [16, 1],
  ]);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  orderId = response.body.id;
});

test('список заказов и подписи статусов', async () => {
  const response = await shop.call(OWNER_ID, 'GET', '/api/admin/orders');
  assert.deepEqual(Object.keys(response.body), ['orders', 'statuses']);
  assert.equal(response.body.statuses.delivering, '🚚 В пути');
  const [order] = response.body.orders;
  assert.equal(order.id, orderId);
  assert.ok(Array.isArray(order.items));
  assert.equal(order.customer_name, 'Анна');
  assert.equal(order.payment_status, null);
});

test('смена статуса: покупателю — сообщение с трекером, старое сообщение о статусе удаляется', async () => {
  const confirmed = await shop.call(OWNER_ID, 'POST', `/api/admin/orders/${orderId}/status`, { status: 'confirmed' });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.status, 'confirmed');
  assert.match(testHelpers.lastTextTo(BUYER_ID), /Заказ подтверждён![\s\S]*✔︎ {2}Принят\n▸ {2}<b>Подтверждён<\/b>/);
  const firstStatusMessage = (await shop.findOrder(orderId)).status_msg_id;
  await shop.call(OWNER_ID, 'POST', `/api/admin/orders/${orderId}/status`, { status: 'assembling' });
  assert.ok(
    testHelpers.telegramCalls.some(
      (call) => call.method === 'deleteMessage' && call.payload.message_id === firstStatusMessage,
    ),
  );
  // фото букета в статусе — с витрины (полное фото вместо миниатюры)
  assert.equal(testHelpers.sentTo(BUYER_ID).at(-1).method, 'sendPhoto');
});

test('отмена возвращает цветы на склад, «отмена отмены» — снова списывает', async () => {
  assert.equal((await shop.database.product.findUnique({ where: { id: 12 } })).stock, 20);
  await shop.call(OWNER_ID, 'POST', `/api/admin/orders/${orderId}/status`, { status: 'cancelled' });
  assert.equal((await shop.database.product.findUnique({ where: { id: 12 } })).stock, 30);
  assert.match(testHelpers.lastTextTo(BUYER_ID), /Заказ отменён/);
  await shop.call(OWNER_ID, 'POST', `/api/admin/orders/${orderId}/status`, { status: 'new' });
  assert.equal((await shop.database.product.findUnique({ where: { id: 12 } })).stock, 20);
});

test('неизвестный статус (и даже «constructor») не записывается в заказ', async () => {
  for (const status of ['shipped', 'constructor', 'toString']) {
    const response = await shop.call(OWNER_ID, 'POST', `/api/admin/orders/${orderId}/status`, { status });
    assert.deepEqual(response.body, { error: 'Неизвестный статус' }, status);
  }
  assert.equal((await shop.findOrder(orderId)).status, 'new');
  assert.deepEqual((await shop.call(OWNER_ID, 'POST', '/api/admin/orders/99999/status', { status: 'done' })).body, {
    error: 'Заказ не найден',
  });
});

test('«Доставлен» запоминает время доставки один раз', async () => {
  await shop.call(OWNER_ID, 'POST', `/api/admin/orders/${orderId}/status`, { status: 'done' });
  const doneAt = (await shop.findOrder(orderId)).done_at;
  assert.match(doneAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  await shop.database.order.update({ where: { id: orderId }, data: { done_at: '2026-01-01 10:00:00' } });
  await shop.call(OWNER_ID, 'POST', `/api/admin/orders/${orderId}/status`, { status: 'done' });
  assert.equal((await shop.findOrder(orderId)).done_at, '2026-01-01 10:00:00');
});

test('фото букета из админки: покупателю с кнопками, заказ ждёт ответа', async () => {
  const jpeg =
    'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(300, 1)]).toString('base64');
  const response = await shop.call(OWNER_ID, 'POST', `/api/admin/orders/${orderId}/photo`, { full: jpeg });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.photo_status, 'pending');
  assert.match(response.body.bouquet_photo, /^photo-\d+$/);
  const photoCall = testHelpers.sentTo(BUYER_ID).at(-1);
  assert.equal(photoCall.method, 'sendPhoto');
  assert.deepEqual(
    photoCall.payload.reply_markup.inline_keyboard[0].map((button) => button.callback_data),
    [`ph:ok:${orderId}`, `ph:no:${orderId}`],
  );
  assert.deepEqual((await shop.call(OWNER_ID, 'POST', '/api/admin/orders/99999/photo', { full: jpeg })).body, {
    error: 'Заказ №99999 не найден',
  });
});
