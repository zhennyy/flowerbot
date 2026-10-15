// Админка: календарь (выходные и лимит заказов на интервал), ожидание ответа по фото, тарифы доставки, резервная копия
const express = require('express');
const { getSetting, setSetting } = require('../../../settings');
const { getCalendar } = require('../../../calendar');
const { getTariff } = require('../../../delivery');
const { DEFAULT_TIMEOUT_MINUTES } = require('../../../bouquet-photo');
const { makeBackup } = require('../../../backup');
const { getOwnerId } = require('../../../owner');
const { uploadsDir, photosDir } = require('../../photos');
const { asyncHandler } = require('../../async-handler');
const { calendarValidator, photoTimeoutValidator, deliveryTariffValidator } = require('./validation');

function createAdminSettingsRouter({ bot, ownerAuth }) {
  const router = express.Router();

  router.get(
    '/calendar',
    ownerAuth,
    asyncHandler(async (request, response) => response.json(await getCalendar())),
  );
  router.put(
    '/calendar',
    ownerAuth,
    calendarValidator,
    asyncHandler(async (request, response) => {
      await setSetting('calendar', request.validated.calendar);
      response.json(request.validated.calendar);
    }),
  );

  // Сколько ждать ответа по фото букета (минут; 0 — не подтверждать автоматически)
  router.get(
    '/photo-timeout',
    ownerAuth,
    asyncHandler(async (request, response) => {
      response.json({ minutes: await getSetting('photo_timeout', DEFAULT_TIMEOUT_MINUTES) });
    }),
  );
  router.put(
    '/photo-timeout',
    ownerAuth,
    photoTimeoutValidator,
    asyncHandler(async (request, response) => {
      await setSetting('photo_timeout', request.validated.minutes);
      response.json({ minutes: request.validated.minutes });
    }),
  );

  router.get(
    '/delivery',
    ownerAuth,
    asyncHandler(async (request, response) => response.json(await getTariff())),
  );
  router.put(
    '/delivery',
    ownerAuth,
    deliveryTariffValidator,
    asyncHandler(async (request, response) => {
      await setSetting('delivery_tariff', request.validated.tariff);
      response.json(request.validated.tariff);
    }),
  );

  // Резервная копия: бот присылает владелице ZIP в чат — каталог, заказы, отзывы, переписка, настройки, фото
  router.post(
    '/backup',
    ownerAuth,
    asyncHandler(async (request, response) => {
      const backup = await makeBackup({ uploadsDir, photosDir });
      try {
        await bot.telegram.sendDocument(
          getOwnerId(),
          { source: backup.buffer, filename: backup.filename },
          {
            caption: `📦 Резервная копия «Флёра»\nФото: ${backup.photos} · заказы и каталог — в Excel-файлах внутри.\nХраните у себя: там телефоны и адреса покупателей.`,
          },
        );
      } catch (sendError) {
        return response.status(400).json({ error: sendError.message });
      }
      return response.json({ ok: true, size: backup.buffer.length });
    }),
  );

  return router;
}

module.exports = { createAdminSettingsRouter };
