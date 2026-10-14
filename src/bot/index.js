// Telegram-бот: собирает обработчики из папки handlers в правильном порядке и запускает бота
const { Telegraf } = require('telegraf');
const { registerStartHandlers } = require('./handlers/start');
const { registerOrderStatusHandlers } = require('./handlers/order-status');
const { registerMyOrdersHandlers } = require('./handlers/my-orders');
const { registerFloristChatActions, registerIncomingMessageHandlers } = require('./handlers/florist-chat');
const { registerBouquetPhotoHandlers } = require('./handlers/bouquet-photo');
const { registerReviewHandlers } = require('./handlers/reviews');
const { registerReminderHandlers } = require('./handlers/reminders');
const { registerOwnerSummaryHandlers } = require('./handlers/owner-summary');
const { getOwnerId } = require('../owner');

// TELEGRAM_API_ROOT — посредник для Telegram (нужен, если сервер в России)
const telegramOptions = process.env.TELEGRAM_API_ROOT ? { telegram: { apiRoot: process.env.TELEGRAM_API_ROOT.replace(/\/*$/, '/') } } : {};
const bot = new Telegraf(process.env.BOT_TOKEN, telegramOptions);

registerStartHandlers(bot);
registerOrderStatusHandlers(bot);
registerMyOrdersHandlers(bot);
registerFloristChatActions(bot);
registerBouquetPhotoHandlers(bot);
registerReviewHandlers(bot);
registerReminderHandlers(bot);
registerOwnerSummaryHandlers(bot);
// Любой текст и фото — последними: они не должны перехватывать /start и другие команды
registerIncomingMessageHandlers(bot);

// Ошибка в одном обработчике не должна ронять бота целиком
bot.catch((handlerError, context) => console.error('Ошибка бота:', context?.updateType, handlerError?.message || handlerError));

const BUYER_COMMANDS = [
  { command: 'start', description: 'Открыть магазин' },
  { command: 'orders', description: 'Мои заказы' },
  { command: 'reminders', description: 'Мои напоминания о датах' },
];
// у владелицы в меню ещё и служебные команды
const OWNER_COMMANDS = [
  { command: 'admin', description: 'Админка' },
  { command: 'today', description: 'Доставки на сегодня' },
  { command: 'tomorrow', description: 'Доставки на завтра' },
  { command: 'start', description: 'Открыть магазин' },
];

// Кнопка «Магазин» у поля ввода и меню команд
async function setupMenu() {
  try {
    await bot.telegram.setChatMenuButton({ menuButton: { type: 'web_app', text: 'Магазин', web_app: { url: process.env.WEBAPP_URL } } });
    await bot.telegram.setMyCommands(BUYER_COMMANDS);
    const ownerId = getOwnerId();
    if (ownerId) await bot.telegram.setMyCommands(OWNER_COMMANDS, { scope: { type: 'chat', chat_id: Number(ownerId) } });
  } catch (menuError) {
    console.error('Не удалось настроить меню бота:', menuError.message);
  }
}

// Запуск бота. В Telegraf 4.16 код «после запуска» передаётся колбэком (promise launch() завершается только при остановке бота)
function launchBot() {
  bot.launch(async () => {
    console.log('🤖 Бот запущен');
    await setupMenu();
  }).catch((launchError) => {
    console.error('Бот не запустился:', launchError.message);
    process.exit(1);
  });
}

module.exports = { bot, launchBot };
