// Проверка, что запрос к API пришёл из нашего Telegram Mini App, а не от кого-то «с улицы».
// Telegram подписывает данные пользователя (initData) токеном бота — подделать подпись нельзя.
// Документация: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
const crypto = require('node:crypto');
const { isOwner } = require('../owner');

const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60; // данные старше суток не принимаем
const CLEANUP_INTERVAL_MS = 60000;

// Пользователь Telegram из строки initData ({ id, first_name, username, ... }) или null, если подпись неверна
function checkInitData(initData, botToken = process.env.BOT_TOKEN) {
  if (!initData) return null;
  const parameters = new URLSearchParams(initData);
  const receivedHash = parameters.get('hash');
  if (!receivedHash) return null;
  parameters.delete('hash');

  // Строка для проверки: все поля, отсортированные по алфавиту, в виде key=value через перенос строки
  const dataCheckString = [...parameters.entries()]
    .sort(([firstName], [secondName]) => firstName.localeCompare(secondName))
    .map(([fieldName, fieldValue]) => `${fieldName}=${fieldValue}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  const receivedBuffer = Buffer.from(receivedHash, 'hex');
  if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) return null;

  const authDate = Number(parameters.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_SECONDS) return null;

  try {
    const telegramUser = JSON.parse(parameters.get('user'));
    return telegramUser && telegramUser.id ? telegramUser : null;
  } catch {
    return null;
  }
}

// Пускает дальше только с правильной подписью, кладёт пользователя в request.telegramUser
function telegramAuth(request, response, next) {
  const telegramUser = checkInitData(request.get('X-Init-Data'));
  if (!telegramUser) return response.status(401).json({ error: 'Откройте магазин через Telegram' });
  request.telegramUser = telegramUser;
  return next();
}

// То же самое, но только для владелицы магазина (OWNER_ID из .env)
function ownerAuth(request, response, next) {
  return telegramAuth(request, response, () => {
    if (!isOwner(request.telegramUser.id)) return response.status(403).json({ error: 'Только для владелицы' });
    return next();
  });
}

// ─── Защита от спама: ограничение частоты запросов ───────
// Простой счётчик в памяти: ключ → время последних запросов. Больше max за windowMs — ответ 429 с message.
function createRateLimit({ max, windowMs, key, message }) {
  const requestTimesByKey = new Map();
  setInterval(() => { // раз в минуту убираем старые записи, чтобы память не росла
    const now = Date.now();
    for (const [trackedKey, requestTimes] of requestTimesByKey) {
      const freshTimes = requestTimes.filter((requestTime) => now - requestTime < windowMs);
      if (freshTimes.length) requestTimesByKey.set(trackedKey, freshTimes);
      else requestTimesByKey.delete(trackedKey);
    }
  }, CLEANUP_INTERVAL_MS).unref();
  return (request, response, next) => {
    const requestKey = key(request);
    const now = Date.now();
    const recentTimes = (requestTimesByKey.get(requestKey) || []).filter((requestTime) => now - requestTime < windowMs);
    if (recentTimes.length >= max) return response.status(429).json({ error: message });
    recentTimes.push(now);
    requestTimesByKey.set(requestKey, recentTimes);
    return next();
  };
}

module.exports = { checkInitData, telegramAuth, ownerAuth, createRateLimit };
