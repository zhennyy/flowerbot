// Общая обвязка тестов (файлы test.js рядом с кодом): временная база, подставные ЮKassa, Telegram и геокодер,
// подписанные запросы витрины. Каждый test.js запускается отдельным процессом — со своей базой и портом.
const crypto = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

process.env.BOT_TOKEN = '123456:TESTTOKEN';
process.env.OWNER_ID = '1001';
process.env.WEBAPP_URL = 'https://fleur.test/';
process.env.YOOKASSA_SHOP_ID = 'shop';
process.env.YOOKASSA_SECRET_KEY = 'key';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flowerbot-'));
delete process.env.DB_PATH;
delete process.env.TELEGRAM_API_ROOT;
process.env.PORT = String(30000 + Math.floor(Math.random() * 20000));
process.env.HOST = '127.0.0.1';

const OWNER_ID = 1001;

// ---- подставная ЮKassa: запоминаем платежи, чтобы проверять суммы и метки ----
const axios = require('axios');
const payments = new Map();
let paymentCounter = 0;
axios.post = async (url, body) => {
  if (url.includes('/v3/payments')) {
    const paymentId = 'pay-' + ++paymentCounter;
    const confirmation = { type: 'redirect', confirmation_url: 'https://pay.test/' + paymentId };
    payments.set(paymentId, {
      id: paymentId,
      body,
      status: 'pending',
      metadata: body.metadata,
      amount: body.amount,
      confirmation,
    });
    return { data: { id: paymentId, confirmation } };
  }
  throw new Error('unexpected POST ' + url);
};
axios.get = async (url) => {
  const paymentMatch = url.match(/payments\/([\w-]+)$/);
  if (paymentMatch && payments.has(paymentMatch[1])) return { data: payments.get(paymentMatch[1]) };
  throw Object.assign(new Error('not found'), { response: { status: 404, data: { description: 'Платёж не найден' } } });
};
const lastPayment = () => [...payments.values()].pop();

// ---- подставной геокодер Nominatim и файлы Telegram; запросы к нашему серверу идут по-настоящему ----
// Адрес → точка на карте. Пл. Восстания — 59.9311, 30.3609.
const GEOCODER_PLACES = {
  Невский: {
    lat: '59.9343',
    lon: '30.3351',
    address: { state: 'Санкт-Петербург' },
    display_name: 'Невский проспект, 1, Санкт-Петербург, Россия',
  }, // ~1,5 км
  Комендантский: {
    lat: '60.0080',
    lon: '30.2580',
    address: { state: 'Санкт-Петербург' },
    display_name: 'Комендантский проспект, Санкт-Петербург',
  }, // ~10 км
  Гатчина: {
    lat: '59.5650',
    lon: '30.1280',
    address: { state: 'Ленинградская область' },
    display_name: 'Гатчина, Ленинградская область',
  }, // ~42 км
  Псков: { lat: '57.8136', lon: '28.3496', address: { state: 'Псковская область' }, display_name: 'Псков' },
};
const geocoder = { down: false, requests: 0 };
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  const urlText = String(url);
  if (urlText.startsWith('https://nominatim.openstreetmap.org/')) {
    geocoder.requests++;
    if (geocoder.down) throw new Error('geocoder timeout');
    const query = new URL(urlText).searchParams.get('q');
    const knownPlace = Object.entries(GEOCODER_PLACES).find(([keyword]) => query.includes(keyword));
    return new Response(JSON.stringify(knownPlace ? [knownPlace[1]] : []), { status: 200 });
  }
  if (urlText.startsWith('https://api.telegram.org/file/'))
    return new Response(Buffer.from('fake-jpeg'), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  return originalFetch(url, options);
};

