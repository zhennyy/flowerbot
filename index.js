// Точка входа «Флёра»: проверяем настройки, готовим базу, запускаем сервер витрины, бота и фоновые задачи.
const { validateConfig } = require('./src/config');

try {
  validateConfig();
} catch (configError) {
  console.error(configError.message);
  process.exit(1);
}

const { initializeDatabase } = require('./src/database/initialize');
const { disconnect } = require('./src/database');
const { bot, launchBot } = require('./src/bot');
const { startServer } = require('./src/server');
const { startSchedulers } = require('./src/schedulers');

process.on('unhandledRejection', (rejectionReason) => console.error('Необработанная ошибка:', rejectionReason?.message || rejectionReason));

async function start() {
  await initializeDatabase();
  const server = startServer(bot);
  launchBot();
  const stopSchedulers = startSchedulers(bot);

  const shutdown = async (signal) => {
    stopSchedulers();
    server.close();
    bot.stop(signal);
    await disconnect();
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((startError) => {
  console.error('Не удалось запустить магазин:', startError.message);
  process.exit(1);
});
