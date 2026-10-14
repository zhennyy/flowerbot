// Проверка запроса статистики: период 7, 30 или 90 дней (иначе — 30)
const { createValidator } = require('../../validation');

const STATS_PERIODS = [7, 30, 90];
const DEFAULT_PERIOD = 30;

const statsValidator = createValidator((request) => ({
  days: STATS_PERIODS.includes(Number(request.query.days)) ? Number(request.query.days) : DEFAULT_PERIOD,
}));

module.exports = { statsValidator };
