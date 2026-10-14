// Витрина: каталог, тарифы и расчёт доставки, интервалы, «Мои заказы»
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const testHelpers = require('../../test-helpers');

const BUYER_ID = 7392580260; // настоящие id Telegram бывают длиннее 32 бит
const OTHER_BUYER_ID = 7102;
let shop;

before(async () => { shop = await testHelpers.start(); });

test('каталог: только то, что в наличии, размеры — массивом, фото из папки проекта', async () => {
  await shop.database.product.update({ where: { id: 2 }, data: { in_stock: 0 } });
  await shop.database.product.update({ where: { id: 4 }, data: { stock: 0 } });
  const response = await shop.call(null, 'GET', '/api/products');
  assert.equal(response.status, 200);
  const productIds = response.body.map((product) => product.id);
  assert.ok(!productIds.includes(2) && !productIds.includes(4), 'скрытый и закончившийся не показываем');
  assert.equal(response.body.length, 17);
  const provence = response.body.find((product) => product.name === 'Утро в Провансе');
  assert.deepEqual(provence.sizes.map((size) => [size.name, size.price]), [['S', 2490], ['M', 3490], ['L', 4990]]);
  assert.equal(provence.photo_url, '/photos/1-utro-v-provanse.jpg');
  assert.deepEqual(response.body.slice(-5).map((product) => product.addon), [1, 1, 1, 1, 1], 'допы в конце (sort 200+)');
  await shop.database.product.updateMany({ where: { id: { in: [2, 4] } }, data: { in_stock: 1, stock: null } });
});

test('тарифы доставки и признак онлайн-оплаты', async () => {
  const response = await shop.call(null, 'GET', '/api/delivery-info');
  assert.deepEqual(Object.keys(response.body), ['shop', 'city', 'region', 'freeFrom', 'payOnline']);
  assert.equal(response.body.shop, 'пл. Восстания');
  assert.equal(response.body.city[0].price, 290);
  assert.equal(response.body.payOnline, true);
});

test('расчёт доставки: город по зонам, Ленобласть за километры, бесплатно от суммы, чужой регион и ненайденный адрес', async () => {
  const quote = (body) => shop.call(BUYER_ID, 'POST', '/api/delivery-quote', body);
  const nevsky = await quote({ address: 'Невский проспект, 1', zone: 'city' });
  assert.equal(nevsky.status, 200);
  assert.equal(nevsky.body.fee, 290);
  assert.equal(nevsky.body.zone, 'Санкт-Петербург');
  assert.ok(nevsky.body.km > 1 && nevsky.body.km < 3, `${nevsky.body.km} км`);

  const gatchina = await quote({ address: 'Гатчина, ул. Мира, 2', zone: 'region' });
  assert.equal(gatchina.body.zone, 'Ленобласть');
  assert.equal(gatchina.body.fee, 990 + Math.ceil(gatchina.body.km - 20) * 40);

  await shop.call(testHelpers.OWNER_ID, 'PUT', '/api/admin/delivery', { city: [{ km: 3, price: 290 }, { km: 999, price: 890 }], region: { base: 990, perKm: 40, fromKm: 20 }, freeFrom: 5000 });
  const free = await quote({ address: 'Невский проспект, 1', items: [{ id: 2, qty: 1 }] }); // 7 990 ₽ ≥ 5 000 ₽
  assert.equal(free.body.fee, 0);
  assert.equal(free.body.fullFee, 290);
  assert.equal(free.body.free, true);

  assert.match((await quote({ address: 'Псков, ул. Ленина' })).body.error, /только по Санкт-Петербургу/);
  assert.match((await quote({ address: 'Несуществующая улица 999' })).body.error, /Не нашли такой адрес/);
  assert.deepEqual((await quote({ address: 'ab' })).body, { error: 'Введите адрес' });
  assert.equal((await shop.call(null, 'POST', '/api/delivery-quote', { address: 'Невский проспект, 1' })).status, 401);
});

test('геокодер не отвечает — доставку уточним после заказа', async () => {
  testHelpers.geocoder.down = true;
  const response = await shop.call(BUYER_ID, 'POST', '/api/delivery-quote', { address: 'Комендантский проспект, 5' });
  testHelpers.geocoder.down = false;
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, fee: null, error: 'Не получилось рассчитать доставку — уточним после заказа' });
});

test('интервалы: выходной день закрыт, лимит заказов на интервал', async () => {
  const date = testHelpers.tomorrowInMoscow();
  await shop.call(testHelpers.OWNER_ID, 'PUT', '/api/admin/calendar', { closed: ['2026-12-31'], slotLimit: 1 });
  const closedDay = await shop.call(null, 'GET', '/api/slots?date=2026-12-31');
  assert.equal(closedDay.body.closed, true);
  assert.ok(closedDay.body.slots.every((slot) => !slot.available));
  assert.equal((await shop.placeOrder(BUYER_ID, [[3, 1, 'S']], { delivery_time: '18:00–21:00' })).status, 200);
  const day = await shop.call(null, 'GET', `/api/slots?date=${date}`);
  assert.deepEqual(day.body.slots.find((slot) => slot.time === '18:00–21:00'), { time: '18:00–21:00', available: false, left: 0 });
  assert.deepEqual(day.body.slots.find((slot) => slot.time === '09:00–12:00'), { time: '09:00–12:00', available: true, left: 1 });
  assert.deepEqual((await shop.call(null, 'GET', '/api/slots?date=завтра')).body, { error: 'Неверная дата' });
  await shop.call(testHelpers.OWNER_ID, 'PUT', '/api/admin/calendar', { closed: [], slotLimit: 0 });
});

test('«Мои заказы»: только свои, ссылка на оплату — пока заказ не оплачен; повтор заказа', async () => {
  const myOrders = await shop.call(BUYER_ID, 'GET', '/api/my-orders');
  assert.equal(myOrders.status, 200);
  const [order] = myOrders.body;
  assert.deepEqual(Object.keys(order), ['id', 'status', 'status_label', 'items', 'total', 'delivery_fee', 'when', 'address', 'card_text', 'recipient',
    'rating', 'payment_status', 'pay_url', 'photo_status']);
  assert.equal(order.status_label, 'Новый');
  assert.equal(order.payment_status, 'pending');
  assert.match(order.pay_url, /^https:\/\/pay\.test\//);
  assert.match(order.when, /^Завтра, 18–21$/);
  assert.deepEqual((await shop.call(OTHER_BUYER_ID, 'GET', '/api/my-orders')).body, []);

  const repeat = await shop.call(BUYER_ID, 'GET', `/api/my-orders/${order.id}`);
  assert.deepEqual(repeat.body, { id: order.id, items: [{ id: 3, qty: 1, size: 'S' }], address: 'Невский проспект, 1', zone: 'city', recipient: null });
  assert.equal((await shop.call(OTHER_BUYER_ID, 'GET', `/api/my-orders/${order.id}`)).status, 404);
});
