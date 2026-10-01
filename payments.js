// Оплата через ЮKassa (https://yookassa.ru/developers/api)
// Ключи берутся из .env: YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY.
// Если ключей нет — онлайн-оплата выключена, заказы принимаются как раньше (оплата курьеру/по договорённости).
const crypto = require('crypto');

const { YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY } = process.env;
const enabled = Boolean(YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY);
const API = 'https://api.yookassa.ru/v3/payments';
const auth = 'Basic ' + Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64');

async function call(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: auth, 'Content-Type': 'application/json', ...options.headers },
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`ЮKassa ${res.status}: ${data.description || 'ошибка'}`);
  return data;
}

// Создаём платёж. Возвращает { id, confirmation: { confirmation_url } }
function createPayment({ orderId, amount, description, returnUrl }) {
  return call(API, {
    method: 'POST',
    headers: { 'Idempotence-Key': `order-${orderId}-${crypto.randomUUID()}` },
    body: JSON.stringify({
      amount: { value: amount.toFixed(2), currency: 'RUB' },
      confirmation: { type: 'redirect', return_url: returnUrl },
      capture: true,
      description: description.slice(0, 128),
      metadata: { order_id: String(orderId), app: 'flowerbot' },
    }),
  });
}

// Узнаём актуальный статус платежа прямо у ЮKassa (не доверяем входящим уведомлениям «на слово»)
const getPayment = (paymentId) => call(`${API}/${encodeURIComponent(paymentId)}`);

module.exports = { enabled, createPayment, getPayment };
