// Оформление заказа: цены только из базы, доставка по адресу, проверки формы и календаря, остатки, онлайн-оплата
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const testHelpers = require('../../test-helpers');

const BUYER_ID = 7201;
let shop;
let buyerCounter = 7300; // лимит — 5 заказов за 10 минут на покупателя, поэтому разные покупатели

before(async () => {
  shop = await testHelpers.start();
});

const nextBuyer = () => ++buyerCounter;

test('заказ с онлайн-оплатой: цены и доставка — с сервера, платёж на полную сумму, флористу — только после оплаты', async () => {
  const response = await shop.placeOrder(
    BUYER_ID,
    [
      [1, 1, 'M'],
      [9, 11],
      [15, 1],
    ],
    {
      recipient: 'Маме',
      card_text: 'С днём рождения <3',
      total: 1, // сумма из браузера игнорируется
    },
  );
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(Object.keys(response.body), ['ok', 'id', 'pay_url', 'total']);
  const order = await shop.findOrder(response.body.id);
  assert.deepEqual(order.items, [
    { id: 1, name: 'Утро в Провансе (M)', price: 3490, qty: 1, unit: null, size: 'M' },
    { id: 9, name: 'Роза красная, 60 см', price: 190, qty: 11, unit: 'шт', size: null },
    { id: 15, name: 'Стеклянная ваза', price: 690, qty: 1, unit: null, size: null },
  ]);
  assert.equal(order.delivery_fee, 290);
  assert.equal(order.delivery_zone, 'Санкт-Петербург');
  assert.equal(order.total, 3490 + 2090 + 690 + 290);
  assert.equal(order.user_id, BUYER_ID);
  assert.equal(order.payment_status, 'pending');
  assert.equal(response.body.total, order.total);
  const payment = testHelpers.lastPayment();
  assert.equal(payment.amount.value, `${order.total}.00`);
  assert.deepEqual(payment.metadata, { order_id: String(order.id), app: 'flowerbot' });
  assert.equal(payment.body.confirmation.return_url, 'https://t.me/fleur_test_bot');
  assert.match(testHelpers.lastTextTo(BUYER_ID), /Осталось оплатить/);
  assert.match(testHelpers.lastTextTo(BUYER_ID), /С днём рождения &lt;3/, 'текст открытки экранирован');
  assert.ok(
    (await shop.findOrder(order.id)).status_msg_id > 0,
    'запомнили сообщение «Оплатить», чтобы убрать его после оплаты',
  );
  assert.ok(
    !testHelpers.sentTo(testHelpers.OWNER_ID).some((call) => /Новый заказ/.test(testHelpers.textOf(call))),
    'флористу — после оплаты',
  );
});

test('ошибки формы: пустая корзина, имя, телефон, адрес — заказ не создаётся', async () => {
  const ordersBefore = await shop.database.order.count();
  const buyerId = nextBuyer();
  assert.deepEqual((await shop.placeOrder(buyerId, [])).body, { error: 'Корзина пуста' });
  assert.deepEqual((await shop.placeOrder(buyerId, [[1, 1]], { customer_name: ' ' })).body, { error: 'Укажите имя' });
  assert.deepEqual((await shop.placeOrder(nextBuyer(), [[1, 1]], { phone: '12-34' })).body, {
    error: 'Проверьте номер телефона',
  });
  assert.deepEqual((await shop.placeOrder(nextBuyer(), [[1, 1]], { address: 'дом' })).body, {
    error: 'Укажите адрес доставки',
  });
  assert.equal(await shop.database.order.count(), ordersBefore);
});

test('без галочки согласия на обработку данных — 400 и заказ не создаётся', async () => {
  const ordersBefore = await shop.database.order.count();
  for (const consent of [undefined, false, 'true', 1]) {
    const response = await shop.placeOrder(nextBuyer(), [[2, 1]], { consent });
    assert.equal(response.status, 400, `consent: ${JSON.stringify(consent)}`);
    assert.deepEqual(response.body, { error: 'Нужно согласие на обработку персональных данных' });
  }
  assert.equal(await shop.database.order.count(), ordersBefore);
});

