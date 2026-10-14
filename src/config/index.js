// Настройки из .env: читаем один раз при старте и сразу проверяем,
// чтобы бот падал с понятной ошибкой, а не через час на первом заказе.
require('dotenv').config();

const REQUIRED_VARIABLES = ['BOT_TOKEN', 'WEBAPP_URL'];
// Эти пары работают только вместе: одна без другой — онлайн-оплата останется выключенной
const PAIRED_VARIABLES = [['YOOKASSA_SHOP_ID', 'YOOKASSA_SECRET_KEY']];

function validateConfig() {
  const missingVariables = REQUIRED_VARIABLES.filter((variableName) => !process.env[variableName]);
  if (missingVariables.length) {
    throw new Error(`❌ Заполни ${missingVariables.join(' и ')} в файле .env`);
  }
  try {
    new URL(process.env.WEBAPP_URL);
  } catch {
    throw new Error('❌ WEBAPP_URL в .env должен быть адресом, например https://fleur.botforall.ru');
  }
  if (!process.env.OWNER_ID) {
    console.warn('⚠️  OWNER_ID не задан — админка и уведомления о заказах отключены. Узнай свой ID командой /myid');
  } else if (!/^\d+$/.test(process.env.OWNER_ID)) {
    console.warn('⚠️  OWNER_ID должен быть числом (твой Telegram ID, команда /myid) — админка не откроется');
  }
  for (const [firstVariable, secondVariable] of PAIRED_VARIABLES) {
    if (Boolean(process.env[firstVariable]) !== Boolean(process.env[secondVariable])) {
      console.warn(`⚠️  Для онлайн-оплаты нужны оба: ${firstVariable} и ${secondVariable} — пока оплата выключена`);
    }
  }
}

module.exports = { validateConfig };