// ---- подставной Telegram: каждый запрос бота записываем, отвечаем как Telegram ----
const telegramCalls = [];
let messageCounter = 5000;
const telegraf = require('telegraf');
telegraf.Telegram.prototype.callApi = async function fakeCallApi(method, payload) {
  telegramCalls.push({ method, payload });
  if (method === 'sendMessage' || method === 'sendPhoto' || method === 'sendDocument') {
    messageCounter++;
    return {
      message_id: messageCounter,
      chat: { id: payload.chat_id },
      date: 0,
      text: payload.text,
      photo: [{ file_id: 'small' }, { file_id: `photo-${messageCounter}` }],
    };
  }
  if (method === 'getFile') return { file_id: payload.file_id, file_path: 'photos/file_1.jpg' };
  return true;
};
const sentTo = (chatId) =>
  telegramCalls.filter(
    (call) =>
      ['sendMessage', 'sendPhoto', 'sendDocument'].includes(call.method) &&
      String(call.payload.chat_id) === String(chatId),
  );
const textOf = (call) => call.payload.text || call.payload.caption || '';
const lastTextTo = (chatId) => textOf(sentTo(chatId).at(-1) || { payload: {} });

// Подписанные Telegram данные пользователя — как их присылает мини-приложение
function initData(userId, authDate = Math.floor(Date.now() / 1000)) {
  const parameters = new URLSearchParams({
    auth_date: String(authDate),
    user: JSON.stringify({ id: userId, first_name: 'Анна', username: 'anna' }),
  });
  const dataCheckString = [...parameters.entries()]
    .sort(([firstName], [secondName]) => firstName.localeCompare(secondName))
    .map(([name, value]) => `${name}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  parameters.set('hash', crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex'));
  return parameters.toString();
}

// Завтра по Москве — на эту дату все интервалы ещё доступны
const tomorrowInMoscow = () => new Date(Date.now() + 3 * 3600e3 + 864e5).toISOString().slice(0, 10);

let started = null;
async function start() {
  if (started) return started;
  const { initializeDatabase } = require('../database/initialize');
  await initializeDatabase();
  const { bot } = require('../bot');
  bot.botInfo = { id: 1, is_bot: true, first_name: 'Флёр', username: 'fleur_test_bot' };
  const { startServer } = require('./index');
  const server = startServer(bot);
  await new Promise((resolve) => (server.listening ? resolve() : server.once('listening', resolve)));
  const baseUrl = `http://127.0.0.1:${process.env.PORT}`;
  const call = (userId, method, urlPath, body, headers = {}) =>
    originalFetch(baseUrl + urlPath, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(userId ? { 'X-Init-Data': initData(userId) } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (response) => ({
      status: response.status,
      body: await response.json().catch(() => ({})),
      headers: response.headers,
    }));
  const { database } = require('../database');
  // Оформить заказ из витрины: [[id товара, количество, размер?]] на завтра, Невский проспект
  const placeOrder = (userId, items, formFields = {}) =>
    call(userId, 'POST', '/api/orders', {
      items: items.map(([id, qty, size]) => ({ id, qty, size })),
      customer_name: 'Анна',
      phone: '+7 900 123-45-67',
      address: 'Невский проспект, 1',
      delivery_date: tomorrowInMoscow(),
      delivery_time: '12:00–15:00',
      delivery_zone: 'city',
      ...formFields,
    });
  // ЮKassa сообщает о платеже (как настоящий вебхук)
  const sendPaymentWebhook = (paymentId, event = 'payment.succeeded') =>
    originalFetch(baseUrl + '/yookassa-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, object: { id: paymentId } }),
    });
  const findOrder = async (orderId) => {
    const order = await database.order.findUnique({ where: { id: orderId } });
    return order && { ...order, items: JSON.parse(order.items) };
  };
  started = { base: baseUrl, call, bot, database, server, placeOrder, sendPaymentWebhook, findOrder };
  return started;
}

// Обработчик вебхука отвечает сразу, а платёж проверяет после — ждём, пока проверка закончится
const settle = (milliseconds = 150) => new Promise((resolve) => setTimeout(resolve, milliseconds));

module.exports = {
  start,
  initData,
  payments,
  lastPayment,
  geocoder,
  telegramCalls,
  sentTo,
  textOf,
  lastTextTo,
  tomorrowInMoscow,
  settle,
  OWNER_ID,
};
