// HTTP-сервер: витрина (мини-приложение Telegram) и её API, админка, фото и вебхук ЮKassa
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { PROJECT_DIR } = require('../database');
const photos = require('./photos');
const { telegramAuth, ownerAuth, createRateLimit } = require('./auth');
const { createShopRouter } = require('./routes/shop');
const { createCheckoutRouter } = require('./routes/checkout');
const { createYookassaRouter } = require('./routes/yookassa');
const { createAdminProductsRouter } = require('./routes/admin-products');
const { createAdminOrdersRouter } = require('./routes/admin-orders');
const { createAdminChatsRouter } = require('./routes/admin-chats');
const { createAdminStatsRouter } = require('./routes/admin-stats');
const { createAdminSettingsRouter } = require('./routes/admin-settings');

const PUBLIC_DIR = path.join(PROJECT_DIR, 'public');
const DEFAULT_PORT = 3000;
const API_REQUESTS_PER_MINUTE = 120;
// Загрузка фото из админки — до 8 МБ, остальные запросы — до 100 КБ
const LARGE_BODY_PATHS = [/^\/api\/admin\/upload$/, /^\/api\/admin\/orders\/\d+\/photo$/];

function createApp(bot) {
  const app = express();
  // перед сервером стоит nginx на этом же компьютере — берём настоящий IP посетителя из его заголовка
  app.set('trust proxy', 'loopback');

  // большие тела принимаем только после проверки, что это владелица (иначе любой мог бы слать по 8 МБ)
  const parseSmallJson = express.json({ limit: '100kb' });
  const parseLargeJson = express.json({ limit: '8mb' });
  app.use((request, response, next) => (LARGE_BODY_PATHS.some((pathPattern) => pathPattern.test(request.path))
    ? ownerAuth(request, response, () => parseLargeJson(request, response, next))
    : parseSmallJson(request, response, next)));

  // Фото, загруженные из админки (на сервере — /data/flowerbot/uploads), и сама витрина
  fs.mkdirSync(photos.uploadsDir, { recursive: true });
  app.use('/uploads', express.static(photos.uploadsDir, { maxAge: '30d' }));
  app.use(express.static(PUBLIC_DIR));

  // Не больше 120 запросов к API в минуту с одного адреса — от «долбёжки» сервера
  app.use('/api', createRateLimit({ max: API_REQUESTS_PER_MINUTE, windowMs: 60000, key: (request) => request.ip, message: 'Слишком много запросов, подождите минутку' }));
  app.use('/api', createShopRouter({ telegramAuth }));
  app.use('/api', createCheckoutRouter({ bot, telegramAuth }));
  app.use('/api/admin', createAdminProductsRouter({ ownerAuth }));
  app.use('/api/admin', createAdminOrdersRouter({ bot, ownerAuth }));
  app.use('/api/admin', createAdminChatsRouter({ bot, ownerAuth }));
  app.use('/api/admin', createAdminStatsRouter({ ownerAuth }));
  app.use('/api/admin', createAdminSettingsRouter({ bot, ownerAuth }));
  app.use(createYookassaRouter({ bot }));

  // Общий обработчик ошибок: наружу — короткий JSON, подробности — только в лог (без стека в браузере)
  app.use((serverError, request, response, next) => {
    if (response.headersSent) return next(serverError);
    const statusCode = serverError.statusCode || serverError.status || (serverError.expose ? 400 : 500);
    if (statusCode >= 500) console.error('Ошибка сервера:', request.method, request.path, serverError.message);
    return response.status(statusCode).json({ error: statusCode < 500 ? serverError.message : 'Ошибка сервера' });
  });
  return app;
}

function startServer(bot) {
  const app = createApp(bot);
  photos.assignProjectPhotos().catch((photoError) => console.error('Фото из проекта:', photoError.message));
  const port = process.env.PORT || DEFAULT_PORT;
  return app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`🌐 Витрина: http://localhost:${port}`));
}

module.exports = { createApp, startServer };
