// Проверка настроек из админки: календарь (выходные и лимит на интервал), ожидание ответа по фото, тарифы доставки
const { createValidator, isIsoDate } = require('../../validation');
const { cleanTariff } = require('../../../delivery');

const MAX_CLOSED_DAYS = 100;
const MAX_SLOT_LIMIT = 99;
const MAX_PHOTO_TIMEOUT_MINUTES = 240;

const clampWholeNumber = (value, maximum) => Math.max(0, Math.min(maximum, Math.floor(Number(value)) || 0));

const calendarValidator = createValidator((request) => {
  const form = request.body || {};
  const closed = [...new Set((Array.isArray(form.closed) ? form.closed : []).map(String).filter(isIsoDate))]
    .sort()
    .slice(0, MAX_CLOSED_DAYS);
  return { calendar: { closed, slotLimit: clampWholeNumber(form.slotLimit, MAX_SLOT_LIMIT) } };
});

// 0 — не подтверждать фото автоматически
const photoTimeoutValidator = createValidator((request) => ({
  minutes: clampWholeNumber(request.body?.minutes, MAX_PHOTO_TIMEOUT_MINUTES),
}));

// cleanTariff бросает понятную ошибку («Добавьте хотя бы одну зону по городу») — она уйдёт в ответ 400
const deliveryTariffValidator = createValidator((request) => ({ tariff: cleanTariff(request.body || {}) }));

module.exports = { calendarValidator, photoTimeoutValidator, deliveryTariffValidator };
