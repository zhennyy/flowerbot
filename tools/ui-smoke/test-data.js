// Тестовые данные магазина для проверки в браузере: фото из папки проекта, остатки «мало», заказы во всех статусах
// (оплаченные, ждущие оплаты, без расчёта доставки, с фото букета на согласовании), переписка с фото.
const fs = require('node:fs');
const path = require('node:path');
const helpers = require('../../src/server/test-helpers');

const BUYER_ID = 2002; // покупатель, от имени которого проходим витрину
const SECOND_BUYER_ID = 2003;
const THIRD_BUYER_ID = 2004;
const NEW_BUYER_ID = 2005; // без заказов — пустые «Мои заказы»
const OWNER_ID = helpers.OWNER_ID;
const DAY_MS = 24 * 3600 * 1000;
const PROJECT_PHOTOS_COUNT = 14;
const SAMPLE_PHOTO_PATH = path.join(__dirname, '..', '..', 'public', 'photos', '1-utro-v-provanse.jpg');

// Дата «N дней назад/вперёд» по Москве в формате базы — одинаковая при повторных прогонах в тот же день
const moscowDate = (dayShift) => new Date(Date.now() + 3 * 3600e3 + dayShift * DAY_MS).toISOString().slice(0, 10);

// Фото из public/photos ставятся товарам при старте сервера (без ожидания) — дожидаемся, чтобы скриншоты были одинаковыми
async function waitForProjectPhotos(shop) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const withPhotos = await shop.database.product.count({ where: { photo_url: { startsWith: '/photos/' } } });
    if (withPhotos >= PROJECT_PHOTOS_COUNT) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('фото из папки проекта не назначились товарам');
}

// Каждой «стороне» — свой адрес (сервер доверяет X-Forwarded-For с localhost): общий лимит 120 запросов в минуту
// рассчитан на одного посетителя, а проверка открывает десятки страниц подряд
const seedHeaders = { 'X-Forwarded-For': '10.1.0.1' };

