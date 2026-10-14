// Запросы к API ЮKassa (https://yookassa.ru/developers/api): создать платёж и узнать его статус.
// Ключи из .env: YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY. Если ключей нет — онлайн-оплата выключена,
// заказы принимаются как раньше (оплата курьеру/по договорённости).
const crypto = require('node:crypto');
const axios = require('axios');

const YOOKASSA_API = 'https://api.yookassa.ru/v3/payments';
const OUR_APP_ID = 'flowerbot'; // метка в платеже: по ней вебхук отличает наши платежи от платежей других ботов того же магазина ЮKassa
const REQUEST_TIMEOUT_MS = 15000;
const MAX_DESCRIPTION_LENGTH = 128;

// ключи читаем при каждом запросе, а не при загрузке файла — тогда порядок загрузки .env не важен
const isEnabled = () => Boolean(process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY);
const credentials = () => ({ username: process.env.YOOKASSA_SHOP_ID, password: process.env.YOOKASSA_SECRET_KEY });

// Ошибка ЮKassa коротко и по-русски: «ЮKassa 401: описание»
function describeError(requestError) {
  if (!requestError.response) return requestError;
  return new Error(`ЮKassa ${requestError.response.status}: ${requestError.response.data?.description || 'ошибка'}`);
}

// Создаём платёж. Возвращает { id, confirmation: { confirmation_url } }
async function createPayment({ orderId, amount, description, returnUrl }) {
  try {
    const response = await axios.post(YOOKASSA_API, {
      amount: { value: amount.toFixed(2), currency: 'RUB' },
      confirmation: { type: 'redirect', return_url: returnUrl },
      capture: true,
      description: description.slice(0, MAX_DESCRIPTION_LENGTH),
      metadata: { order_id: String(orderId), app: OUR_APP_ID },
    }, {
      auth: credentials(),
      headers: { 'Idempotence-Key': `order-${orderId}-${crypto.randomUUID()}` },
      timeout: REQUEST_TIMEOUT_MS,
    });
    return response.data;
  } catch (requestError) {
    throw describeError(requestError);
  }
}

// Узнаём актуальный статус платежа прямо у ЮKassa (не доверяем входящим уведомлениям «на слово»)
async function getPayment(paymentId) {
  try {
    const response = await axios.get(`${YOOKASSA_API}/${encodeURIComponent(paymentId)}`, { auth: credentials(), timeout: REQUEST_TIMEOUT_MS });
    return response.data;
  } catch (requestError) {
    throw describeError(requestError);
  }
}

module.exports = { isEnabled, createPayment, getPayment, OUR_APP_ID };
