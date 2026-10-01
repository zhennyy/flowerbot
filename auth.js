// Проверка, что запрос к API пришёл из нашего Telegram Mini App, а не от кого-то «с улицы».
// Telegram подписывает данные пользователя (initData) токеном бота — подделать подпись нельзя.
// Документация: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
const crypto = require('crypto');

const MAX_AGE_SECONDS = 24 * 60 * 60; // данные старше суток не принимаем

function checkInitData(initData, botToken) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  // Строка для проверки: все поля, отсортированные по алфавиту, в виде key=value через перенос строки
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SECONDS) return null;

  try {
    return JSON.parse(params.get('user')); // { id, first_name, username, ... }
  } catch {
    return null;
  }
}

// Express-middleware: пускает дальше только с правильной подписью, кладёт пользователя в req.tgUser
function requireTelegram(botToken) {
  return (req, res, next) => {
    const user = checkInitData(req.get('X-Init-Data'), botToken);
    if (!user) return res.status(401).json({ error: 'Откройте магазин через Telegram' });
    req.tgUser = user;
    next();
  };
}

// То же самое, но только для владелицы магазина (OWNER_ID из .env)
function requireOwner(botToken, ownerId) {
  const tg = requireTelegram(botToken);
  return (req, res, next) =>
    tg(req, res, () => {
      if (String(req.tgUser.id) !== String(ownerId)) return res.status(403).json({ error: 'Только для владелицы' });
      next();
    });
}

module.exports = { checkInitData, requireTelegram, requireOwner };