async function prepareShop(shop) {
  const call = (userId, method, urlPath, body) => shop.call(userId, method, urlPath, body, seedHeaders);
  const expectOk = (response, what) => {
    if (response.status !== 200) throw new Error(`${what}: ${response.status} ${JSON.stringify(response.body)}`);
    return response.body;
  };
  const placeOrder = async (userId, items, formFields, what) => {
    const response = await call(userId, 'POST', '/api/orders', {
      items: items.map(([id, qty, size]) => ({ id, qty, size })),
      customer_name: 'Анна', phone: '+7 900 123-45-67', address: 'Невский проспект, 1',
      delivery_date: helpers.tomorrowInMoscow(), delivery_time: '12:00–15:00', delivery_zone: 'city', ...formFields,
    });
    return expectOk(response, what);
  };
  const payLastOrder = async () => {
    const payment = helpers.lastPayment();
    payment.status = 'succeeded'; // подставная ЮKassa: покупатель оплатил
    await shop.sendPaymentWebhook(payment.id);
    await helpers.settle(300);
  };
  const setStatus = async (orderId, statuses) => {
    for (const status of statuses) expectOk(await call(OWNER_ID, 'POST', `/api/admin/orders/${orderId}/status`, { status }), `статус ${status}`);
  };

  await waitForProjectPhotos(shop);
  // остатки: орхидеи — 2 (значок «осталось 2» и упор в склад), белых роз — 15
  await shop.database.product.update({ where: { id: 6 }, data: { stock: 2 } });
  await shop.database.product.update({ where: { id: 10 }, data: { stock: 15 } });

  // 1. выполнен, с оценкой и открыткой
  const doneOrder = await placeOrder(BUYER_ID, [[1, 1, 'M'], [15, 1]], { card_text: 'С днём рождения, мама!' }, 'заказ 1');
  await payLastOrder();
  await setStatus(doneOrder.id, ['confirmed', 'assembling', 'delivering', 'done']);
  await shop.database.order.update({ where: { id: doneOrder.id }, data: { rating: 5, review_text: 'Очень красиво!' } });
  // 2. ждёт оплаты
  await placeOrder(BUYER_ID, [[9, 11]], { delivery_time: '15:00–18:00' }, 'заказ 2');

  // 3. новый, оплачен, на сегодня — с получателем, открыткой и комментарием
  const todayOrder = await placeOrder(SECOND_BUYER_ID, [[2, 1], [17, 1]], {
    customer_name: 'Мария', phone: '+7 911 222-33-44', address: 'Невский проспект, 28, кв. 5',
    recipient: 'Ольга, +7 921 000-11-22', card_text: 'Люблю тебя ❤️', comment: 'Позвонить за 30 минут',
  }, 'заказ 3');
  await payLastOrder();
  await shop.database.order.update({ where: { id: todayOrder.id }, data: { delivery_date: moscowDate(0), delivery_time: '18:00–21:00' } });
  // 4. собираем, фото букета ждёт ответа покупателя
  const photoOrder = await placeOrder(SECOND_BUYER_ID, [[3, 1, 'L']], { customer_name: 'Мария', phone: '+7 911 222-33-44' }, 'заказ 4');
  await payLastOrder();
  await setStatus(photoOrder.id, ['confirmed', 'assembling']);
  const photoBase64 = 'data:image/jpeg;base64,' + fs.readFileSync(SAMPLE_PHOTO_PATH).toString('base64');
  expectOk(await call(OWNER_ID, 'POST', `/api/admin/orders/${photoOrder.id}/photo`, { full: photoBase64 }), 'фото букета');
  // 5. в пути, Ленобласть
  const regionOrder = await placeOrder(SECOND_BUYER_ID, [[11, 9]], {
    customer_name: 'Мария', phone: '+7 911 222-33-44', address: 'Гатчина, ул. Мира, 2', delivery_zone: 'region',
  }, 'заказ 5');
  await payLastOrder();
  await setStatus(regionOrder.id, ['confirmed', 'assembling', 'delivering']);

  // 6. подтверждён, послезавтра
  const confirmedOrder = await placeOrder(THIRD_BUYER_ID, [[4, 1]], { customer_name: 'Игорь', phone: '+7 931 555-66-77', delivery_date: moscowDate(2) }, 'заказ 6');
  await payLastOrder();
  await setStatus(confirmedOrder.id, ['confirmed']);
  // 7. геокодер не ответил — доставку уточнить, без онлайн-оплаты
  helpers.geocoder.down = true;
  await placeOrder(THIRD_BUYER_ID, [[7, 1]], { customer_name: 'Игорь', phone: '+7 931 555-66-77', address: 'Комендантский проспект, 5' }, 'заказ 7');
  helpers.geocoder.down = false;
  // 8. отменён
  const cancelledOrder = await placeOrder(THIRD_BUYER_ID, [[8, 1]], { customer_name: 'Игорь', phone: '+7 931 555-66-77' }, 'заказ 8');
  await payLastOrder();
  await setStatus(cancelledOrder.id, ['cancelled']);

  const at = (dayShift, time) => `${moscowDate(dayShift)} ${time}`;
  await shop.database.message.createMany({ data: [
    { user_id: SECOND_BUYER_ID, name: 'Мария', username: 'maria_flowers', direction: 'in', text: 'Здравствуйте! А можно добавить в букет эвкалипт?', is_read: 1, created_at: at(-1, '09:15:00') },
    { user_id: SECOND_BUYER_ID, direction: 'out', order_id: photoOrder.id, text: 'Да, конечно, добавим 🌿', is_read: 1, created_at: at(-1, '09:20:00') },
    { user_id: SECOND_BUYER_ID, name: 'Мария', username: 'maria_flowers', direction: 'in', photo: 'AgACAgIAAxkBAAIBPHOTO', text: 'Вот такой оттенок хочу', is_read: 0, created_at: at(0, '05:05:00') },
    { user_id: THIRD_BUYER_ID, name: 'Игорь', direction: 'in', text: 'Во сколько привезёте?', is_read: 0, created_at: at(-3, '12:40:00') },
  ] });
  // сообщение с фото букета сохранилось с текущим временем — ставим постоянное
  await shop.database.message.updateMany({ where: { photo: { startsWith: 'photo-' } }, data: { created_at: at(-2, '16:45:00') } });
  await normalizeOrders(shop);
}

// Время создания заказов — текущее; делаем его одинаковым, чтобы статистика и скриншоты сравнивались
async function normalizeOrders(shop) {
  const allOrders = await shop.database.order.findMany({ orderBy: { id: 'asc' } });
  for (const order of allOrders) {
    await shop.database.order.update({ where: { id: order.id }, data: { created_at: `${moscowDate(order.id % 4 - 6)} 0${order.id % 10}:30:00` } });
  }
}

module.exports = {
  prepareShop, normalizeOrders, moscowDate, SAMPLE_PHOTO_PATH, BUYER_ID, SECOND_BUYER_ID, THIRD_BUYER_ID, NEW_BUYER_ID, OWNER_ID,
};