test('с согласием — в заказе время согласия (consent_at) в формате остальных дат', async () => {
  const response = await shop.placeOrder(nextBuyer(), [[2, 1]]);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const order = await shop.findOrder(response.body.id);
  assert.match(order.consent_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.ok(Math.abs(Date.parse(order.consent_at.replace(' ', 'T') + 'Z') - Date.now()) < 60000, order.consent_at);
});

test('владелице о новом заказе — без телефона, адреса, имени, получателя и комментария; контакты — в админке', async () => {
  const buyerId = nextBuyer();
  const response = await shop.placeOrder(buyerId, [[2, 1]], {
    customer_name: 'Ирина Петрова',
    phone: '+7 911 222-33-44',
    address: 'Невский проспект, 28, кв. 5',
    recipient: 'Ольга, +7 921 000-11-22',
    comment: 'Домофон 25, позвонить за час',
    card_text: 'С днём рождения!',
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const payment = testHelpers.lastPayment();
  payment.status = 'succeeded';
  await shop.sendPaymentWebhook(payment.id);
  await testHelpers.settle();
  const ownerCall = testHelpers
    .sentTo(testHelpers.OWNER_ID)
    .findLast((call) => /Новый заказ!/.test(testHelpers.textOf(call)));
  const ownerText = testHelpers.textOf(ownerCall);
  assert.match(ownerText, new RegExp(`Заказ №${response.body.id}`));
  for (const personalData of ['911', '222-33-44', 'Невский', 'кв. 5', 'Ирина', 'Петрова', 'Ольга', '921', 'Домофон'])
    assert.ok(!ownerText.includes(personalData), `в сообщении владелице нет «${personalData}»: ${ownerText}`);
  assert.match(ownerText, /🚚 Санкт-Петербург/);
  assert.match(ownerText, /💌 «С днём рождения!»/);
  assert.match(ownerText, new RegExp(`<a href="tg://user\\?id=${buyerId}">Покупатель в Telegram</a> @anna`));
  assert.match(ownerText, /Контакты и адрес — в админке/);
  const buttons = ownerCall.payload.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some((button) => button.web_app?.url === 'https://fleur.test/admin.html'));
  assert.ok(buttons.some((button) => button.callback_data === `reply:${buyerId}:${response.body.id}`));
  // покупателю — его собственный адрес в подтверждении можно и нужно
  assert.match(testHelpers.lastTextTo(buyerId), /Невский проспект, 28, кв\. 5/);
});

test('количество: поштучно — не меньше минимума, букетов — не больше 10, скрытые букеты не заказать', async () => {
  assert.match(
    (await shop.placeOrder(nextBuyer(), [[9, 3]])).body.error,
    /«Роза красная, 60 см»: можно заказать от 5 до 501 шт/,
  );
  assert.match(
    (
      await shop.placeOrder(nextBuyer(), [
        [1, 6, 'S'],
        [1, 5, 'L'],
      ])
    ).body.error,
    /в одном заказе до 10 шт/,
  );
  await shop.database.product.update({ where: { id: 6 }, data: { in_stock: 0 } });
  assert.match((await shop.placeOrder(nextBuyer(), [[6, 1]])).body.error, /уже нет в наличии/);
  await shop.database.product.update({ where: { id: 6 }, data: { in_stock: 1 } });
});

test('дата и интервал по Москве: прошедшая дата, несуществующая дата, чужой интервал, выходной', async () => {
  const yesterday = new Date(Date.now() + 3 * 3600e3 - 864e5).toISOString().slice(0, 10);
  assert.deepEqual((await shop.placeOrder(nextBuyer(), [[2, 1]], { delivery_date: yesterday })).body, {
    error: 'Дата доставки уже прошла',
  });
  assert.deepEqual((await shop.placeOrder(nextBuyer(), [[2, 1]], { delivery_date: '2030-02-31' })).body, {
    error: 'Выберите дату доставки',
  });
  assert.deepEqual((await shop.placeOrder(nextBuyer(), [[2, 1]], { delivery_time: '21:00–23:00' })).body, {
    error: 'Выберите время доставки',
  });
  await shop.call(testHelpers.OWNER_ID, 'PUT', '/api/admin/calendar', {
    closed: [testHelpers.tomorrowInMoscow()],
    slotLimit: 0,
  });
  assert.match((await shop.placeOrder(nextBuyer(), [[2, 1]])).body.error, /В этот день мы не работаем/);
  await shop.call(testHelpers.OWNER_ID, 'PUT', '/api/admin/calendar', { closed: [], slotLimit: 0 });
});

test('остаток списывается при заказе; последний букет — владелице «закончился»; больше остатка не продать', async () => {
  await shop.database.product.update({ where: { id: 7 }, data: { stock: 2 } });
  assert.match((await shop.placeOrder(nextBuyer(), [[7, 3]])).body.error, /осталось только 2 шт/);
  const response = await shop.placeOrder(nextBuyer(), [[7, 2]]);
  assert.equal(response.status, 200);
  assert.equal((await shop.database.product.findUnique({ where: { id: 7 } })).stock, 0);
  assert.match(testHelpers.lastTextTo(testHelpers.OWNER_ID), /«Кустовая пудровая» закончился — скрыт из витрины/);
  assert.match((await shop.placeOrder(nextBuyer(), [[7, 1]])).body.error, /осталось только 0 шт/);
});

test('адрес не в СПб и не в Ленобласти — заказ не принимаем', async () => {
  const response = await shop.placeOrder(nextBuyer(), [[2, 1]], { address: 'Псков, Октябрьский проспект' });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /Доставляем только/);
});

test('геокодер не отвечает: заказ принят без онлайн-оплаты, флористу — «уточните доставку»', async () => {
  testHelpers.geocoder.down = true;
  const buyerId = nextBuyer();
  const response = await shop.placeOrder(buyerId, [[2, 1]], { address: 'Комендантский проспект, 7' });
  testHelpers.geocoder.down = false;
  assert.deepEqual(Object.keys(response.body), ['ok', 'id']);
  const order = await shop.findOrder(response.body.id);
  assert.equal(order.delivery_fee, null);
  assert.equal(order.total, 7990);
  assert.equal(order.payment_status, null);
  assert.match(testHelpers.lastTextTo(buyerId), /Заказ №\d+ принят!/);
  assert.match(testHelpers.lastTextTo(buyerId), /Доставка — уточним/);
  assert.match(testHelpers.lastTextTo(testHelpers.OWNER_ID), /Доставка не рассчиталась/);
});

test('ЮKassa не создала платёж — заказ не теряем, флорист договорится об оплате', async () => {
  const axios = require('axios');
  const originalPost = axios.post;
  axios.post = async () => {
    throw Object.assign(new Error('boom'), { response: { status: 500, data: {} } });
  };
  const response = await shop.placeOrder(nextBuyer(), [[5, 1, 'L']]);
  axios.post = originalPost;
  assert.deepEqual(Object.keys(response.body), ['ok', 'id']);
  assert.equal((await shop.findOrder(response.body.id)).payment_status, null);
  assert.match(testHelpers.lastTextTo(testHelpers.OWNER_ID), /Онлайн-оплата не создалась/);
});

test('не больше 5 заказов за 10 минут с одного аккаунта', async () => {
  const buyerId = nextBuyer();
  const statuses = [];
  for (let attempt = 0; attempt < 6; attempt++) statuses.push((await shop.placeOrder(buyerId, [])).status);
  assert.deepEqual(statuses, [400, 400, 400, 400, 400, 429]);
});
